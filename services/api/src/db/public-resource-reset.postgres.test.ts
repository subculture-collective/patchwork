import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { importPublicResources } from './public-resource-seed.js';
import { publicResourceSeed } from './public-resource-catalog.js';

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
afterAll(() => pool.end());
describe('fresh public catalog reset', () => {
    it('requires backup evidence, previews without mutation, and clears application records atomically', async () => {
        const database = (await pool.query('SELECT current_database() AS name')).rows[0].name;
        await pool.query("INSERT INTO account_preferences(did,privacy,notifications,visibility,language,location,created_at,updated_at) VALUES('did:plc:reset-fixture','public','{\"inApp\":true,\"email\":false,\"push\":false}','public','en','{\"sharing\":\"hidden\",\"noPermanentAddress\":false}',NOW(),NOW()) ON CONFLICT DO NOTHING");
        await expect(importPublicResources(pool,{reset:true,apply:true,expectedDatabase:'wrong'})).rejects.toThrow('verified backup');
        const preview = await importPublicResources(pool,{reset:true});
        expect(preview.resetTables).toContain('public.account_preferences');
        expect((await pool.query("SELECT 1 FROM account_preferences WHERE did='did:plc:reset-fixture'")).rowCount).toBe(1);
        const migrations = (await pool.query('SELECT * FROM schema_migrations ORDER BY 1')).rows;
        const checkpoints = (await pool.query('SELECT * FROM indexer_checkpoints ORDER BY 1')).rows;
        await importPublicResources(pool,{reset:true,apply:true,expectedDatabase:database,backupSha256:'a'.repeat(64)});
        for (const table of ['account_preferences','organizations','indexer_aid_post_projections','indexer_volunteer_profile_projections','public_resource_claims']) {
            expect((await pool.query(`SELECT count(*)::integer AS count FROM ${table}`)).rows[0].count).toBe(0);
        }
        expect((await pool.query('SELECT * FROM schema_migrations ORDER BY 1')).rows).toEqual(migrations);
        expect((await pool.query('SELECT * FROM indexer_checkpoints ORDER BY 1')).rows).toEqual(checkpoints);
        expect((await pool.query('SELECT count(*)::integer AS count FROM eligible_public_resource_addresses')).rows[0].count).toBe(publicResourceSeed.length);
        expect((await pool.query("SELECT count(*)::integer AS count FROM indexer_directory_resource_projections WHERE operational_status <> 'unknown' OR record_origin <> 'sourced-public'")).rows[0].count).toBe(0);
    });
});
