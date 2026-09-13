import { Pool } from 'pg';
import { afterAll, beforeEach, describe, it, expect } from 'vitest';
import { SavedDiscoveryService } from './saved-discovery-service.js';
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const service = new SavedDiscoveryService(pool);
describe('private saved discovery', () => {
    beforeEach(async () => {
        await pool.query('TRUNCATE saved_discovery');
    });
    afterAll(async () => pool.end());
    it('deduplicates concurrent saves and isolates listing and removal by owner', async () => {
        const input = {
            kind: 'search',
            search: { postalCode: '60608', resourceProgram: 'wic' },
        };
        const [first, second] = await Promise.all([
            service.save('did:plc:saved-alice', input),
            service.save('did:plc:saved-alice', input),
        ]);
        expect(second.id).toBe(first.id);
        expect((await service.list('did:plc:saved-alice')).items).toHaveLength(
            1,
        );
        expect((await service.list('did:plc:saved-bob')).items).toEqual([]);
        await service.remove('did:plc:saved-bob', { id: first.id });
        expect((await service.list('did:plc:saved-alice')).items).toHaveLength(
            1,
        );
        await service.remove('did:plc:saved-alice', { id: first.id });
        await service.remove('did:plc:saved-alice', { id: first.id });
        expect((await service.list('did:plc:saved-alice')).items).toEqual([]);
    });
    it('rejects sensitive extra fields before any persistence and refuses missing resources', async () => {
        await expect(
            service.save('did:plc:saved-alice', {
                kind: 'search',
                search: { postalCode: '60608', eligibility: { income: 500 } },
            }),
        ).rejects.toThrow();
        await expect(
            service.save('did:plc:saved-alice', {
                kind: 'resource',
                resourceUri:
                    'at://did:plc:missing/app.patchwork.directory.resource/nope',
            }),
        ).rejects.toThrow('no longer available');
        expect((await service.list('did:plc:saved-alice')).items).toEqual([]);
    });
    it('establishes a baseline, emits one private daily digest and stops checks after opt-out', async () => {
        const did = 'did:plc:digest';
        await pool.query(
            'DELETE FROM notification_intents WHERE recipient_did=$1',
            [did],
        );
        await pool.query(
            "DELETE FROM indexer_directory_resource_projections WHERE uri LIKE 'at://did:plc:digest/%'",
        );
        const saved = await service.save(did, {
            kind: 'search',
            search: { text: 'digesttestclinic' },
        });
        await service.setAlerts(did, { id: saved.id, enabled: true });
        const now = new Date(Date.now() + 1000);
        await service.runDigestSweep(now);
        expect(
            (
                await pool.query(
                    'SELECT count(*)::integer AS count FROM notification_intents WHERE recipient_did=$1',
                    [did],
                )
            ).rows[0].count,
        ).toBe(0);
        await pool.query(`INSERT INTO indexer_directory_resource_projections(uri,collection,author_did_hash,name,service_area,category,verification_status,contact,searchable_text,operational_status,record_created_at,record_updated_at,source_cursor,source_event_id)
            VALUES('at://did:plc:digest/app.patchwork.directory.resource/clinic','app.patchwork.directory.resource',repeat('a',64),'Digest test clinic','Chicago','clinic','unverified','{"url":"https://example.org"}','digesttestclinic','unknown',NOW(),NOW(),1,'digest-test')`);
        const tomorrow = new Date(now.getTime() + 86400001);
        await service.runDigestSweep(tomorrow);
        await service.runDigestSweep(tomorrow);
        const notes = (
            await pool.query(
                'SELECT title,body,metadata FROM notification_intents WHERE recipient_did=$1',
                [did],
            )
        ).rows;
        expect(notes).toHaveLength(1);
        expect(JSON.stringify(notes)).not.toContain('digesttestclinic');
        expect(JSON.stringify(notes)).not.toContain('Chicago');
        await pool.query(
            `UPDATE notification_intents SET channels_materialized_at=NOW() WHERE recipient_did=$1`,
            [did],
        );
        await pool.query(
            `INSERT INTO notification_delivery_attempts(notification_id,channel,target_id,provider_idempotency_key,status,next_attempt_at,created_at,updated_at)
      SELECT notification_id,'email',gen_random_uuid(),'digest-test:'||notification_id,'pending',NOW(),NOW(),NOW() FROM notification_intents WHERE recipient_did=$1`,
            [did],
        );
        await service.setAlerts(did, { id: saved.id, enabled: false });
        const delivery = await pool.query(
            `SELECT d.status FROM notification_delivery_attempts d JOIN notification_intents n USING(notification_id) WHERE n.recipient_did=$1`,
            [did],
        );
        expect(delivery.rows.map((row) => row.status)).toEqual(['skipped']);
        expect((await service.list(did)).items[0]?.alertsEnabled).toBe(false);
        expect(
            await service.runDigestSweep(
                new Date(tomorrow.getTime() + 86400001),
            ),
        ).toEqual({ processed: 0 });
    });
});
