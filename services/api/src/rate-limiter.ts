/**
 * In-memory sliding-window rate limiter.
 *
 * Each key (typically a client IP) maintains a list of request timestamps.
 * When `check` is called the window is pruned of expired entries before
 * evaluating whether the caller is within their budget.
 *
 * No external dependencies -- the data structure lives entirely in process
 * memory and is lost on restart (which is acceptable for rate-limiting state).
 */

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    retryAfterMs: number;
}

export interface RateLimiterOptions {
    windowMs: number;
    maxRequests: number;
}

export class RateLimiter {
    private readonly windowMs: number;
    private readonly maxRequests: number;
    private readonly hits = new Map<string, number[]>();

    constructor(options: RateLimiterOptions) {
        this.windowMs = options.windowMs;
        this.maxRequests = options.maxRequests;
    }

    /**
     * Check whether `key` is allowed to make another request.
     * If allowed the request is recorded; if not, no state change occurs.
     */
    check(key: string, now: number = Date.now()): RateLimitResult {
        const windowStart = now - this.windowMs;

        let timestamps = this.hits.get(key);
        if (timestamps) {
            // Prune entries outside the current window
            timestamps = timestamps.filter(t => t > windowStart);
            this.hits.set(key, timestamps);
        } else {
            timestamps = [];
            this.hits.set(key, timestamps);
        }

        if (timestamps.length >= this.maxRequests) {
            // Earliest entry determines when the window will next free a slot
            const oldestInWindow = timestamps[0]!;
            const retryAfterMs = oldestInWindow + this.windowMs - now;
            return {
                allowed: false,
                remaining: 0,
                retryAfterMs: Math.max(retryAfterMs, 0),
            };
        }

        timestamps.push(now);
        return {
            allowed: true,
            remaining: this.maxRequests - timestamps.length,
            retryAfterMs: 0,
        };
    }

    /** Reset all state for a key (useful in tests). */
    reset(key: string): void {
        this.hits.delete(key);
    }

    /** Reset all state for all keys. */
    resetAll(): void {
        this.hits.clear();
    }
}

/* ------------------------------------------------------------------ */
/*  Default rate-limiter instances for the API server                  */
/* ------------------------------------------------------------------ */

/** Read traffic: 120 req / 60 s */
export const generalLimiter = new RateLimiter({
    windowMs: 60_000,
    maxRequests: 120,
});

/** Auth endpoints: 10 req / 60 s */
export const authLimiter = new RateLimiter({
    windowMs: 60_000,
    maxRequests: 10,
});

/** General writes: 30 req / 60 s */
export const mutationLimiter = new RateLimiter({
    windowMs: 60_000,
    maxRequests: 30,
});

/** Abuse reports: 5 req / 60 s */
export const reportLimiter = new RateLimiter({
    windowMs: 60_000,
    maxRequests: 5,
});

/** Moderation operations: 10 req / 60 s */
export const moderationLimiter = new RateLimiter({
    windowMs: 60_000,
    maxRequests: 10,
});

/* ------------------------------------------------------------------ */
/*  Route classification                                              */
/* ------------------------------------------------------------------ */

const AUTH_PREFIXES = ['/auth/', '/oauth/login', '/oauth/callback'];
const REPORT_PREFIXES = ['/reports', '/chat/safety/report', '/chat/reports'];
const MODERATION_PREFIXES = ['/moderation/'];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Select the appropriate rate limiter for a given route pathname.
 */
export const selectLimiter = (method: string | undefined, pathname: string): RateLimiter => {
    if (pathname === '/resource-corrections/review') return moderationLimiter;
    if (method === 'POST' && ['/resource-corrections','/resource-corrections/respond'].includes(pathname)) return reportLimiter;
    if (method === 'GET' && pathname === '/auth/session') {
        return generalLimiter;
    }
    if (AUTH_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
        return authLimiter;
    }
    if (REPORT_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
        return reportLimiter;
    }
    if (MODERATION_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
        return moderationLimiter;
    }
    return SAFE_METHODS.has(method ?? 'GET') ? generalLimiter : mutationLimiter;
};

/* ------------------------------------------------------------------ */
/*  Client-IP extraction                                              */
/* ------------------------------------------------------------------ */

/**
 * Extract a client identifier from the request for rate-limiting purposes.
 * Prefers X-Forwarded-For (first entry) then falls back to the socket
 * remote address, and finally to a catch-all key.
 */
export const extractClientIp = (
    headers: Record<string, string | string[] | undefined>,
    remoteAddress: string | undefined,
    trustedProxies: readonly string[] = [],
): string => {
    const peer = remoteAddress?.startsWith('::ffff:') ? remoteAddress.slice(7) : remoteAddress;
    const forwarded = headers['x-forwarded-for'];
    if (
        peer &&
        isTrustedProxy(peer, trustedProxies) &&
        typeof forwarded === 'string' &&
        !forwarded.includes(',')
    ) {
        const candidate = forwarded.trim();
        if (isIP(candidate) !== 0) return candidate;
    }
    return peer ?? 'unknown';
};

const ipv4Number = (address: string): number | undefined => {
    if (isIP(address) !== 4) return undefined;
    return address
        .split('.')
        .reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
};

const matchesIpv4Cidr = (address: string, cidr: string): boolean => {
    const [network, prefixText] = cidr.split('/');
    const value = ipv4Number(address);
    const networkValue = network ? ipv4Number(network) : undefined;
    const prefix = Number(prefixText);
    if (value === undefined || networkValue === undefined || !Number.isInteger(prefix)) {
        return false;
    }
    if (prefix < 0 || prefix > 32) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (networkValue & mask);
};

const isTrustedProxy = (peer: string, entries: readonly string[]): boolean =>
    entries.some(entry =>
        entry.includes('/') ? matchesIpv4Cidr(peer, entry) : peer === entry,
    );
import { isIP } from 'node:net';
