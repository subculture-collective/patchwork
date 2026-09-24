import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceModeService } from './maintenance-mode-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('MaintenanceModeService', () => {
    const schema = `maintenance_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new Pool({ connectionString: databaseUrl });
    const pool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema}`,
    });

    beforeAll(async () => {
        await adminPool.query(`CREATE SCHEMA ${schema}`);
        await pool.query(await readFile(
            new URL('./db/migrations/0021_maintenance_mode.sql', import.meta.url),
            'utf8',
        ));
    });

    afterAll(async () => {
        await pool.end();
        await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
        await adminPool.end();
    });

    it('durably declares and audibly resumes read-only mode across service restarts', async () => {
        const declaredAt = new Date('2026-07-28T12:00:00.000Z');
        const first = new MaintenanceModeService(pool);
        await first.ensureReady();
        const declared = await first.declare(
            'did:plc:moderator',
            {
                reasonCodes: ['privacy', 'monitoring', 'privacy'],
                publicMessage: 'New submissions are paused while checks run.',
            },
            'declare-one',
            declaredAt,
        );
        expect(declared).toMatchObject({
            active: true,
            reasonCodes: ['privacy', 'monitoring'],
            publicMessage: 'New submissions are paused while checks run.',
            version: 1,
        });

        const restarted = new MaintenanceModeService(pool);
        await restarted.ensureReady();
        expect(restarted.isActive()).toBe(true);
        const resumed = await restarted.resume(
            'did:plc:lead',
            'resume-one',
            new Date('2026-07-28T13:00:00.000Z'),
        );
        expect(resumed).toMatchObject({ active: false, version: 2 });

        const audit = await pool.query<{
            action: string;
            actor_did: string;
            retention_until: Date;
        }>(
            `SELECT action, actor_did, retention_until
               FROM platform_maintenance_audit ORDER BY occurred_at`,
        );
        expect(audit.rows.map(row => [row.action, row.actor_did])).toEqual([
            ['declare', 'did:plc:moderator'],
            ['resume', 'did:plc:lead'],
        ]);
        expect(audit.rows.every(row => row.retention_until instanceof Date)).toBe(true);
    });

    it('does not permit a database command to override the environment shutdown', async () => {
        const service = new MaintenanceModeService(pool, true);
        await service.ensureReady();
        expect(service.status()).toMatchObject({
            active: true,
            environmentOverride: true,
        });
        await expect(
            service.resume('did:plc:lead', 'resume-environment'),
        ).rejects.toThrow('MAINTENANCE_ENVIRONMENT_OVERRIDE_ACTIVE');
    });
});
