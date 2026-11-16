import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OrganizationService } from './organization-service.js';

describe('native public organization pagination PostgreSQL', () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    beforeEach(async () => {
        await pool.query('TRUNCATE organizations CASCADE');
        for (let index = 0; index < 45; index++) {
            await pool.query(`INSERT INTO organizations (organization_id,slug,name,description,origin,
                non_endorsement_label,created_by_did,created_at,updated_at)
                VALUES($1,$2,$3,$4,$5,'Fictional test listing','did:example:fixture',NOW(),NOW())`,
            [randomUUID(), `native-fixture-${index}`, `Fictional ${String(index).padStart(2, '0')}`,
                'x'.repeat(2000), index < 30 ? 'synthetic' : 'visitor-created']);
        }
    });
    afterAll(async () => { await pool.end(); });

    it('bounds large-catalog responses, keeps stable pages and preserves legacy response shape', async () => {
        const service = new OrganizationService(pool);
        const first = await service.listPublicPage(undefined, new URLSearchParams('page=1&pageSize=20&dataset=all'));
        const second = await service.listPublicPage(undefined, new URLSearchParams('page=2&pageSize=20&dataset=all'));
        const third = await service.listPublicPage(undefined, new URLSearchParams('page=3&pageSize=20&dataset=all'));
        expect(first).toMatchObject({ total: 45, page: 1, hasNextPage: true });
        expect(second).toMatchObject({ total: 45, page: 2, hasNextPage: true });
        expect(third).toMatchObject({ total: 45, page: 3, hasNextPage: false });
        const rows = [first, second, third].flatMap(page => page['organizations'] as { id: string }[]);
        expect(rows).toHaveLength(45);
        expect(new Set(rows.map(row => row.id)).size).toBe(45);
        expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(256 * 1024);
        const legacy = await service.listPublic();
        expect(Object.keys(legacy)).toEqual(['organizations']);
        expect(legacy['organizations']).toHaveLength(45);
    });

    it('filters demo/community before counts and pagination and supports anonymous search', async () => {
        const service = new OrganizationService(pool);
        const community = await service.listPublicPage(undefined, new URLSearchParams('page=1&pageSize=20&dataset=community'));
        const demo = await service.listPublicPage(undefined, new URLSearchParams('page=1&pageSize=20&dataset=demo'));
        expect(community).toMatchObject({ total: 15, hasNextPage: false });
        expect(demo).toMatchObject({ total: 30, hasNextPage: true });
        const missing = await service.listPublicPage('no matching organization', new URLSearchParams('page=1&pageSize=20'));
        expect(missing).toMatchObject({ organizations: [], total: 0, hasNextPage: false });
    });
});
