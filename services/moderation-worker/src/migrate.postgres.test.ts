import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runModerationMigrations } from './migrate.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('moderation database migrations', () => {
    const schema = `moderation_migrate_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new Pool({ connectionString: databaseUrl });
    const pool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema}`,
    });

    beforeAll(async () => {
        await adminPool.query(`CREATE SCHEMA ${schema}`);
    });

    afterAll(async () => {
        await pool.end();
        await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
        await adminPool.end();
    });

    it('applies an empty database and replays without changing it', async () => {
        const first = await runModerationMigrations({ pool });
        expect(first).toEqual({
            applied: [
                '001_create_moderation_tables.sql',
                '002_durable_moderation.sql',
                '003_retention_enforcement.sql',
                '004_submission_safety_and_urgent_events.sql',
                '005_showcase_moderation_origin.sql',
            ],
            skipped: [],
        });

        const runtimeTables = await pool.query<{ table_name: string }>(
            `SELECT table_name
             FROM information_schema.tables
             WHERE table_schema = $1
             ORDER BY table_name`,
            [schema],
        );
        expect(runtimeTables.rows.map(row => row.table_name)).toEqual([
            'moderation_audit_records',
            'moderation_notification_events',
            'moderation_queue_items',
            'moderation_schema_migrations',
            'moderation_submission_reviews',
        ]);

        const replay = await runModerationMigrations({ pool });
        expect(replay).toEqual({
            applied: [],
            skipped: [
                '001_create_moderation_tables.sql',
                '002_durable_moderation.sql',
                '003_retention_enforcement.sql',
                '004_submission_safety_and_urgent_events.sql',
                '005_showcase_moderation_origin.sql',
            ],
        });
    });
});
