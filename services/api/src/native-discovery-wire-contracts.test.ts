import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostgresProjectionQueryService } from './query-service.js';
import { OrganizationService } from './organization-service.js';

const now = '2026-11-16T12:00:00.000Z';
const fixture = (name: string) => JSON.parse(readFileSync(new URL(
    `../../../packages/mobile-contracts/fixtures/${name}.json`, import.meta.url), 'utf8'));
const resourceUri = 'at://did:example:mobile-fixture/app.patchwork.directory.resource/demo';
const resource = {
    uri: resourceUri, cid: 'fixture-cid', name: 'Fictional Community Kitchen', category: 'food-bank',
    service_area: 'Cook County, Illinois', verification_status: 'unverified', operational_status: 'unknown',
    contact: { url: 'https://resources.example.test/info', phone: '+1-202-555-0100' },
    open_hours: 'Call the public number for hours.', eligibility_notes: 'Fictional listing for native tests.',
    latitude: null, longitude: null, precision_km: null, distance_km: null,
    record_created_at: now, record_updated_at: now, projected_at: now, record_origin: 'sourced-public',
};
const volunteer = {
    uri: 'at://did:example:mobile-fixture/app.patchwork.volunteer.profile/demo', cid: 'fixture-cid',
    display_name: 'Fictional Volunteer', bio: 'Fictional public profile for native tests.', capabilities: ['food'],
    availability: 'scheduled', contact_preference: 'chat', skills: [], languages: ['en', 'es'],
    service_area_label: 'Cook County, Illinois', no_permanent_address: false,
    latitude: null, longitude: null, precision_km: null, record_updated_at: now, projected_at: now, record_origin: 'synthetic',
};
const organization = {
    organization_id: '11111111-1111-4111-8111-111111111111', slug: 'fixture-organization', name: 'Fictional Community Kitchen',
    description: 'Fictional public organization for native tests.', origin: 'sourced-public',
    source_url: 'https://resources.example.test/organization', source_retrieved_at: now, source_last_verified_at: now,
    non_endorsement_label: 'A public listing does not imply participation or endorsement.', created_at: now, updated_at: now,
};
const linked = { stewardship_id: '22222222-2222-4222-8222-222222222222', resource_uri: resourceUri,
    last_reconfirmed_at: now, reconfirm_due_at: '2026-12-16T12:00:00.000Z' };

afterEach(() => vi.useRealTimers());
describe('native public discovery fixtures', () => {
    it('binds resource provenance to the production directory presenter', async () => {
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
        const query = vi.fn().mockResolvedValueOnce({ rows: [{ rows: [resource], total: '1', projected_at: now, state: null }] })
            .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ resource_uri: resourceUri,
                source_name: 'Fictional source', source_url: 'https://resources.example.test/info',
                source_retrieved_at: now, claimed_by_organization_id: null }] }).mockResolvedValueOnce({ rows: [] });
        const result = await new PostgresProjectionQueryService({ query } as unknown as Pool).queryDirectory(new URLSearchParams());
        expect(result).toEqual({ statusCode: 200, body: fixture('discovery-resources') });
    });
    it('binds public volunteers without a signed-in viewer', async () => {
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
        const query = vi.fn().mockResolvedValueOnce({ rows: [{ rows: [volunteer], total: '1' }] }).mockResolvedValueOnce({ rows: [] });
        expect(await new PostgresProjectionQueryService({ query } as unknown as Pool).queryVolunteers(new URLSearchParams()))
            .toEqual({ statusCode: 200, body: fixture('discovery-volunteers') });
    });
    it('binds public organization list and profile without member/private fields', async () => {
        const query = vi.fn().mockResolvedValueOnce({ rows: [organization] })
            .mockResolvedValueOnce({ rows: [organization] }).mockResolvedValueOnce({ rows: [linked] });
        const service = new OrganizationService({ query } as unknown as Pool);
        expect(await service.listPublic()).toEqual(fixture('discovery-organizations'));
        expect(await service.getPublic(organization.organization_id)).toEqual(fixture('discovery-organization-profile'));
    });

    it('binds optional server-owned organization paging while bounding SQL output', async () => {
        const query = vi.fn().mockResolvedValueOnce({ rows: [{ rows: [organization], total: '1' }] });
        const service = new OrganizationService({ query } as unknown as Pool);
        expect(await service.listPublicPage(undefined, new URLSearchParams({ page: '1', pageSize: '20', dataset: 'all' })))
            .toEqual(fixture('discovery-organizations-page'));
        expect(query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $3 OFFSET $4'), [null, null, 20, 0]);
    });

    it('rejects malformed page inputs before querying the database', async () => {
        const query = vi.fn();
        const service = new OrganizationService({ query } as unknown as Pool);
        for (const params of ['page=0', 'pageSize=101', 'page=1bad', 'dataset=private']) {
            await expect(service.listPublicPage(undefined, new URLSearchParams(params))).rejects.toThrow('query is invalid');
        }
        expect(query).not.toHaveBeenCalled();
    });
});
