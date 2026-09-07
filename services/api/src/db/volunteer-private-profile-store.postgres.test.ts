import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresVolunteerPrivateProfileStore } from './volunteer-private-profile-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('PostgresVolunteerPrivateProfileStore', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const store = new PostgresVolunteerPrivateProfileStore(pool);
    const did = 'did:plc:private-volunteer';

    beforeAll(async () => {
        await pool.query(
            'TRUNCATE volunteer_private_profiles',
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    it('persists private contact and matching state across instances and deletes it', async () => {
        const profile = {
            contactEmail: 'volunteer@example.test',
            contactPhone: null,
            availabilityWindows: ['weekday_evenings'],
            matchingPreferences: {
                preferredCategories: ['food' as const],
                preferredUrgencies: ['medium' as const],
                maxDistanceKm: 10,
                acceptsLateNight: false,
            },
        };
        await store.put(did, profile, new Date('2026-07-28T12:00:00.000Z'));
        await expect(
            new PostgresVolunteerPrivateProfileStore(pool).get(did),
        ).resolves.toEqual(profile);

        const serialized = JSON.stringify(await store.get(did));
        expect(serialized).not.toContain('latitude');
        expect(serialized).not.toContain('verification');

        await store.delete(did);
        await expect(store.get(did)).resolves.toBeNull();
    });
});
