import { describe, expect, it, vi } from 'vitest';
import { aidPostSchema, type AidPostRecord } from '@patchwork/at-lexicons';
import { AtClientError } from '@patchwork/at-client';
import {
    AidPostCommandService,
    type AidPostClient,
} from './aid-post-command-service.js';

const record: AidPostRecord = {
    $type: 'app.patchwork.aid.post',
    version: '1.0.0',
    title: 'Meal delivery',
    description: 'A meal delivery is needed this evening.',
    category: 'food',
    urgency: 'medium',
    status: 'open',
    location: { latitude: 41.88, longitude: -87.63, precisionKm: 1 },
    createdAt: '2026-07-10T12:00:00.000Z',
};

const postalRecord = aidPostSchema.parse({ ...record, version: '2.0.0', location: { countryCode: 'US', postalCode: '60625' } });

const client = (): AidPostClient => ({
    create: vi.fn(async value => ({
        uri: 'at://did:plc:alice/app.patchwork.aid.post/3abc',
        cid: 'bafy-created',
        record: value as AidPostRecord,
    })),
    get: vi.fn(async () => ({
        uri: 'at://did:plc:alice/app.patchwork.aid.post/3abc',
        cid: 'bafy-current',
        record,
    })),
    update: vi.fn(async (_uri, _cid, value) => ({
        uri: 'at://did:plc:alice/app.patchwork.aid.post/3abc',
        cid: 'bafy-updated',
        record: value as AidPostRecord,
    })),
    delete: vi.fn(async () => undefined),
});

describe('AidPostCommandService', () => {
    it('does not publish when the pre-publication gate holds the submission', async () => {
        const at = client();
        const safetyGate = {
            review: vi.fn().mockRejectedValue(
                new AtClientError('UPSTREAM_ERROR', 'held for review'),
            ),
        };
        const service = new AidPostCommandService(
            async () => at,
            undefined,
            undefined,
            safetyGate,
        );

        await expect(
            service.create(
                'browser-session',
                postalRecord,
                'idempotency-one',
                'did:plc:alice',
            ),
        ).rejects.toThrow('held for review');
        expect(safetyGate.review).toHaveBeenCalledWith(
            expect.objectContaining({
                actorDid: 'did:plc:alice',
                operation: 'create',
            }),
        );
        expect(at.create).not.toHaveBeenCalled();
    });

    it('creates through the client restored from the opaque browser session', async () => {
        const at = client();
        const factory = vi.fn(async () => at);
        const service = new AidPostCommandService(factory);

        await expect(service.create('browser-session', postalRecord)).resolves.toMatchObject({
            cid: 'bafy-created',
        });
        expect(factory).toHaveBeenCalledWith('browser-session');
        expect(at.create).toHaveBeenCalledWith(postalRecord);
    });

    it('rejects coordinate-only new requests before opening the AT client', async () => {
        const factory = vi.fn(async () => client());
        await expect(new AidPostCommandService(factory).create('session', record)).rejects.toMatchObject({ code: 'POSTAL_CODE_REQUIRED' });
        expect(factory).not.toHaveBeenCalled();
    });

    it('updates with the caller-provided expected CID', async () => {
        const at = client();
        const service = new AidPostCommandService(async () => at);

        await service.update('browser-session', {
            uri: 'at://did:plc:alice/app.patchwork.aid.post/3abc',
            expectedCid: 'bafy-current',
            record: { ...postalRecord, status: 'resolved' },
        });

        expect(at.update).toHaveBeenCalledWith(
            'at://did:plc:alice/app.patchwork.aid.post/3abc',
            'bafy-current',
            { ...postalRecord, status: 'resolved' },
        );
    });

    it('closes the current record using compare-and-swap', async () => {
        const at = client();
        const service = new AidPostCommandService(async () => at);

        await service.close('browser-session', {
            uri: 'at://did:plc:alice/app.patchwork.aid.post/3abc',
            expectedCid: 'bafy-current',
            updatedAt: '2026-07-10T13:00:00.000Z',
        });

        expect(at.get).toHaveBeenCalled();
        expect(at.update).toHaveBeenCalledWith(
            'at://did:plc:alice/app.patchwork.aid.post/3abc',
            'bafy-current',
            { ...record, status: 'closed', updatedAt: '2026-07-10T13:00:00.000Z' },
        );
    });

    it('deletes with compare-and-swap', async () => {
        const at = client();
        const reconciler = { reconcileDeletion: vi.fn().mockResolvedValue({}) };
        const service = new AidPostCommandService(async () => at, reconciler);

        await service.delete('browser-session', {
            uri: 'at://did:plc:alice/app.patchwork.aid.post/3abc',
            expectedCid: 'bafy-current',
        });

        expect(at.delete).toHaveBeenCalledWith(
            'at://did:plc:alice/app.patchwork.aid.post/3abc',
            'bafy-current',
        );
        expect(reconciler.reconcileDeletion).toHaveBeenCalledWith(
            expect.objectContaining({
                commandId: expect.stringContaining('bafy-current'),
                postUri: 'at://did:plc:alice/app.patchwork.aid.post/3abc',
                actorDid: 'did:plc:alice',
            }),
        );
    });

    it('does not reconcile local state when PDS deletion fails', async () => {
        const at = client();
        vi.mocked(at.delete).mockRejectedValue(new Error('stale CID'));
        const reconciler = { reconcileDeletion: vi.fn() };
        const service = new AidPostCommandService(async () => at, reconciler);

        await expect(
            service.delete('browser-session', {
                uri: 'at://did:plc:alice/app.patchwork.aid.post/3abc',
                expectedCid: 'bafy-stale',
            }),
        ).rejects.toThrow('stale CID');
        expect(reconciler.reconcileDeletion).not.toHaveBeenCalled();
    });

    it('reconciles public status from durable workflow state', async () => {
        const at = client();
        const lifecycle = {
            get: vi.fn().mockResolvedValue({ currentStatus: 'in_progress' }),
            markPublicStatusSyncPending: vi.fn().mockResolvedValue(undefined),
            markPublicStatusSyncFailed: vi.fn().mockResolvedValue(undefined),
            recordPublicStatusSync: vi.fn().mockResolvedValue({ applied: true }),
        };
        const service = new AidPostCommandService(
            async () => at,
            undefined,
            lifecycle,
        );

        const result = await service.reconcileStatus('browser-session', {
            uri: 'at://did:plc:alice/app.patchwork.aid.post/3abc',
            expectedCid: 'bafy-current',
            updatedAt: '2026-07-11T02:00:00.000Z',
            status: 'closed',
        });

        expect(lifecycle.get).toHaveBeenCalledWith(
            'at://did:plc:alice/app.patchwork.aid.post/3abc',
        );
        expect(lifecycle.markPublicStatusSyncPending).toHaveBeenCalledWith(
            expect.objectContaining({
                postUri: 'at://did:plc:alice/app.patchwork.aid.post/3abc',
                publicStatus: 'in-progress',
            }),
        );
        expect(at.update).toHaveBeenCalledWith(
            'at://did:plc:alice/app.patchwork.aid.post/3abc',
            'bafy-current',
            {
                ...record,
                status: 'in-progress',
                updatedAt: '2026-07-11T02:00:00.000Z',
            },
        );
        expect(result.record.status).toBe('in-progress');
        expect(lifecycle.recordPublicStatusSync).toHaveBeenCalledWith(
            expect.objectContaining({
                postUri: 'at://did:plc:alice/app.patchwork.aid.post/3abc',
                publicStatus: 'in-progress',
                publicCid: 'bafy-updated',
                actorDid: 'did:plc:alice',
            }),
        );
    });

    it('records a stable failure code when public status reconciliation fails', async () => {
        const at = client();
        vi.mocked(at.update).mockRejectedValue(
            new AtClientError('PDS_UNAVAILABLE', 'PDS unavailable', {
                retryable: true,
            }),
        );
        const lifecycle = {
            get: vi.fn().mockResolvedValue({ currentStatus: 'resolved' }),
            markPublicStatusSyncPending: vi.fn().mockResolvedValue(undefined),
            markPublicStatusSyncFailed: vi.fn().mockResolvedValue(undefined),
            recordPublicStatusSync: vi.fn(),
        };
        const service = new AidPostCommandService(
            async () => at,
            undefined,
            lifecycle,
        );

        await expect(
            service.reconcileStatus('browser-session', {
                uri: 'at://did:plc:alice/app.patchwork.aid.post/3abc',
                expectedCid: 'bafy-current',
                updatedAt: '2026-07-11T02:05:00.000Z',
            }),
        ).rejects.toMatchObject({ code: 'PDS_UNAVAILABLE', retryable: true });
        expect(lifecycle.markPublicStatusSyncFailed).toHaveBeenCalledWith(
            expect.objectContaining({
                postUri: 'at://did:plc:alice/app.patchwork.aid.post/3abc',
                publicStatus: 'resolved',
                errorCode: 'PDS_UNAVAILABLE',
            }),
        );
        expect(lifecycle.recordPublicStatusSync).not.toHaveBeenCalled();
    });
});
