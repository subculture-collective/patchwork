import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresLifecycleRepository } from './lifecycle-repository.js';
import { PostgresBlockRepository } from './block-repository.js';
import { PostgresReportRepository } from './report-repository.js';
import { PostgresRoleRepository } from './role-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('core operational PostgreSQL state', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const lifecycle = new PostgresLifecycleRepository(pool);
    const blocks = new PostgresBlockRepository(pool);
    const reports = new PostgresReportRepository(pool);
    const roles = new PostgresRoleRepository(pool);
    const postUri = 'at://did:plc:alice/app.patchwork.aid.post/durable';

    beforeAll(async () => {
        const migration = await readFile(
            new URL('./migrations/0003_core_operational_state.sql', import.meta.url),
            'utf8',
        );
        await pool.query(migration);
        await pool.query(
            await readFile(
                new URL('./migrations/0004_lifecycle_timeline.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('./migrations/0005_lifecycle_assignments.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('./migrations/0006_assignment_responses.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('./migrations/0007_lifecycle_handoffs.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('./migrations/0008_platform_roles.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('./migrations/0009_public_status_sync.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('./migrations/0010_public_sync_state.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            'TRUNCATE platform_roles, operational_audit_events, abuse_reports, user_blocks, request_handoff_events, request_assignment_events, request_transition_events, request_workflows RESTART IDENTITY CASCADE',
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    it('survives repository restart and deduplicates command IDs', async () => {
        await expect(
            lifecycle.register({
                commandId: 'register-durable',
                postUri,
                requesterDid: 'did:plc:alice',
                createdAt: '2026-07-10T22:40:00.000Z',
            }),
        ).resolves.toBe(true);
        await expect(
            new PostgresLifecycleRepository(pool).register({
                commandId: 'register-durable',
                postUri,
                requesterDid: 'did:plc:alice',
                createdAt: '2026-07-10T22:40:00.000Z',
            }),
        ).resolves.toBe(false);
        await expect(new PostgresLifecycleRepository(pool).get(postUri)).resolves
            .toMatchObject({ currentStatus: 'open' });
    });

    it('defaults unknown DIDs to user and resolves provisioned roles after restart', async () => {
        await expect(roles.resolve('did:plc:unknown')).resolves.toBe('user');
        await roles.set({
            did: 'did:plc:volunteer',
            role: 'volunteer',
            updatedBy: 'did:plc:operator',
            updatedAt: '2026-07-10T22:40:00.000Z',
        });
        await expect(
            new PostgresRoleRepository(pool).resolve('did:plc:volunteer'),
        ).resolves.toBe('volunteer');
    });

    it('records public status synchronization and returned CID idempotently', async () => {
        const syncUri =
            'at://did:plc:alice/app.patchwork.aid.post/public-status-sync';
        await lifecycle.register({
            commandId: 'register-public-status-sync',
            postUri: syncUri,
            requesterDid: 'did:plc:alice',
            createdAt: '2026-07-11T02:00:00.000Z',
        });
        const command = {
            commandId: 'sync-public-status:bafy-synced',
            postUri: syncUri,
            actorDid: 'did:plc:alice',
            publicStatus: 'in-progress' as const,
            publicCid: 'bafy-synced',
            occurredAt: '2026-07-11T02:01:00.000Z',
            auditRetentionUntil: '2027-07-11T02:01:00.000Z',
        };

        await lifecycle.markPublicStatusSyncPending({
            postUri: syncUri,
            actorDid: 'did:plc:alice',
            publicStatus: 'in-progress',
            occurredAt: '2026-07-11T02:00:30.000Z',
        });
        await expect(lifecycle.get(syncUri)).resolves.toMatchObject({
            publicSyncState: 'pending',
        });
        await lifecycle.markPublicStatusSyncFailed({
            postUri: syncUri,
            actorDid: 'did:plc:alice',
            publicStatus: 'in-progress',
            occurredAt: '2026-07-11T02:00:45.000Z',
            errorCode: 'PDS_UNAVAILABLE',
        });
        await expect(lifecycle.get(syncUri)).resolves.toMatchObject({
            publicSyncState: 'failed',
            publicSyncErrorCode: 'PDS_UNAVAILABLE',
        });

        await expect(lifecycle.recordPublicStatusSync(command)).resolves.toEqual({
            applied: true,
        });
        await expect(
            new PostgresLifecycleRepository(pool).recordPublicStatusSync(command),
        ).resolves.toEqual({ applied: false });
        await expect(lifecycle.get(syncUri)).resolves.toMatchObject({
            publicStatus: 'in-progress',
            publicCid: 'bafy-synced',
            publicSyncedAt: '2026-07-11T02:01:00.000Z',
            publicSyncState: 'synced',
        });
    });

    it('rolls back a conflicting transition without changing workflow state', async () => {
        const command = {
            commandId: 'durable-transition',
            postUri,
            actorDid: 'did:plc:alice',
            actorRole: 'requester',
            fromStatus: 'open',
            toStatus: 'triaged',
            occurredAt: '2026-07-10T22:41:00.000Z',
        };
        const applied = await lifecycle.transition(command);
        await expect(
            new PostgresLifecycleRepository(pool).transition(command),
        ).resolves.toEqual({
            applied: false,
            transitionId: applied.transitionId,
        });
        const auditCount = await pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
             FROM operational_audit_events
             WHERE command_id = $1`,
            ['audit:durable-transition'],
        );
        expect(auditCount.rows[0]?.count).toBe('1');
        await expect(
            new PostgresLifecycleRepository(pool).get(postUri),
        ).resolves.toMatchObject({
            currentStatus: 'triaged',
            timeline: [
                {
                    from: 'open',
                    to: 'triaged',
                    actorDid: 'did:plc:alice',
                    actorRole: 'requester',
                    timestamp: '2026-07-10T22:41:00.000Z',
                },
            ],
        });

        await expect(
            lifecycle.transition({
                commandId: 'conflicting-transition',
                postUri,
                actorDid: 'did:plc:alice',
                fromStatus: 'assigned',
                toStatus: 'resolved',
                occurredAt: '2026-07-10T22:41:00.000Z',
            }),
        ).rejects.toThrow('LIFECYCLE_REVISION_CONFLICT');
        await expect(lifecycle.get(postUri)).resolves.toMatchObject({
            currentStatus: 'triaged',
        });
    });

    it('serializes competing transitions so only one revision wins', async () => {
        const concurrentUri =
            'at://did:plc:alice/app.patchwork.aid.post/concurrent-transition';
        await lifecycle.register({
            commandId: 'register-concurrent-transition',
            postUri: concurrentUri,
            requesterDid: 'did:plc:alice',
            createdAt: '2026-07-10T22:41:30.000Z',
        });

        const outcomes = await Promise.allSettled([
            lifecycle.transition({
                commandId: 'concurrent-transition-triaged',
                postUri: concurrentUri,
                actorDid: 'did:plc:alice',
                actorRole: 'requester',
                fromStatus: 'open',
                toStatus: 'triaged',
                occurredAt: '2026-07-10T22:42:00.000Z',
            }),
            new PostgresLifecycleRepository(pool).transition({
                commandId: 'concurrent-transition-resolved',
                postUri: concurrentUri,
                actorDid: 'did:plc:alice',
                actorRole: 'requester',
                fromStatus: 'open',
                toStatus: 'resolved',
                occurredAt: '2026-07-10T22:42:00.000Z',
            }),
        ]);

        expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
        const stored = await lifecycle.get(concurrentUri);
        expect(stored?.timeline).toHaveLength(1);
        expect(['triaged', 'resolved']).toContain(stored?.currentStatus);
    });

    it('persists assignment metadata atomically and deduplicates retries', async () => {
        const assignedUri =
            'at://did:plc:alice/app.patchwork.aid.post/durable-assignment';
        await lifecycle.register({
            commandId: 'register-assignment',
            postUri: assignedUri,
            requesterDid: 'did:plc:alice',
            createdAt: '2026-07-10T22:44:00.000Z',
        });
        await lifecycle.transition({
            commandId: 'triage-assignment',
            postUri: assignedUri,
            actorDid: 'did:plc:coordinator',
            actorRole: 'coordinator',
            fromStatus: 'open',
            toStatus: 'triaged',
            occurredAt: '2026-07-10T22:45:00.000Z',
        });
        const command = {
            commandId: 'assign-volunteer',
            postUri: assignedUri,
            assignerDid: 'did:plc:coordinator',
            assigneeDid: 'did:plc:volunteer',
            occurredAt: '2026-07-10T22:46:00.000Z',
            timeoutMs: 1_800_000,
        };

        await expect(lifecycle.assign(command)).resolves.toMatchObject({
            applied: true,
            assignment: { status: 'pending' },
        });
        await expect(
            new PostgresLifecycleRepository(pool).assign(command),
        ).resolves.toMatchObject({ applied: false });
        await expect(lifecycle.get(assignedUri)).resolves.toMatchObject({
            currentStatus: 'assigned',
            assignment: {
                assigneeDid: 'did:plc:volunteer',
                assignerDid: 'did:plc:coordinator',
                status: 'pending',
            },
        });
    });

    it('deduplicates simultaneous delivery of the same assignment command', async () => {
        const concurrentUri =
            'at://did:plc:alice/app.patchwork.aid.post/concurrent-assignment';
        await lifecycle.register({
            commandId: 'register-concurrent-assignment',
            postUri: concurrentUri,
            requesterDid: 'did:plc:alice',
            createdAt: '2026-07-10T22:44:00.000Z',
        });
        await lifecycle.transition({
            commandId: 'triage-concurrent-assignment',
            postUri: concurrentUri,
            actorDid: 'did:plc:coordinator',
            actorRole: 'coordinator',
            fromStatus: 'open',
            toStatus: 'triaged',
            occurredAt: '2026-07-10T22:45:00.000Z',
        });
        const command = {
            commandId: 'assign-concurrent-volunteer',
            postUri: concurrentUri,
            assignerDid: 'did:plc:coordinator',
            assigneeDid: 'did:plc:volunteer',
            occurredAt: '2026-07-10T22:46:00.000Z',
            timeoutMs: 1_800_000,
        };

        const outcomes = await Promise.all([
            lifecycle.assign(command),
            new PostgresLifecycleRepository(pool).assign(command),
        ]);

        expect(outcomes.map(outcome => outcome.applied).sort()).toEqual([
            false,
            true,
        ]);
        const rows = await pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM request_assignment_events
             WHERE command_id = $1`,
            [command.commandId],
        );
        expect(rows.rows[0]?.count).toBe('1');
    });

    it('persists assignment acceptance and deduplicates retries', async () => {
        const acceptedUri =
            'at://did:plc:alice/app.patchwork.aid.post/accepted-assignment';
        await lifecycle.register({
            commandId: 'register-accepted-assignment',
            postUri: acceptedUri,
            requesterDid: 'did:plc:alice',
            createdAt: '2026-07-10T22:47:00.000Z',
        });
        await lifecycle.transition({
            commandId: 'triage-accepted-assignment',
            postUri: acceptedUri,
            actorDid: 'did:plc:coordinator',
            actorRole: 'coordinator',
            fromStatus: 'open',
            toStatus: 'triaged',
            occurredAt: '2026-07-10T22:48:00.000Z',
        });
        await lifecycle.assign({
            commandId: 'assign-accepted-volunteer',
            postUri: acceptedUri,
            assignerDid: 'did:plc:coordinator',
            assigneeDid: 'did:plc:volunteer',
            occurredAt: '2026-07-10T22:49:00.000Z',
            timeoutMs: 1_800_000,
        });
        const command = {
            commandId: 'accept-volunteer-assignment',
            postUri: acceptedUri,
            assigneeDid: 'did:plc:volunteer',
            response: 'accepted' as const,
            occurredAt: '2026-07-10T22:50:00.000Z',
        };

        await expect(lifecycle.respondToAssignment(command)).resolves.toMatchObject({
            applied: true,
            assignment: { status: 'accepted' },
            currentStatus: 'in_progress',
        });
        await expect(
            new PostgresLifecycleRepository(pool).respondToAssignment(command),
        ).resolves.toMatchObject({ applied: false });
        await expect(
            new PostgresLifecycleRepository(pool).get(acceptedUri),
        ).resolves.toMatchObject({
            currentStatus: 'in_progress',
            assignment: {
                assigneeDid: 'did:plc:volunteer',
                status: 'accepted',
                respondedAt: '2026-07-10T22:50:00.000Z',
            },
            timeline: expect.arrayContaining([
                expect.objectContaining({
                    from: 'assigned',
                    to: 'in_progress',
                    actorDid: 'did:plc:volunteer',
                }),
            ]),
        });
    });

    it('persists assignment decline and returns the request for reassignment', async () => {
        const declinedUri =
            'at://did:plc:alice/app.patchwork.aid.post/declined-assignment';
        await lifecycle.register({
            commandId: 'register-declined-assignment',
            postUri: declinedUri,
            requesterDid: 'did:plc:alice',
            createdAt: '2026-07-10T22:51:00.000Z',
        });
        await lifecycle.transition({
            commandId: 'triage-declined-assignment',
            postUri: declinedUri,
            actorDid: 'did:plc:coordinator',
            actorRole: 'coordinator',
            fromStatus: 'open',
            toStatus: 'triaged',
            occurredAt: '2026-07-10T22:52:00.000Z',
        });
        await lifecycle.assign({
            commandId: 'assign-declined-volunteer',
            postUri: declinedUri,
            assignerDid: 'did:plc:coordinator',
            assigneeDid: 'did:plc:volunteer',
            occurredAt: '2026-07-10T22:53:00.000Z',
            timeoutMs: 1_800_000,
        });

        await expect(
            lifecycle.respondToAssignment({
                commandId: 'decline-volunteer-assignment',
                postUri: declinedUri,
                assigneeDid: 'did:plc:volunteer',
                response: 'declined',
                reason: 'Schedule conflict',
                occurredAt: '2026-07-10T22:54:00.000Z',
            }),
        ).resolves.toMatchObject({
            applied: true,
            assignment: {
                status: 'declined',
                declineReason: 'Schedule conflict',
            },
            currentStatus: 'triaged',
        });
        await expect(lifecycle.get(declinedUri)).resolves.toMatchObject({
            currentStatus: 'triaged',
            timeline: expect.arrayContaining([
                expect.objectContaining({
                    from: 'assigned',
                    to: 'triaged',
                    reason: 'Schedule conflict',
                }),
            ]),
        });
    });

    it('persists completed handoff metadata and deduplicates retries', async () => {
        const handoffUri =
            'at://did:plc:alice/app.patchwork.aid.post/completed-handoff';
        await lifecycle.register({
            commandId: 'register-completed-handoff',
            postUri: handoffUri,
            requesterDid: 'did:plc:alice',
            createdAt: '2026-07-10T22:55:00.000Z',
        });
        await lifecycle.transition({
            commandId: 'triage-completed-handoff',
            postUri: handoffUri,
            actorDid: 'did:plc:coordinator',
            actorRole: 'coordinator',
            fromStatus: 'open',
            toStatus: 'triaged',
            occurredAt: '2026-07-10T22:56:00.000Z',
        });
        await lifecycle.assign({
            commandId: 'assign-completed-handoff',
            postUri: handoffUri,
            assignerDid: 'did:plc:coordinator',
            assigneeDid: 'did:plc:volunteer',
            occurredAt: '2026-07-10T22:57:00.000Z',
            timeoutMs: 1_800_000,
        });
        await lifecycle.respondToAssignment({
            commandId: 'accept-completed-handoff',
            postUri: handoffUri,
            assigneeDid: 'did:plc:volunteer',
            response: 'accepted',
            occurredAt: '2026-07-10T22:58:00.000Z',
        });
        const command = {
            commandId: 'complete-volunteer-handoff',
            postUri: handoffUri,
            completedBy: 'did:plc:volunteer',
            occurredAt: '2026-07-10T23:00:00.000Z',
            notes: 'Delivered to the front desk',
            recipientConfirmed: true,
            deliveryMethod: 'in_person' as const,
        };

        await expect(lifecycle.completeHandoff(command)).resolves.toMatchObject({
            applied: true,
            handoff: {
                completedBy: 'did:plc:volunteer',
                notes: 'Delivered to the front desk',
                recipientConfirmed: true,
                deliveryMethod: 'in_person',
            },
            currentStatus: 'resolved',
        });
        await expect(
            new PostgresLifecycleRepository(pool).completeHandoff(command),
        ).resolves.toMatchObject({ applied: false });
        await expect(lifecycle.get(handoffUri)).resolves.toMatchObject({
            currentStatus: 'resolved',
            handoff: {
                completedBy: 'did:plc:volunteer',
                completedAt: '2026-07-10T23:00:00.000Z',
            },
            timeline: expect.arrayContaining([
                expect.objectContaining({
                    from: 'in_progress',
                    to: 'resolved',
                    actorDid: 'did:plc:volunteer',
                }),
            ]),
        });
    });

    it('expires overdue assignments atomically and deduplicates retries', async () => {
        const timeoutUri =
            'at://did:plc:alice/app.patchwork.aid.post/timed-out-assignment';
        await lifecycle.register({
            commandId: 'register-timed-out-assignment',
            postUri: timeoutUri,
            requesterDid: 'did:plc:alice',
            createdAt: '2026-07-10T23:01:00.000Z',
        });
        await lifecycle.transition({
            commandId: 'triage-timed-out-assignment',
            postUri: timeoutUri,
            actorDid: 'did:plc:coordinator',
            actorRole: 'coordinator',
            fromStatus: 'open',
            toStatus: 'triaged',
            occurredAt: '2026-07-10T23:02:00.000Z',
        });
        await lifecycle.assign({
            commandId: 'assign-timed-out-volunteer',
            postUri: timeoutUri,
            assignerDid: 'did:plc:coordinator',
            assigneeDid: 'did:plc:volunteer',
            occurredAt: '2026-07-10T23:03:00.000Z',
            timeoutMs: 1_800_000,
        });
        const command = {
            commandId: 'expire-timed-out-volunteer',
            postUri: timeoutUri,
            occurredAt: '2026-07-10T23:34:00.000Z',
        };

        await expect(lifecycle.expireAssignment(command)).resolves.toMatchObject({
            applied: true,
            assignment: { status: 'timed_out' },
            currentStatus: 'triaged',
        });
        await expect(
            new PostgresLifecycleRepository(pool).expireAssignment(command),
        ).resolves.toMatchObject({ applied: false });
        await expect(lifecycle.get(timeoutUri)).resolves.toMatchObject({
            currentStatus: 'triaged',
            assignment: {
                assigneeDid: 'did:plc:volunteer',
                status: 'timed_out',
                respondedAt: '2026-07-10T23:34:00.000Z',
            },
            timeline: expect.arrayContaining([
                expect.objectContaining({
                    from: 'assigned',
                    to: 'triaged',
                    actorRole: 'coordinator',
                }),
            ]),
        });
    });

    it('reconciles confirmed record deletion and retains one audit marker', async () => {
        const deletedUri =
            'at://did:plc:alice/app.patchwork.aid.post/deleted-workflow';
        await lifecycle.register({
            commandId: 'register-deleted-workflow',
            postUri: deletedUri,
            requesterDid: 'did:plc:alice',
            createdAt: '2026-07-10T23:35:00.000Z',
        });
        await lifecycle.transition({
            commandId: 'triage-deleted-workflow',
            postUri: deletedUri,
            actorDid: 'did:plc:coordinator',
            actorRole: 'coordinator',
            fromStatus: 'open',
            toStatus: 'triaged',
            occurredAt: '2026-07-10T23:35:10.000Z',
        });
        await lifecycle.assign({
            commandId: 'assign-deleted-workflow',
            postUri: deletedUri,
            assignerDid: 'did:plc:coordinator',
            assigneeDid: 'did:plc:volunteer',
            occurredAt: '2026-07-10T23:35:20.000Z',
            timeoutMs: 1_800_000,
        });
        const command = {
            commandId: 'reconcile-delete:bafy-deleted-workflow',
            postUri: deletedUri,
            actorDid: 'did:plc:alice',
            occurredAt: '2026-07-10T23:36:00.000Z',
            auditRetentionUntil: '2027-07-10T23:36:00.000Z',
        };

        await expect(lifecycle.reconcileDeletion(command)).resolves.toEqual({
            applied: true,
            removed: true,
        });
        await expect(
            new PostgresLifecycleRepository(pool).reconcileDeletion(command),
        ).resolves.toEqual({ applied: false, removed: true });
        await expect(lifecycle.get(deletedUri)).resolves.toBeUndefined();
        const assignmentRows = await pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM request_assignment_events
             WHERE post_uri = $1`,
            [deletedUri],
        );
        expect(assignmentRows.rows[0]?.count).toBe('0');
        const auditRows = await pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM operational_audit_events
             WHERE command_id = $1 AND action = 'request.record_deleted'`,
            [command.commandId],
        );
        expect(auditRows.rows[0]?.count).toBe('1');
    });

    it('soft-deletes private block/report subject data', async () => {
        await blocks.create({
            commandId: 'block-1',
            blockerDid: 'did:plc:alice',
            subjectDid: 'did:plc:bob',
            createdAt: '2026-07-10T22:42:00.000Z',
        });
        await reports.create({
            commandId: 'report-1',
            reporterDid: 'did:plc:alice',
            subjectUri: postUri,
            subjectDid: 'did:plc:bob',
            reason: 'spam',
            details: 'Private report detail',
            retentionUntil: '2026-10-10T22:42:00.000Z',
            createdAt: '2026-07-10T22:42:00.000Z',
        });

        await expect(
            blocks.deleteSubject('did:plc:bob', '2026-07-10T22:43:00.000Z'),
        ).resolves.toBe(1);
        await expect(
            reports.deleteSubject(postUri, '2026-07-10T22:43:00.000Z'),
        ).resolves.toBe(1);
        await expect(blocks.isBlocked('did:plc:alice', 'did:plc:bob')).resolves
            .toBe(false);
        const report = await pool.query<{ details: string | null }>(
            'SELECT details FROM abuse_reports WHERE command_id = $1',
            ['report-1'],
        );
        expect(report.rows[0]?.details).toBeNull();
    });
});
