import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TravelService } from '../travel-service.js';
import { createTravelHandler } from './travel-handler.js';

describe('travel HTTP boundary', () => {
    let origin = '';
    let server: ReturnType<typeof createServer>;
    const plan = vi.fn().mockResolvedValue({ itineraries: [] });

    beforeAll(async () => {
        const handler = createTravelHandler({ plan } as unknown as TravelService);
        server = createServer((request, response) => {
            if (!handler(request, response, new URL(request.url ?? '/', 'http://localhost'))) response.writeHead(404).end();
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('no address');
        origin = `http://127.0.0.1:${address.port}`;
    });
    afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

    it('accepts a bounded POST body and disables caching and referrers', async () => {
        const body = { resourceUri: 'at://resource', origin: { latitude: 41.8, longitude: -87.6 }, dateTime: new Date().toISOString() };
        const response = await fetch(`${origin}/travel/plan`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('referrer-policy')).toBe('no-referrer');
        expect(plan).toHaveBeenCalledWith(body, expect.any(AbortSignal));
    });

    it('rejects unsupported methods before calling the service', async () => {
        const calls = plan.mock.calls.length;
        const response = await fetch(`${origin}/travel/plan`);
        expect(response.status).toBe(405);
        expect(plan).toHaveBeenCalledTimes(calls);
    });
});
