import {
    aidPostSchema,
    type AidPostRecord,
} from '@patchwork/at-lexicons';
import { AtClientError, type AidPostRecordResult } from '@patchwork/at-client';
import { z } from 'zod';
import type { PublicSubmissionSafetyGate } from '../public-submission-safety.js';
import { PublicHttpError } from '../http/error-response.js';

export interface AidPostClient {
    create(record: unknown, rkey?: string): Promise<AidPostRecordResult>;
    get(uri: string): Promise<AidPostRecordResult>;
    update(
        uri: string,
        expectedCid: string,
        record: unknown,
    ): Promise<AidPostRecordResult>;
    delete(uri: string, expectedCid: string): Promise<void>;
}

export type AidPostClientFactory = (
    sessionToken: string,
) => Promise<AidPostClient>;

export interface AidPostDeletionReconciler {
    reconcileDeletion(command: {
        commandId: string;
        postUri: string;
        actorDid: string;
        occurredAt: string;
        auditRetentionUntil: string;
    }): Promise<unknown>;
}

export interface AidPostLifecycleStatusSource {
    get(postUri: string): Promise<
        | {
              currentStatus: string;
          }
        | undefined
    >;
    recordPublicStatusSync(command: {
        commandId: string;
        postUri: string;
        actorDid: string;
        publicStatus: AidPostRecord['status'];
        publicCid: string;
        occurredAt: string;
        auditRetentionUntil: string;
    }): Promise<unknown>;
    markPublicStatusSyncPending(command: {
        postUri: string;
        actorDid: string;
        publicStatus: AidPostRecord['status'];
        occurredAt: string;
    }): Promise<void>;
    markPublicStatusSyncFailed(command: {
        postUri: string;
        actorDid: string;
        publicStatus: AidPostRecord['status'];
        occurredAt: string;
        errorCode: string;
    }): Promise<void>;
}

const uriSchema = z.string().regex(/^at:\/\/[^/]+\/app\.patchwork\.aid\.post\/[^/]+$/);

const mutationReferenceSchema = z.object({
    uri: uriSchema,
    expectedCid: z.string().min(1),
});

const updateCommandSchema = mutationReferenceSchema.extend({
    record: z.unknown(),
});

const closeCommandSchema = mutationReferenceSchema.extend({
    updatedAt: z.string().datetime({ offset: true }),
});

const reconcileStatusCommandSchema = mutationReferenceSchema.extend({
    updatedAt: z.string().datetime({ offset: true }),
});

const toPublicStatus = (
    privateStatus: string,
): AidPostRecord['status'] => {
    switch (privateStatus) {
        case 'open':
        case 'triaged':
            return 'open';
        case 'assigned':
        case 'in_progress':
            return 'in-progress';
        case 'resolved':
            return 'resolved';
        case 'archived':
            return 'closed';
        default:
            throw new AtClientError(
                'UPSTREAM_ERROR',
                `Unsupported private lifecycle status '${privateStatus}'.`,
            );
    }
};

export class AidPostCommandService {
    constructor(
        private readonly clientFactory: AidPostClientFactory,
        private readonly deletionReconciler?: AidPostDeletionReconciler,
        private readonly lifecycleStatusSource?: AidPostLifecycleStatusSource,
        private readonly safetyGate?: PublicSubmissionSafetyGate,
    ) {}

    async create(
        sessionToken: string,
        record: unknown,
        idempotencyKey?: string,
        actorDid?: string,
    ): Promise<AidPostRecordResult> {
        const parsed = aidPostSchema.parse(record);
        if (!parsed.location.postalCode || parsed.version !== '2.0.0') {
            throw new PublicHttpError(400, 'POSTAL_CODE_REQUIRED', 'A five-digit ZIP code is required to publish a request.');
        }
        const client = await this.clientFactory(sessionToken);
        const rkey =
            idempotencyKey ?
                `pw${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 22)}`
            :   undefined;
        if (this.safetyGate) {
            if (!rkey || !actorDid || !idempotencyKey) {
                throw new PublicHttpError(
                    503,
                    'SUBMISSION_SAFETY_UNAVAILABLE',
                    'Publication safety checks are unavailable. Nothing was published.',
                );
            }
            await this.safetyGate.review({
                actorDid,
                subjectUri:
                    `at://${actorDid}/app.patchwork.aid.post/${rkey}`,
                submissionType: 'aid-post',
                operation: 'create',
                record: parsed as unknown as Record<string, unknown>,
                idempotencyKey:
                    `aid-post:create:${idempotencyKey}`,
            });
        }
        return rkey ? client.create(parsed, rkey) : client.create(parsed);
    }

    async get(
        sessionToken: string,
        uri: string,
    ): Promise<AidPostRecordResult> {
        const client = await this.clientFactory(sessionToken);
        return client.get(uriSchema.parse(uri));
    }

    async update(
        sessionToken: string,
        input: unknown,
        idempotencyKey?: string,
    ): Promise<AidPostRecordResult> {
        const command = updateCommandSchema.parse(input);
        const record = aidPostSchema.parse(command.record);
        if (!record.location.postalCode || record.version !== '2.0.0') {
            throw new PublicHttpError(400, 'POSTAL_CODE_REQUIRED', 'Choose a five-digit ZIP code before editing this request.');
        }
        if (this.safetyGate) {
            if (!idempotencyKey) {
                throw new PublicHttpError(
                    503,
                    'SUBMISSION_SAFETY_UNAVAILABLE',
                    'Publication safety checks are unavailable. Nothing was published.',
                );
            }
            await this.safetyGate.review({
                actorDid: command.uri.slice(5).split('/')[0]!,
                subjectUri: command.uri,
                submissionType: 'aid-post',
                operation: 'update',
                record: record as unknown as Record<string, unknown>,
                idempotencyKey: `aid-post:update:${idempotencyKey}`,
            });
        }
        const client = await this.clientFactory(sessionToken);
        return client.update(
            command.uri,
            command.expectedCid,
            record,
        );
    }

    async close(
        sessionToken: string,
        input: unknown,
    ): Promise<AidPostRecordResult> {
        const command = closeCommandSchema.parse(input);
        const client = await this.clientFactory(sessionToken);
        const current = await client.get(command.uri);
        const closed: AidPostRecord = {
            ...current.record,
            status: 'closed',
            updatedAt: command.updatedAt,
        };
        return client.update(command.uri, command.expectedCid, closed);
    }

    async reconcileStatus(
        sessionToken: string,
        input: unknown,
    ): Promise<AidPostRecordResult> {
        const command = reconcileStatusCommandSchema.parse(input);
        const lifecycleStatusSource = this.lifecycleStatusSource;
        if (!lifecycleStatusSource) {
            throw new AtClientError(
                'UPSTREAM_ERROR',
                'Durable lifecycle status reconciliation is unavailable.',
            );
        }
        const workflow = await lifecycleStatusSource.get(command.uri);
        if (!workflow) {
            throw new AtClientError(
                'NOT_FOUND',
                'No durable lifecycle workflow exists for this aid-post.',
            );
        }
        const status = toPublicStatus(workflow.currentStatus);
        const actorDid = command.uri.slice('at://'.length).split('/')[0]!;
        await lifecycleStatusSource.markPublicStatusSyncPending({
            postUri: command.uri,
            actorDid,
            publicStatus: status,
            occurredAt: command.updatedAt,
        });
        try {
            const client = await this.clientFactory(sessionToken);
            const current = await client.get(command.uri);
            const result =
                current.record.status === status
                    ? current
                    : await client.update(command.uri, command.expectedCid, {
                          ...current.record,
                          status,
                          updatedAt: command.updatedAt,
                      });
            await lifecycleStatusSource.recordPublicStatusSync({
                commandId: `public-status-sync:${command.uri}:${result.cid}`,
                postUri: command.uri,
                actorDid,
                publicStatus: status,
                publicCid: result.cid,
                occurredAt: command.updatedAt,
                auditRetentionUntil: new Date(
                    new Date(command.updatedAt).getTime() + 365 * 24 * 60 * 60 * 1000,
                ).toISOString(),
            });
            return result;
        } catch (error) {
            try {
                await lifecycleStatusSource.markPublicStatusSyncFailed({
                    postUri: command.uri,
                    actorDid,
                    publicStatus: status,
                    occurredAt: command.updatedAt,
                    errorCode:
                        error instanceof AtClientError
                            ? error.code
                            : 'SYNC_CHECKPOINT_FAILED',
                });
            } catch {
                // Preserve the original PDS or checkpoint failure for the caller.
            }
            throw error;
        }
    }

    async delete(sessionToken: string, input: unknown): Promise<void> {
        const command = mutationReferenceSchema.parse(input);
        const client = await this.clientFactory(sessionToken);
        await client.delete(command.uri, command.expectedCid);
        if (this.deletionReconciler) {
            const occurredAt = new Date().toISOString();
            const actorDid = command.uri.slice('at://'.length).split('/')[0]!;
            await this.deletionReconciler.reconcileDeletion({
                commandId: `record-delete:${command.uri}:${command.expectedCid}`,
                postUri: command.uri,
                actorDid,
                occurredAt,
                auditRetentionUntil: new Date(
                    new Date(occurredAt).getTime() + 365 * 24 * 60 * 60 * 1000,
                ).toISOString(),
            });
        }
    }
}
import { createHash } from 'node:crypto';
