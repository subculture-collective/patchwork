import { z, ZodError } from 'zod';
import { didSchema } from '@patchwork/shared';
import {
    canTransition,
    createStatusTransition,
    getValidTargetsForRole,
    isValidLifecycleRole,
    STATUS_LABELS,
    ASSIGNMENT_TIMEOUT_MS,
    type AssignmentRecord,
    type AssignmentStatus,
    type HandoffMetadata,
    type LifecycleRole,
    type RequestStatus,
    type RequestTimeline,
    type StatusTransition,
} from '@patchwork/shared';
import {
    type AuthorizationContext,
    AuthorizationError,
    requireCapability,
    requireOwnerOrRole,
    requireRole,
} from './authorization-guard.js';
import type { LifecycleRepository } from './db/lifecycle-repository.js';

/**
 * In-memory store for request statuses and timelines.
 * In production this would be backed by a database.
 */
interface RequestLifecycleRecord {
    postUri: string;
    currentStatus: RequestStatus;
    timeline: RequestTimeline;
    updatedAt: string;
    assignment?: AssignmentRecord;
    handoff?: HandoffMetadata;
}

export interface LifecycleTransitionResult {
    statusCode: number;
    body:
        | LifecycleTransitionSuccessResponse
        | LifecycleTransitionErrorResponse;
}

export interface LifecycleTransitionSuccessResponse {
    postUri: string;
    previousStatus: RequestStatus;
    currentStatus: RequestStatus;
    transition: StatusTransition;
    timeline: RequestTimeline;
    updatedAt: string;
}

export interface LifecycleTransitionErrorResponse {
    error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
    };
}

export interface LifecycleQueryResult {
    statusCode: number;
    body:
        | LifecycleQuerySuccessResponse
        | LifecycleTransitionErrorResponse;
}

export interface LifecycleQuerySuccessResponse {
    postUri: string;
    currentStatus: RequestStatus;
    statusLabel: string;
    timeline: RequestTimeline;
    validTransitions: RequestStatus[];
    updatedAt: string;
    assignment?: AssignmentRecord;
    handoff?: HandoffMetadata;
    publicStatus?: 'open' | 'in-progress' | 'resolved' | 'closed';
    publicCid?: string;
    publicSyncedAt?: string;
    publicSyncState?: 'pending' | 'synced' | 'failed';
    publicSyncErrorCode?: string;
    publicSyncAttemptedAt?: string;
    /** Durable write-to-projection receipt; source state is never inferred from the UI. */
    projectionReceipt?: {
        sourceUri: string;
        sourceCid?: string;
        state: 'pending' | 'projected' | 'failed';
        projectedAt?: string;
        lagSeconds?: number;
        retryAfterSeconds?: number;
        failureCode?: string;
    };
}

export interface AssignmentResult {
    statusCode: number;
    body:
        | AssignmentSuccessResponse
        | LifecycleTransitionErrorResponse;
}

export interface AssignmentSuccessResponse {
    postUri: string;
    assignment: AssignmentRecord;
    currentStatus: RequestStatus;
    updatedAt: string;
}

export interface HandoffResult {
    statusCode: number;
    body:
        | HandoffSuccessResponse
        | LifecycleTransitionErrorResponse;
}

export interface HandoffSuccessResponse {
    postUri: string;
    handoff: HandoffMetadata;
    currentStatus: RequestStatus;
    updatedAt: string;
}

const transitionInputSchema = z.object({
    commandId: z.string().min(1).max(200).optional(),
    postUri: z
        .string()
        .min(1, 'postUri is required')
        .regex(/^at:\/\//, 'postUri must be a valid at:// URI'),
    targetStatus: z.enum([
        'open',
        'triaged',
        'assigned',
        'in_progress',
        'resolved',
        'archived',
    ]),
    actorDid: didSchema,
    actorRole: z.enum([
        'requester',
        'volunteer',
        'coordinator',
        'moderator',
        'admin',
    ]),
    reason: z.string().max(500).optional(),
    now: z.string().datetime({ offset: true }).optional(),
});

type TransitionInput = z.infer<typeof transitionInputSchema>;

const assignmentInputSchema = z.object({
    commandId: z.string().min(1).max(200).optional(),
    postUri: z
        .string()
        .min(1, 'postUri is required')
        .regex(/^at:\/\//, 'postUri must be a valid at:// URI'),
    assigneeDid: didSchema,
    assignerDid: didSchema,
    now: z.string().datetime({ offset: true }).optional(),
});

const assignmentResponseSchema = z.object({
    commandId: z.string().min(1).max(200).optional(),
    postUri: z
        .string()
        .min(1)
        .regex(/^at:\/\//),
    assigneeDid: didSchema,
    now: z.string().datetime({ offset: true }).optional(),
    reason: z.string().max(500).optional(),
});

const handoffInputSchema = z.object({
    commandId: z.string().min(1).max(200).optional(),
    postUri: z
        .string()
        .min(1)
        .regex(/^at:\/\//),
    assigneeDid: didSchema,
    notes: z.string().max(2000).optional(),
    recipientConfirmed: z.boolean().optional(),
    deliveryMethod: z
        .enum(['in_person', 'shipped', 'digital', 'other'])
        .optional(),
    now: z.string().datetime({ offset: true }).optional(),
});

const toValidationError = (
    error: ZodError,
): LifecycleTransitionErrorResponse => {
    return {
        error: {
            code: 'INVALID_INPUT',
            message: 'Transition request failed validation.',
            details: {
                issues: error.issues.map((issue) => ({
                    path: issue.path.join('.'),
                    message: issue.message,
                })),
            },
        },
    };
};

export class LifecycleService {
    private readonly records = new Map<string, RequestLifecycleRecord>();

    constructor(private readonly repository?: LifecycleRepository,
        private readonly projectionReadback?: (uri: string, cid?: string) => Promise<NonNullable<LifecycleQuerySuccessResponse['projectionReceipt']>>) {}

    /**
     * Register a post with initial 'open' status. Called when a post is
     * created so the lifecycle service can track it.
     */
    registerPost(postUri: string, createdAt?: string): void {
        if (this.records.has(postUri)) {
            return;
        }

        const now = createdAt ?? new Date().toISOString();
        this.records.set(postUri, {
            postUri,
            currentStatus: 'open',
            timeline: [],
            updatedAt: now,
        });
    }

    /**
     * Process a status transition request from a JSON body.
     *
     * When `authCtx` is provided, force transitions (to 'archived' from
     * any state) require 'moderate:content' capability.
     */
    async transitionFromBody(
        body: unknown,
        authCtx?: AuthorizationContext,
    ): Promise<LifecycleTransitionResult> {
        let input: TransitionInput;

        try {
            input = transitionInputSchema.parse(body);
        } catch (error) {
            if (error instanceof ZodError) {
                return {
                    statusCode: 400,
                    body: toValidationError(error),
                };
            }
            throw error;
        }

        // Optional authorization: force-archival requires moderation capability
        if (authCtx && input.targetStatus === 'archived') {
            try {
                requireCapability(authCtx, 'moderate:content');
            } catch (err) {
                if (err instanceof AuthorizationError) {
                    return {
                        statusCode: err.statusCode,
                        body: {
                            error: {
                                code: err.code,
                                message: err.message,
                            },
                        },
                    };
                }
                throw err;
            }
        }

        return this.executeTransition(input, authCtx);
    }

    /**
     * Process a status transition from URL search params.
     */
    async transitionFromParams(
        params: URLSearchParams,
    ): Promise<LifecycleTransitionResult> {
        const body = {
            postUri: params.get('postUri') ?? undefined,
            targetStatus: params.get('targetStatus') ?? undefined,
            actorDid: params.get('actorDid') ?? undefined,
            actorRole: params.get('actorRole') ?? undefined,
            reason: params.get('reason') ?? undefined,
            now: params.get('now') ?? undefined,
        };

        return this.transitionFromBody(body);
    }

    /**
     * Query the lifecycle state and timeline for a post.
     */
    queryPostLifecycle(
        postUri: string,
        actorRole?: string,
    ): LifecycleQueryResult {
        const record = this.records.get(postUri);

        if (!record) {
            return {
                statusCode: 404,
                body: {
                    error: {
                        code: 'NOT_FOUND',
                        message: `No lifecycle record found for post: ${postUri}`,
                    },
                },
            };
        }

        const role: LifecycleRole =
            actorRole && isValidLifecycleRole(actorRole)
                ? actorRole
                : 'requester';

        return {
            statusCode: 200,
            body: {
                postUri: record.postUri,
                currentStatus: record.currentStatus,
                statusLabel: STATUS_LABELS[record.currentStatus],
                timeline: [...record.timeline],
                validTransitions: getValidTargetsForRole(
                    record.currentStatus,
                    role,
                ),
                updatedAt: record.updatedAt,
                ...(record.assignment
                    ? { assignment: { ...record.assignment } }
                    : {}),
                ...(record.handoff
                    ? { handoff: { ...record.handoff } }
                    : {}),
            },
        };
    }

    /**
     * Query lifecycle state from URL search params.
     */
    queryFromParams(params: URLSearchParams): LifecycleQueryResult {
        const postUri = params.get('postUri');

        if (!postUri) {
            return {
                statusCode: 400,
                body: {
                    error: {
                        code: 'INVALID_INPUT',
                        message: 'postUri query parameter is required.',
                    },
                },
            };
        }

        return this.queryPostLifecycle(
            postUri,
            params.get('actorRole') ?? undefined,
        );
    }

    async queryFromParamsAsync(
        params: URLSearchParams,
    ): Promise<LifecycleQueryResult> {
        const postUri = params.get('postUri');
        if (!postUri) {
            return {
                statusCode: 400,
                body: {
                    error: {
                        code: 'INVALID_INPUT',
                        message: 'postUri query parameter is required.',
                    },
                },
            };
        }
        if (this.repository) {
            return this.queryDurablePostLifecycle(
                postUri,
                params.get('actorRole') ?? undefined,
            );
        }
        return this.queryPostLifecycle(
            postUri,
            params.get('actorRole') ?? undefined,
        );
    }

    async queryForActor(
        postUri: string | null,
        authCtx: AuthorizationContext,
    ): Promise<LifecycleQueryResult> {
        if (!postUri) {
            return {
                statusCode: 400,
                body: {
                    error: {
                        code: 'INVALID_INPUT',
                        message: 'postUri query parameter is required.',
                    },
                },
            };
        }
        if (!this.repository) {
            return {
                statusCode: 503,
                body: {
                    error: {
                        code: 'LIFECYCLE_STORE_UNAVAILABLE',
                        message: 'Durable lifecycle state is unavailable.',
                    },
                },
            };
        }
        const record = await this.repository.get(postUri);
        if (!record) {
            return {
                statusCode: 404,
                body: {
                    error: {
                        code: 'NOT_FOUND',
                        message: 'No lifecycle record was found.',
                    },
                },
            };
        }
        try {
            requireOwnerOrRole(authCtx, record.requesterDid, 'moderator');
        } catch (error) {
            if (error instanceof AuthorizationError) {
                return {
                    statusCode: error.statusCode,
                    body: {
                        error: {
                            code: error.code,
                            message: 'Lifecycle state is private to its owner.',
                        },
                    },
                };
            }
            throw error;
        }
        const lifecycleRole: LifecycleRole =
            authCtx.role === 'volunteer' ? 'volunteer'
            : authCtx.role === 'moderator' ? 'moderator'
            : authCtx.role === 'admin' || authCtx.role === 'super_admin' ? 'admin'
            : 'requester';
        return this.queryDurablePostLifecycle(postUri, lifecycleRole);
    }

    private async queryDurablePostLifecycle(
        postUri: string,
        actorRole?: string,
    ): Promise<LifecycleQueryResult> {
        const record = await this.repository?.get(postUri);
        if (!record) {
            return {
                statusCode: 404,
                body: {
                    error: {
                        code: 'NOT_FOUND',
                        message: `No lifecycle record found for post: ${postUri}`,
                    },
                },
            };
        }
        const role: LifecycleRole =
            actorRole && isValidLifecycleRole(actorRole)
                ? actorRole
                : 'requester';
        const currentStatus = record.currentStatus as RequestStatus;
        return {
            statusCode: 200,
            body: {
                postUri: record.postUri,
                currentStatus,
                statusLabel: STATUS_LABELS[currentStatus],
                timeline: record.timeline,
                validTransitions: getValidTargetsForRole(currentStatus, role),
                updatedAt: record.updatedAt,
                ...(record.assignment
                    ? { assignment: { ...record.assignment } }
                    : {}),
                ...(record.handoff ? { handoff: { ...record.handoff } } : {}),
                ...(record.publicStatus
                    ? { publicStatus: record.publicStatus }
                    : {}),
                ...(record.publicCid ? { publicCid: record.publicCid } : {}),
                ...(record.publicSyncedAt
                    ? { publicSyncedAt: record.publicSyncedAt }
                    : {}),
                ...(record.publicSyncState
                    ? { publicSyncState: record.publicSyncState }
                    : {}),
                ...(record.publicSyncErrorCode
                    ? { publicSyncErrorCode: record.publicSyncErrorCode }
                    : {}),
                ...(record.publicSyncAttemptedAt
                    ? { publicSyncAttemptedAt: record.publicSyncAttemptedAt }
                    : {}),
                ...(this.projectionReadback ? {
                    projectionReceipt: record.publicSyncState === 'pending' || record.publicSyncState === 'failed'
                        ? { sourceUri: record.postUri, state: record.publicSyncState, retryAfterSeconds: 5 }
                        : await this.projectionReadback(record.postUri, record.publicCid),
                } : {}),
            },
        };
    }

    /**
     * Assign a request to a volunteer. Transitions the post to 'assigned'
     * if it is currently 'triaged' or re-assigns from 'assigned'/'in_progress'.
     */
    async assignRequest(
        body: unknown,
        authCtx?: AuthorizationContext,
    ): Promise<AssignmentResult> {
        let input: z.infer<typeof assignmentInputSchema>;
        try {
            input = assignmentInputSchema.parse(body);
        } catch (error) {
            if (error instanceof ZodError) {
                return { statusCode: 400, body: toValidationError(error) };
            }
            throw error;
        }

        if (this.repository) {
            return this.assignDurably(input, authCtx);
        }

        const record = this.records.get(input.postUri);
        if (!record) {
            return {
                statusCode: 404,
                body: {
                    error: {
                        code: 'NOT_FOUND',
                        message: `No lifecycle record found for post: ${input.postUri}`,
                    },
                },
            };
        }

        // Must be in a state that can transition to 'assigned', or already assigned
        const canAssign =
            record.currentStatus === 'triaged' ||
            record.currentStatus === 'assigned' ||
            record.currentStatus === 'in_progress';
        if (!canAssign) {
            return {
                statusCode: 403,
                body: {
                    error: {
                        code: 'TRANSITION_NOT_ALLOWED',
                        message: `Cannot assign a request in '${record.currentStatus}' status.`,
                    },
                },
            };
        }

        const now = input.now ?? new Date().toISOString();

        // Transition to assigned if not already
        if (record.currentStatus !== 'assigned') {
            const transition = createStatusTransition({
                from: record.currentStatus,
                to: 'assigned',
                actorDid: input.assignerDid,
                actorRole: 'coordinator',
                timestamp: now,
                reason: `Assigned to ${input.assigneeDid}`,
            });
            record.currentStatus = 'assigned';
            record.timeline.push(transition);
        }

        const assignment: AssignmentRecord = {
            assigneeDid: input.assigneeDid,
            assignerDid: input.assignerDid,
            assignedAt: now,
            status: 'pending',
            timeoutMs: ASSIGNMENT_TIMEOUT_MS,
        };

        record.assignment = assignment;
        record.updatedAt = now;

        return {
            statusCode: 200,
            body: {
                postUri: record.postUri,
                assignment: { ...assignment },
                currentStatus: record.currentStatus,
                updatedAt: record.updatedAt,
            },
        };
    }

    private async assignDurably(
        input: z.infer<typeof assignmentInputSchema>,
        authCtx?: AuthorizationContext,
    ): Promise<AssignmentResult> {
        if (!authCtx) {
            return {
                statusCode: 401,
                body: {
                    error: {
                        code: 'UNAUTHORIZED',
                        message: 'A durable assignment requires authentication.',
                    },
                },
            };
        }
        try {
            requireRole(authCtx, 'moderator');
        } catch (error) {
            if (error instanceof AuthorizationError) {
                return {
                    statusCode: error.statusCode,
                    body: {
                        error: { code: error.code, message: error.message },
                    },
                };
            }
            throw error;
        }
        if (!input.commandId) {
            return {
                statusCode: 400,
                body: {
                    error: {
                        code: 'COMMAND_ID_REQUIRED',
                        message: 'commandId is required for durable assignments.',
                    },
                },
            };
        }
        const workflow = await this.repository?.get(input.postUri);
        if (!workflow) {
            return {
                statusCode: 404,
                body: {
                    error: {
                        code: 'NOT_FOUND',
                        message: `No lifecycle record found for post: ${input.postUri}`,
                    },
                },
            };
        }
        const now = input.now ?? new Date().toISOString();
        try {
            const outcome = await this.repository!.assign({
                commandId: input.commandId,
                postUri: input.postUri,
                assignerDid: authCtx.actorDid,
                assigneeDid: input.assigneeDid,
                occurredAt: now,
                timeoutMs: ASSIGNMENT_TIMEOUT_MS,
                auditRetentionUntil: new Date(
                    new Date(now).getTime() + 365 * 24 * 60 * 60 * 1000,
                ).toISOString(),
            });
            return {
                statusCode: 200,
                body: {
                    postUri: input.postUri,
                    assignment: outcome.assignment,
                    currentStatus: 'assigned',
                    updatedAt: now,
                },
            };
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === 'ASSIGNMENT_TRANSITION_NOT_ALLOWED'
            ) {
                return {
                    statusCode: 403,
                    body: {
                        error: {
                            code: 'TRANSITION_NOT_ALLOWED',
                            message: `Cannot assign a request in '${workflow.currentStatus}' status.`,
                        },
                    },
                };
            }
            throw error;
        }
    }

    /**
     * Volunteer accepts an assignment. Transitions to 'in_progress'.
     *
     * When `authCtx` is provided, requires 'accept:assignment' capability.
     */
    async acceptAssignment(
        body: unknown,
        authCtx?: AuthorizationContext,
    ): Promise<AssignmentResult> {
        if (authCtx) {
            try {
                requireCapability(authCtx, 'accept:assignment');
            } catch (err) {
                if (err instanceof AuthorizationError) {
                    return {
                        statusCode: err.statusCode,
                        body: {
                            error: {
                                code: err.code,
                                message: err.message,
                            },
                        },
                    };
                }
                throw err;
            }
        }

        let input: z.infer<typeof assignmentResponseSchema>;
        try {
            input = assignmentResponseSchema.parse(body);
        } catch (error) {
            if (error instanceof ZodError) {
                return { statusCode: 400, body: toValidationError(error) };
            }
            throw error;
        }

        if (this.repository) {
            return this.respondToAssignmentDurably(input, 'accepted', authCtx);
        }

        const record = this.records.get(input.postUri);
        if (!record) {
            return {
                statusCode: 404,
                body: {
                    error: {
                        code: 'NOT_FOUND',
                        message: `No lifecycle record found for post: ${input.postUri}`,
                    },
                },
            };
        }

        if (!record.assignment || record.assignment.assigneeDid !== input.assigneeDid) {
            return {
                statusCode: 403,
                body: {
                    error: {
                        code: 'ASSIGNMENT_MISMATCH',
                        message: 'This volunteer is not the current assignee.',
                    },
                },
            };
        }

        if (record.assignment.status !== 'pending') {
            return {
                statusCode: 403,
                body: {
                    error: {
                        code: 'ASSIGNMENT_ALREADY_RESPONDED',
                        message: `Assignment already has status '${record.assignment.status}'.`,
                    },
                },
            };
        }

        const now = input.now ?? new Date().toISOString();

        record.assignment.status = 'accepted';
        record.assignment.respondedAt = now;

        // Transition to in_progress
        const transition = createStatusTransition({
            from: 'assigned',
            to: 'in_progress',
            actorDid: input.assigneeDid,
            actorRole: 'volunteer',
            timestamp: now,
            reason: 'Assignment accepted',
        });
        record.currentStatus = 'in_progress';
        record.timeline.push(transition);
        record.updatedAt = now;

        return {
            statusCode: 200,
            body: {
                postUri: record.postUri,
                assignment: { ...record.assignment },
                currentStatus: record.currentStatus,
                updatedAt: record.updatedAt,
            },
        };
    }

    /**
     * Volunteer declines an assignment. Reverts to 'triaged' for reassignment.
     */
    async declineAssignment(
        body: unknown,
        authCtx?: AuthorizationContext,
    ): Promise<AssignmentResult> {
        if (authCtx) {
            try {
                requireCapability(authCtx, 'accept:assignment');
            } catch (err) {
                if (err instanceof AuthorizationError) {
                    return {
                        statusCode: err.statusCode,
                        body: {
                            error: { code: err.code, message: err.message },
                        },
                    };
                }
                throw err;
            }
        }
        let input: z.infer<typeof assignmentResponseSchema>;
        try {
            input = assignmentResponseSchema.parse(body);
        } catch (error) {
            if (error instanceof ZodError) {
                return { statusCode: 400, body: toValidationError(error) };
            }
            throw error;
        }

        if (this.repository) {
            return this.respondToAssignmentDurably(input, 'declined', authCtx);
        }

        const record = this.records.get(input.postUri);
        if (!record) {
            return {
                statusCode: 404,
                body: {
                    error: {
                        code: 'NOT_FOUND',
                        message: `No lifecycle record found for post: ${input.postUri}`,
                    },
                },
            };
        }

        if (!record.assignment || record.assignment.assigneeDid !== input.assigneeDid) {
            return {
                statusCode: 403,
                body: {
                    error: {
                        code: 'ASSIGNMENT_MISMATCH',
                        message: 'This volunteer is not the current assignee.',
                    },
                },
            };
        }

        if (record.assignment.status !== 'pending') {
            return {
                statusCode: 403,
                body: {
                    error: {
                        code: 'ASSIGNMENT_ALREADY_RESPONDED',
                        message: `Assignment already has status '${record.assignment.status}'.`,
                    },
                },
            };
        }

        const now = input.now ?? new Date().toISOString();

        record.assignment.status = 'declined';
        record.assignment.respondedAt = now;
        record.assignment.declineReason = input.reason;

        // Transition back to triaged for reassignment
        const transition = createStatusTransition({
            from: 'assigned',
            to: 'triaged',
            actorDid: input.assigneeDid,
            actorRole: 'volunteer',
            timestamp: now,
            reason: input.reason ?? 'Assignment declined',
        });
        record.currentStatus = 'triaged';
        record.timeline.push(transition);
        record.updatedAt = now;

        return {
            statusCode: 200,
            body: {
                postUri: record.postUri,
                assignment: { ...record.assignment },
                currentStatus: record.currentStatus,
                updatedAt: record.updatedAt,
            },
        };
    }

    private async respondToAssignmentDurably(
        input: z.infer<typeof assignmentResponseSchema>,
        response: 'accepted' | 'declined',
        authCtx?: AuthorizationContext,
    ): Promise<AssignmentResult> {
        if (!authCtx) {
            return {
                statusCode: 401,
                body: {
                    error: {
                        code: 'UNAUTHORIZED',
                        message: 'A durable assignment response requires authentication.',
                    },
                },
            };
        }
        if (!input.commandId) {
            return {
                statusCode: 400,
                body: {
                    error: {
                        code: 'COMMAND_ID_REQUIRED',
                        message:
                            'commandId is required for durable assignment responses.',
                    },
                },
            };
        }
        const now = input.now ?? new Date().toISOString();
        try {
            const outcome = await this.repository!.respondToAssignment({
                commandId: input.commandId,
                postUri: input.postUri,
                assigneeDid: authCtx.actorDid,
                response,
                occurredAt: now,
                ...(input.reason ? { reason: input.reason } : {}),
                auditRetentionUntil: new Date(
                    new Date(now).getTime() + 365 * 24 * 60 * 60 * 1000,
                ).toISOString(),
            });
            return {
                statusCode: 200,
                body: {
                    postUri: input.postUri,
                    assignment: outcome.assignment,
                    currentStatus: outcome.currentStatus,
                    updatedAt: now,
                },
            };
        } catch (error) {
            if (!(error instanceof Error)) throw error;
            if (error.message === 'REQUEST_WORKFLOW_NOT_FOUND') {
                return {
                    statusCode: 404,
                    body: {
                        error: {
                            code: 'NOT_FOUND',
                            message: `No lifecycle record found for post: ${input.postUri}`,
                        },
                    },
                };
            }
            if (
                error.message === 'ASSIGNMENT_MISMATCH' ||
                error.message === 'ASSIGNMENT_ALREADY_RESPONDED'
            ) {
                return {
                    statusCode: 403,
                    body: {
                        error: {
                            code: error.message,
                            message:
                                error.message === 'ASSIGNMENT_MISMATCH'
                                    ? 'This volunteer is not the current assignee.'
                                    : 'Assignment has already been responded to.',
                        },
                    },
                };
            }
            throw error;
        }
    }

    /**
     * Check if the current assignment has timed out. If so, revert to 'triaged'.
     */
    checkAssignmentTimeout(postUri: string, now?: string): AssignmentResult {
        const record = this.records.get(postUri);
        if (!record) {
            return {
                statusCode: 404,
                body: {
                    error: {
                        code: 'NOT_FOUND',
                        message: `No lifecycle record found for post: ${postUri}`,
                    },
                },
            };
        }

        if (!record.assignment || record.assignment.status !== 'pending') {
            return {
                statusCode: 200,
                body: {
                    postUri: record.postUri,
                    assignment: record.assignment
                        ? { ...record.assignment }
                        : {
                              assigneeDid: '',
                              assignerDid: '',
                              assignedAt: '',
                              status: 'pending' as AssignmentStatus,
                              timeoutMs: 0,
                          },
                    currentStatus: record.currentStatus,
                    updatedAt: record.updatedAt,
                },
            };
        }

        const currentTime = now ? new Date(now).getTime() : Date.now();
        const assignedTime = new Date(record.assignment.assignedAt).getTime();
        const elapsed = currentTime - assignedTime;

        if (elapsed < record.assignment.timeoutMs) {
            return {
                statusCode: 200,
                body: {
                    postUri: record.postUri,
                    assignment: { ...record.assignment },
                    currentStatus: record.currentStatus,
                    updatedAt: record.updatedAt,
                },
            };
        }

        // Timed out - revert to triaged
        const timestamp = now ?? new Date().toISOString();
        record.assignment.status = 'timed_out';
        record.assignment.respondedAt = timestamp;

        const transition = createStatusTransition({
            from: 'assigned',
            to: 'triaged',
            actorDid: record.assignment.assignerDid,
            actorRole: 'coordinator',
            timestamp,
            reason: `Assignment to ${record.assignment.assigneeDid} timed out`,
        });
        record.currentStatus = 'triaged';
        record.timeline.push(transition);
        record.updatedAt = timestamp;

        return {
            statusCode: 200,
            body: {
                postUri: record.postUri,
                assignment: { ...record.assignment },
                currentStatus: record.currentStatus,
                updatedAt: record.updatedAt,
            },
        };
    }

    async checkAssignmentTimeoutAsync(
        postUri: string,
        now?: string,
    ): Promise<AssignmentResult> {
        if (!this.repository) {
            return this.checkAssignmentTimeout(postUri, now);
        }
        const workflow = await this.repository.get(postUri);
        if (!workflow) {
            return {
                statusCode: 404,
                body: {
                    error: {
                        code: 'NOT_FOUND',
                        message: `No lifecycle record found for post: ${postUri}`,
                    },
                },
            };
        }
        if (!workflow.assignment) {
            return {
                statusCode: 200,
                body: {
                    postUri,
                    assignment: {
                        assigneeDid: '',
                        assignerDid: '',
                        assignedAt: '',
                        status: 'pending',
                        timeoutMs: 0,
                    },
                    currentStatus: workflow.currentStatus as RequestStatus,
                    updatedAt: workflow.updatedAt,
                },
            };
        }
        const occurredAt = now ?? new Date().toISOString();
        const outcome = await this.repository.expireAssignment({
            commandId: `assignment-timeout-check:${postUri}:${workflow.assignment.assignedAt}`,
            postUri,
            occurredAt,
            auditRetentionUntil: new Date(
                new Date(occurredAt).getTime() + 365 * 24 * 60 * 60 * 1000,
            ).toISOString(),
        });
        return {
            statusCode: 200,
            body: {
                postUri,
                assignment: outcome.assignment,
                currentStatus: outcome.currentStatus,
                updatedAt: outcome.applied ? occurredAt : workflow.updatedAt,
            },
        };
    }

    /**
     * Complete a handoff (fulfillment) for an in-progress request.
     * Transitions to 'resolved' and captures handoff metadata.
     *
     * When `authCtx` is provided, requires 'complete:handoff' capability.
     */
    async completeHandoff(
        body: unknown,
        authCtx?: AuthorizationContext,
    ): Promise<HandoffResult> {
        if (authCtx) {
            try {
                requireCapability(authCtx, 'complete:handoff');
            } catch (err) {
                if (err instanceof AuthorizationError) {
                    return {
                        statusCode: err.statusCode,
                        body: {
                            error: {
                                code: err.code,
                                message: err.message,
                            },
                        },
                    };
                }
                throw err;
            }
        }

        let input: z.infer<typeof handoffInputSchema>;
        try {
            input = handoffInputSchema.parse(body);
        } catch (error) {
            if (error instanceof ZodError) {
                return { statusCode: 400, body: toValidationError(error) };
            }
            throw error;
        }

        if (this.repository) {
            return this.completeHandoffDurably(input, authCtx);
        }

        const record = this.records.get(input.postUri);
        if (!record) {
            return {
                statusCode: 404,
                body: {
                    error: {
                        code: 'NOT_FOUND',
                        message: `No lifecycle record found for post: ${input.postUri}`,
                    },
                },
            };
        }

        if (record.currentStatus !== 'in_progress') {
            return {
                statusCode: 403,
                body: {
                    error: {
                        code: 'TRANSITION_NOT_ALLOWED',
                        message: `Cannot complete handoff for a request in '${record.currentStatus}' status. Must be 'in_progress'.`,
                    },
                },
            };
        }

        if (
            !record.assignment ||
            record.assignment.assigneeDid !== input.assigneeDid
        ) {
            return {
                statusCode: 403,
                body: {
                    error: {
                        code: 'ASSIGNMENT_MISMATCH',
                        message: 'This volunteer is not the current assignee.',
                    },
                },
            };
        }

        const now = input.now ?? new Date().toISOString();

        const handoff: HandoffMetadata = {
            completedBy: input.assigneeDid,
            completedAt: now,
            notes: input.notes,
            recipientConfirmed: input.recipientConfirmed,
            deliveryMethod: input.deliveryMethod,
        };

        record.handoff = handoff;

        const transition = createStatusTransition({
            from: 'in_progress',
            to: 'resolved',
            actorDid: input.assigneeDid,
            actorRole: 'volunteer',
            timestamp: now,
            reason: 'Handoff completed',
        });
        record.currentStatus = 'resolved';
        record.timeline.push(transition);
        record.updatedAt = now;

        return {
            statusCode: 200,
            body: {
                postUri: record.postUri,
                handoff: { ...handoff },
                currentStatus: record.currentStatus,
                updatedAt: record.updatedAt,
            },
        };
    }

    private async completeHandoffDurably(
        input: z.infer<typeof handoffInputSchema>,
        authCtx?: AuthorizationContext,
    ): Promise<HandoffResult> {
        if (!authCtx) {
            return {
                statusCode: 401,
                body: {
                    error: {
                        code: 'UNAUTHORIZED',
                        message: 'A durable handoff requires authentication.',
                    },
                },
            };
        }
        if (!input.commandId) {
            return {
                statusCode: 400,
                body: {
                    error: {
                        code: 'COMMAND_ID_REQUIRED',
                        message: 'commandId is required for durable handoffs.',
                    },
                },
            };
        }
        const now = input.now ?? new Date().toISOString();
        try {
            const outcome = await this.repository!.completeHandoff({
                commandId: input.commandId,
                postUri: input.postUri,
                completedBy: authCtx.actorDid,
                occurredAt: now,
                ...(input.notes === undefined ? {} : { notes: input.notes }),
                ...(input.recipientConfirmed === undefined
                    ? {}
                    : { recipientConfirmed: input.recipientConfirmed }),
                ...(input.deliveryMethod === undefined
                    ? {}
                    : { deliveryMethod: input.deliveryMethod }),
                auditRetentionUntil: new Date(
                    new Date(now).getTime() + 365 * 24 * 60 * 60 * 1000,
                ).toISOString(),
            });
            return {
                statusCode: 200,
                body: {
                    postUri: input.postUri,
                    handoff: outcome.handoff,
                    currentStatus: outcome.currentStatus,
                    updatedAt: now,
                },
            };
        } catch (error) {
            if (!(error instanceof Error)) throw error;
            if (error.message === 'REQUEST_WORKFLOW_NOT_FOUND') {
                return {
                    statusCode: 404,
                    body: {
                        error: {
                            code: 'NOT_FOUND',
                            message: `No lifecycle record found for post: ${input.postUri}`,
                        },
                    },
                };
            }
            if (
                error.message === 'ASSIGNMENT_MISMATCH' ||
                error.message === 'HANDOFF_TRANSITION_NOT_ALLOWED'
            ) {
                return {
                    statusCode: 403,
                    body: {
                        error: {
                            code:
                                error.message === 'ASSIGNMENT_MISMATCH'
                                    ? 'ASSIGNMENT_MISMATCH'
                                    : 'TRANSITION_NOT_ALLOWED',
                            message:
                                error.message === 'ASSIGNMENT_MISMATCH'
                                    ? 'This volunteer is not the current assignee.'
                                    : "Handoff requires an accepted assignment in 'in_progress' status.",
                        },
                    },
                };
            }
            throw error;
        }
    }

    /**
     * Get internal record for testing.
     */
    getRecord(postUri: string): RequestLifecycleRecord | undefined {
        return this.records.get(postUri);
    }

    private async executeTransition(
        input: TransitionInput,
        authCtx?: AuthorizationContext,
    ): Promise<LifecycleTransitionResult> {
        if (this.repository) {
            return this.executeDurableTransition(input, authCtx);
        }
        // Auto-register if the post is not yet tracked
        if (!this.records.has(input.postUri)) {
            this.registerPost(input.postUri);
        }

        const record = this.records.get(input.postUri)!;
        const previousStatus = record.currentStatus;
        const targetStatus = input.targetStatus as RequestStatus;
        const actorRole = input.actorRole as LifecycleRole;

        // Validate the transition with role-aware checks
        const validation = canTransition(
            previousStatus,
            targetStatus,
            actorRole,
        );

        if (!validation.valid) {
            return {
                statusCode: 403,
                body: {
                    error: {
                        code: validation.code,
                        message: validation.message,
                        details: {
                            previousStatus,
                            targetStatus,
                            actorRole,
                        },
                    },
                },
            };
        }

        const now = input.now ?? new Date().toISOString();

        const transition = createStatusTransition({
            from: previousStatus,
            to: targetStatus,
            actorDid: input.actorDid,
            actorRole,
            timestamp: now,
            reason: input.reason,
        });

        // Apply the transition
        record.currentStatus = targetStatus;
        record.timeline.push(transition);
        record.updatedAt = now;

        return {
            statusCode: 200,
            body: {
                postUri: record.postUri,
                previousStatus,
                currentStatus: record.currentStatus,
                transition,
                timeline: [...record.timeline],
                updatedAt: record.updatedAt,
            },
        };
    }

    private async executeDurableTransition(
        input: TransitionInput,
        authCtx?: AuthorizationContext,
    ): Promise<LifecycleTransitionResult> {
        const repository = this.repository;
        if (!repository) {
            throw new Error('DURABLE_LIFECYCLE_REPOSITORY_MISSING');
        }
        if (!authCtx) {
            return {
                statusCode: 401,
                body: {
                    error: {
                        code: 'UNAUTHORIZED',
                        message: 'A durable lifecycle transition requires authentication.',
                    },
                },
            };
        }
        if (!input.commandId) {
            return {
                statusCode: 400,
                body: {
                    error: {
                        code: 'COMMAND_ID_REQUIRED',
                        message: 'commandId is required for durable transitions.',
                    },
                },
            };
        }

        const actorRole: LifecycleRole =
            authCtx.role === 'volunteer' ? 'volunteer'
            : authCtx.role === 'moderator' ? 'moderator'
            : authCtx.role === 'admin' || authCtx.role === 'super_admin' ? 'admin'
            : 'requester';
        const now = input.now ?? new Date().toISOString();
        let workflow = await repository.get(input.postUri);
        if (!workflow) {
            const repositoryOwner = /^at:\/\/(did:[^/]+)\//.exec(
                input.postUri,
            )?.[1];
            if (repositoryOwner !== authCtx.actorDid) {
                return {
                    statusCode: 403,
                    body: {
                        error: {
                            code: 'FORBIDDEN',
                            message: 'Only the repository owner can register lifecycle state.',
                        },
                    },
                };
            }
            await repository.register({
                commandId: `register:${input.postUri}`,
                postUri: input.postUri,
                requesterDid: authCtx.actorDid,
                createdAt: now,
            });
            workflow = await repository.get(input.postUri);
        }
        if (!workflow) {
            throw new Error('REQUEST_WORKFLOW_REGISTER_FAILED');
        }
        if (
            actorRole === 'requester' &&
            workflow.requesterDid !== authCtx.actorDid
        ) {
            return {
                statusCode: 403,
                body: {
                    error: {
                        code: 'FORBIDDEN',
                        message: 'A requester can transition only their own request.',
                    },
                },
            };
        }

        const previousStatus = workflow.currentStatus as RequestStatus;
        const targetStatus = input.targetStatus as RequestStatus;
        const validation = canTransition(previousStatus, targetStatus, actorRole);
        if (!validation.valid) {
            return {
                statusCode: 403,
                body: {
                    error: {
                        code: validation.code,
                        message: validation.message,
                        details: { previousStatus, targetStatus, actorRole },
                    },
                },
            };
        }
        const transition = createStatusTransition({
            from: previousStatus,
            to: targetStatus,
            actorDid: authCtx.actorDid,
            actorRole,
            timestamp: now,
            reason: input.reason,
        });
        await repository.transition({
            commandId: input.commandId,
            postUri: input.postUri,
            actorDid: authCtx.actorDid,
            actorRole,
            fromStatus: previousStatus,
            toStatus: targetStatus,
            occurredAt: now,
            reason: input.reason,
            auditRetentionUntil: new Date(
                new Date(now).getTime() + 365 * 24 * 60 * 60 * 1000,
            ).toISOString(),
        });
        return {
            statusCode: 200,
            body: {
                postUri: input.postUri,
                previousStatus,
                currentStatus: targetStatus,
                transition,
                timeline: [transition],
                updatedAt: now,
            },
        };
    }
}

export const createLifecycleService = (
    repository?: LifecycleRepository,
    projectionReadback?: (uri: string, cid?: string) => Promise<NonNullable<LifecycleQuerySuccessResponse['projectionReceipt']>>,
): LifecycleService => {
    return new LifecycleService(repository, projectionReadback);
};
