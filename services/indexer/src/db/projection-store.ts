import { createHash } from 'node:crypto';
import { recordNsid, type NormalizedFirehoseEvent } from '@patchwork/shared';
import type { Pool } from 'pg';

export interface AidPostProjection {
    uri: string;
    collection: string;
    cid: string | null;
    revision: string | null;
    authorDidHash: string;
    title: string;
    description: string;
    category: string;
    urgency: string;
    status: string;
    searchableText: string;
    latitude: number;
    longitude: number;
    precisionKm: number;
    createdAt: string;
    updatedAt: string;
    sourceCursor: number;
}

export interface DirectoryResourceProjection {
    uri: string;
    collection: string;
    cid: string | null;
    revision: string | null;
    authorDidHash: string;
    name: string;
    serviceArea: string;
    category: string;
    verificationStatus: string;
    contact: {
        url?: string;
        phone?: string;
    };
    searchableText: string;
    latitude: number | null;
    longitude: number | null;
    precisionKm: number | null;
    openHours: string | null;
    eligibilityNotes: string | null;
    operationalStatus: string;
    createdAt: string;
    updatedAt: string;
    sourceCursor: number;
}

export interface VolunteerProfileProjection {
    uri: string;
    collection: string;
    cid: string | null;
    revision: string | null;
    authorDidHash: string;
    displayName: string;
    bio: string | null;
    capabilities: string[];
    availability: string;
    contactPreference: string;
    skills: string[];
    languages: string[];
    serviceAreaLabel: string | null;
    noPermanentAddress: boolean;
    latitude: number | null;
    longitude: number | null;
    precisionKm: number | null;
    searchableText: string;
    createdAt: string;
    updatedAt: string;
    sourceCursor: number;
}

interface ProjectionRow {
    uri: string;
    collection: string;
    cid: string | null;
    revision: string | null;
    author_did_hash: string;
    title: string;
    description: string;
    category: string;
    urgency: string;
    status: string;
    searchable_text: string;
    latitude: number;
    longitude: number;
    precision_km: number;
    record_created_at: Date | string;
    record_updated_at: Date | string;
    source_cursor: number | string;
}

interface DirectoryProjectionRow {
    uri: string;
    collection: string;
    cid: string | null;
    revision: string | null;
    author_did_hash: string;
    name: string;
    service_area: string;
    category: string;
    verification_status: string;
    contact: {
        url?: string;
        phone?: string;
    };
    searchable_text: string;
    latitude: number | null;
    longitude: number | null;
    precision_km: number | null;
    open_hours: string | null;
    eligibility_notes: string | null;
    operational_status: string;
    record_created_at: Date | string;
    record_updated_at: Date | string;
    source_cursor: number | string;
}

interface VolunteerProjectionRow {
    uri: string;
    collection: string;
    cid: string | null;
    revision: string | null;
    author_did_hash: string;
    display_name: string;
    bio: string | null;
    capabilities: string[];
    availability: string;
    contact_preference: string;
    skills: string[];
    languages: string[];
    service_area_label: string | null;
    no_permanent_address: boolean;
    latitude: number | null;
    longitude: number | null;
    precision_km: number | null;
    searchable_text: string;
    record_created_at: Date | string;
    record_updated_at: Date | string;
    source_cursor: number | string;
}

const hash = (value: string): string =>
    createHash('sha256').update(value).digest('hex');

const toProjection = (row: ProjectionRow): AidPostProjection => ({
    uri: row.uri,
    collection: row.collection,
    cid: row.cid,
    revision: row.revision,
    authorDidHash: row.author_did_hash,
    title: row.title,
    description: row.description,
    category: row.category,
    urgency: row.urgency,
    status: row.status,
    searchableText: row.searchable_text,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    precisionKm: Number(row.precision_km),
    createdAt: new Date(row.record_created_at).toISOString(),
    updatedAt: new Date(row.record_updated_at).toISOString(),
    sourceCursor: Number(row.source_cursor),
});

const toDirectoryProjection = (
    row: DirectoryProjectionRow,
): DirectoryResourceProjection => ({
    uri: row.uri,
    collection: row.collection,
    cid: row.cid,
    revision: row.revision,
    authorDidHash: row.author_did_hash,
    name: row.name,
    serviceArea: row.service_area,
    category: row.category,
    verificationStatus: row.verification_status,
    contact: row.contact,
    searchableText: row.searchable_text,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    precisionKm: row.precision_km === null ? null : Number(row.precision_km),
    openHours: row.open_hours,
    eligibilityNotes: row.eligibility_notes,
    operationalStatus: row.operational_status,
    createdAt: new Date(row.record_created_at).toISOString(),
    updatedAt: new Date(row.record_updated_at).toISOString(),
    sourceCursor: Number(row.source_cursor),
});

const toVolunteerProjection = (
    row: VolunteerProjectionRow,
): VolunteerProfileProjection => ({
    uri: row.uri,
    collection: row.collection,
    cid: row.cid,
    revision: row.revision,
    authorDidHash: row.author_did_hash,
    displayName: row.display_name,
    bio: row.bio,
    capabilities: row.capabilities,
    availability: row.availability,
    contactPreference: row.contact_preference,
    skills: row.skills,
    languages: row.languages,
    serviceAreaLabel: row.service_area_label,
    noPermanentAddress: row.no_permanent_address,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    precisionKm: row.precision_km === null ? null : Number(row.precision_km),
    searchableText: row.searchable_text,
    createdAt: new Date(row.record_created_at).toISOString(),
    updatedAt: new Date(row.record_updated_at).toISOString(),
    sourceCursor: Number(row.source_cursor),
});

export class PostgresProjectionStore {
    constructor(
        private readonly pool: Pool,
        private readonly rebuildLock = 'patchwork-indexer-rebuild:live',
    ) {}

    async apply(event: NormalizedFirehoseEvent): Promise<void> {
        if (
            event.collection !== recordNsid.aidPost &&
            event.collection !== recordNsid.directoryResource &&
            event.collection !== recordNsid.volunteerProfile
        ) {
            throw new Error(
                'Projection store only accepts aid-post, directory-resource, and volunteer-profile events.',
            );
        }
        const client = await this.pool.connect();
        const authorDidHash = hash(event.authorDid);
        try {
            await client.query('BEGIN');
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtext('account:' || $1))`,
                [authorDidHash],
            );
            await client.query(
                `SELECT pg_advisory_xact_lock_shared(hashtext($1))`,
                [this.rebuildLock],
            );
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
                event.uri,
            ]);
            const accepted = await client.query(
                `INSERT INTO indexer_projection_events (event_id, source_cursor)
                 VALUES ($1, $2)
                 ON CONFLICT (event_id) DO NOTHING
                 RETURNING event_id`,
                [event.eventId, event.seq],
            );
            if (accepted.rowCount === 0) {
                await client.query('COMMIT');
                return;
            }
            const uriHash = hash(event.uri);
            if (event.action === 'delete') {
                await client.query(
                    `INSERT INTO indexer_projection_tombstones (uri_hash, source_cursor)
                     VALUES ($1, $2)
                     ON CONFLICT (uri_hash) DO UPDATE SET
                        source_cursor = EXCLUDED.source_cursor,
                        deleted_at = NOW()
                     WHERE indexer_projection_tombstones.source_cursor < EXCLUDED.source_cursor`,
                    [uriHash, event.seq],
                );
                if (event.collection === recordNsid.aidPost) {
                    await client.query(
                        `DELETE FROM indexer_aid_post_projections
                         WHERE uri = $1 AND source_cursor <= $2`,
                        [event.uri, event.seq],
                    );
                } else if (
                    event.collection === recordNsid.directoryResource
                ) {
                    await client.query(
                        `DELETE FROM indexer_directory_resource_projections
                         WHERE uri = $1 AND source_cursor <= $2`,
                        [event.uri, event.seq],
                    );
                } else {
                    await client.query(
                        `DELETE FROM indexer_volunteer_profile_projections
                         WHERE uri = $1 AND source_cursor <= $2`,
                        [event.uri, event.seq],
                    );
                }
                await client.query('COMMIT');
                return;
            }
            const deactivated = await client.query(
                `SELECT 1 FROM account_deactivations WHERE did_hash = $1
                 UNION ALL
                 SELECT 1 FROM indexer_network_accounts
                 WHERE did_hash = $1 AND active = FALSE
                 LIMIT 1`,
                [authorDidHash],
            );
            if (deactivated.rowCount) {
                if (event.collection === recordNsid.aidPost) {
                    await client.query(
                        `DELETE FROM indexer_aid_post_projections WHERE uri = $1`,
                        [event.uri],
                    );
                } else if (
                    event.collection === recordNsid.directoryResource
                ) {
                    await client.query(
                        `DELETE FROM indexer_directory_resource_projections
                         WHERE uri = $1`,
                        [event.uri],
                    );
                } else {
                    await client.query(
                        `DELETE FROM indexer_volunteer_profile_projections
                         WHERE uri = $1`,
                        [event.uri],
                    );
                }
                await client.query('COMMIT');
                return;
            }
            const tombstone = await client.query<{ source_cursor: string }>(
                `SELECT source_cursor
                 FROM indexer_projection_tombstones
                 WHERE uri_hash = $1`,
                [uriHash],
            );
            if (
                tombstone.rows[0] &&
                Number(tombstone.rows[0].source_cursor) >= event.seq
            ) {
                await client.query('COMMIT');
                return;
            }
            if (event.collection === recordNsid.aidPost) {
                if (event.payload?.kind !== 'aid-post') {
                    throw new Error(
                        'Aid-post create and update events require a normalized payload.',
                    );
                }
                const payload = event.payload;
                await client.query(
                    `INSERT INTO indexer_aid_post_projections (
                        uri, collection, cid, revision, author_did_hash, title,
                        description, category, urgency, status, searchable_text,
                        latitude, longitude, precision_km, record_created_at,
                        record_updated_at, source_cursor, source_event_id
                     ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                        $13, $14, $15, $16, $17, $18
                     )
                     ON CONFLICT (uri) DO UPDATE SET
                        collection = EXCLUDED.collection,
                        cid = EXCLUDED.cid,
                        revision = EXCLUDED.revision,
                        author_did_hash = EXCLUDED.author_did_hash,
                        title = EXCLUDED.title,
                        description = EXCLUDED.description,
                        category = EXCLUDED.category,
                        urgency = EXCLUDED.urgency,
                        status = EXCLUDED.status,
                        searchable_text = EXCLUDED.searchable_text,
                        latitude = EXCLUDED.latitude,
                        longitude = EXCLUDED.longitude,
                        precision_km = EXCLUDED.precision_km,
                        record_created_at = EXCLUDED.record_created_at,
                        record_updated_at = EXCLUDED.record_updated_at,
                        source_cursor = EXCLUDED.source_cursor,
                        source_event_id = EXCLUDED.source_event_id,
                        projected_at = NOW()
                     WHERE indexer_aid_post_projections.source_cursor
                        < EXCLUDED.source_cursor`,
                    [
                        event.uri,
                        event.collection,
                        event.cid ?? null,
                        event.revision ?? null,
                        authorDidHash,
                        payload.title,
                        payload.description,
                        payload.category,
                        payload.urgency,
                        payload.status,
                        payload.searchableText,
                        payload.approximateGeo.latitude,
                        payload.approximateGeo.longitude,
                        payload.approximateGeo.precisionKm,
                        payload.createdAt,
                        payload.updatedAt,
                        event.seq,
                        event.eventId,
                    ],
                );
            } else if (
                event.collection === recordNsid.directoryResource
            ) {
                if (event.payload?.kind !== 'directory-resource') {
                    throw new Error(
                        'Directory-resource create and update events require a normalized payload.',
                    );
                }
                const payload = event.payload;
                await client.query(
                    `INSERT INTO indexer_directory_resource_projections (
                        uri, collection, cid, revision, author_did_hash, name,
                        service_area, category, verification_status, contact,
                        searchable_text, latitude, longitude, precision_km,
                        open_hours, eligibility_notes, operational_status,
                        record_created_at, record_updated_at, source_cursor,
                        source_event_id
                     ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
                        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
                     )
                     ON CONFLICT (uri) DO UPDATE SET
                        collection = EXCLUDED.collection,
                        cid = EXCLUDED.cid,
                        revision = EXCLUDED.revision,
                        author_did_hash = EXCLUDED.author_did_hash,
                        name = EXCLUDED.name,
                        service_area = EXCLUDED.service_area,
                        category = EXCLUDED.category,
                        verification_status = EXCLUDED.verification_status,
                        contact = EXCLUDED.contact,
                        searchable_text = EXCLUDED.searchable_text,
                        latitude = EXCLUDED.latitude,
                        longitude = EXCLUDED.longitude,
                        precision_km = EXCLUDED.precision_km,
                        open_hours = EXCLUDED.open_hours,
                        eligibility_notes = EXCLUDED.eligibility_notes,
                        operational_status = EXCLUDED.operational_status,
                        record_created_at = EXCLUDED.record_created_at,
                        record_updated_at = EXCLUDED.record_updated_at,
                        source_cursor = EXCLUDED.source_cursor,
                        source_event_id = EXCLUDED.source_event_id,
                        projected_at = NOW()
                     WHERE indexer_directory_resource_projections.source_cursor
                        < EXCLUDED.source_cursor`,
                    [
                        event.uri,
                        event.collection,
                        event.cid ?? null,
                        event.revision ?? null,
                        authorDidHash,
                        payload.name,
                        payload.serviceArea,
                        payload.category,
                        payload.verificationStatus,
                        JSON.stringify(payload.contact),
                        payload.searchableText,
                        payload.approximateGeo?.latitude ?? null,
                        payload.approximateGeo?.longitude ?? null,
                        payload.approximateGeo?.precisionKm ?? null,
                        payload.openHours ?? null,
                        payload.eligibilityNotes ?? null,
                        payload.operationalStatus,
                        payload.createdAt,
                        payload.updatedAt,
                        event.seq,
                        event.eventId,
                    ],
                );
            } else {
                if (event.payload?.kind !== 'volunteer-profile') {
                    throw new Error(
                        'Volunteer-profile create and update events require a normalized payload.',
                    );
                }
                const payload = event.payload;
                await client.query(
                    `INSERT INTO indexer_volunteer_profile_projections (
                        uri, collection, cid, revision, author_did_hash,
                        display_name, bio, capabilities, availability,
                        contact_preference, skills, languages,
                        service_area_label, no_permanent_address,
                        latitude, longitude, precision_km, searchable_text,
                        record_created_at, record_updated_at, source_cursor,
                        source_event_id
                     ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10,
                        $11::jsonb, $12::jsonb, $13, $14, $15, $16, $17,
                        $18, $19, $20, $21, $22
                     )
                     ON CONFLICT (uri) DO UPDATE SET
                        collection = EXCLUDED.collection,
                        cid = EXCLUDED.cid,
                        revision = EXCLUDED.revision,
                        author_did_hash = EXCLUDED.author_did_hash,
                        display_name = EXCLUDED.display_name,
                        bio = EXCLUDED.bio,
                        capabilities = EXCLUDED.capabilities,
                        availability = EXCLUDED.availability,
                        contact_preference = EXCLUDED.contact_preference,
                        skills = EXCLUDED.skills,
                        languages = EXCLUDED.languages,
                        service_area_label = EXCLUDED.service_area_label,
                        no_permanent_address =
                            EXCLUDED.no_permanent_address,
                        latitude = EXCLUDED.latitude,
                        longitude = EXCLUDED.longitude,
                        precision_km = EXCLUDED.precision_km,
                        searchable_text = EXCLUDED.searchable_text,
                        record_created_at = EXCLUDED.record_created_at,
                        record_updated_at = EXCLUDED.record_updated_at,
                        source_cursor = EXCLUDED.source_cursor,
                        source_event_id = EXCLUDED.source_event_id,
                        projected_at = NOW()
                     WHERE indexer_volunteer_profile_projections.source_cursor
                        < EXCLUDED.source_cursor`,
                    [
                        event.uri,
                        event.collection,
                        event.cid ?? null,
                        event.revision ?? null,
                        authorDidHash,
                        payload.displayName,
                        payload.bio ?? null,
                        JSON.stringify(payload.capabilities),
                        payload.availability,
                        payload.contactPreference,
                        JSON.stringify(payload.skills),
                        JSON.stringify(payload.languages),
                        payload.serviceArea?.areaLabel ?? null,
                        payload.serviceArea?.noPermanentAddress ?? false,
                        payload.serviceArea?.approximateGeo?.latitude ?? null,
                        payload.serviceArea?.approximateGeo?.longitude ?? null,
                        payload.serviceArea?.approximateGeo?.precisionKm ?? null,
                        payload.searchableText,
                        payload.createdAt,
                        payload.updatedAt,
                        event.seq,
                        event.eventId,
                    ],
                );
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async recordHeartbeat(cursor: number | null, observedAt = new Date()): Promise<void> {
        await this.pool.query(
            `INSERT INTO indexer_projection_state (
                singleton, latest_cursor, heartbeat_at
             ) VALUES (TRUE, $1, $2)
             ON CONFLICT (singleton) DO UPDATE SET
                latest_cursor = CASE
                    WHEN EXCLUDED.latest_cursor IS NULL
                        THEN indexer_projection_state.latest_cursor
                    WHEN indexer_projection_state.latest_cursor IS NULL
                        THEN EXCLUDED.latest_cursor
                    ELSE GREATEST(
                        indexer_projection_state.latest_cursor,
                        EXCLUDED.latest_cursor
                    )
                END,
                heartbeat_at = EXCLUDED.heartbeat_at`,
            [cursor, observedAt],
        );
    }

    async get(uri: string): Promise<AidPostProjection | null> {
        const result = await this.pool.query<ProjectionRow>(
            `SELECT uri, collection, cid, revision, author_did_hash, title, description,
                    category, urgency, status, searchable_text, latitude,
                    longitude, precision_km, record_created_at,
                    record_updated_at, source_cursor
             FROM indexer_aid_post_projections
             WHERE uri = $1`,
            [uri],
        );
        return result.rows[0] ? toProjection(result.rows[0]) : null;
    }

    async list(): Promise<AidPostProjection[]> {
        const result = await this.pool.query<ProjectionRow>(
            `SELECT uri, collection, cid, revision, author_did_hash, title,
                    description, category, urgency, status, searchable_text,
                    latitude, longitude, precision_km, record_created_at,
                    record_updated_at, source_cursor
             FROM indexer_aid_post_projections
             ORDER BY uri`,
        );
        return result.rows.map(toProjection);
    }

    async getDirectory(
        uri: string,
    ): Promise<DirectoryResourceProjection | null> {
        const result = await this.pool.query<DirectoryProjectionRow>(
            `SELECT uri, collection, cid, revision, author_did_hash, name,
                    service_area, category, verification_status, contact,
                    searchable_text, latitude, longitude, precision_km,
                    open_hours, eligibility_notes, operational_status,
                    record_created_at, record_updated_at, source_cursor
             FROM indexer_directory_resource_projections
             WHERE uri = $1`,
            [uri],
        );
        return result.rows[0] ? toDirectoryProjection(result.rows[0]) : null;
    }

    async listDirectory(): Promise<DirectoryResourceProjection[]> {
        const result = await this.pool.query<DirectoryProjectionRow>(
            `SELECT uri, collection, cid, revision, author_did_hash, name,
                    service_area, category, verification_status, contact,
                    searchable_text, latitude, longitude, precision_km,
                    open_hours, eligibility_notes, operational_status,
                    record_created_at, record_updated_at, source_cursor
             FROM indexer_directory_resource_projections
             ORDER BY uri`,
        );
        return result.rows.map(toDirectoryProjection);
    }

    async getVolunteer(
        uri: string,
    ): Promise<VolunteerProfileProjection | null> {
        const result = await this.pool.query<VolunteerProjectionRow>(
            `SELECT uri, collection, cid, revision, author_did_hash,
                    display_name, bio, capabilities, availability,
                    contact_preference, skills, languages,
                    service_area_label, no_permanent_address, latitude,
                    longitude, precision_km, searchable_text,
                    record_created_at, record_updated_at, source_cursor
             FROM indexer_volunteer_profile_projections
             WHERE uri = $1`,
            [uri],
        );
        return result.rows[0] ? toVolunteerProjection(result.rows[0]) : null;
    }

    async listVolunteers(): Promise<VolunteerProfileProjection[]> {
        const result = await this.pool.query<VolunteerProjectionRow>(
            `SELECT uri, collection, cid, revision, author_did_hash,
                    display_name, bio, capabilities, availability,
                    contact_preference, skills, languages,
                    service_area_label, no_permanent_address, latitude,
                    longitude, precision_km, searchable_text,
                    record_created_at, record_updated_at, source_cursor
             FROM indexer_volunteer_profile_projections
             ORDER BY uri`,
        );
        return result.rows.map(toVolunteerProjection);
    }

    async resetForRebuild(): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtext($1))`,
                [this.rebuildLock],
            );
            await client.query(
                `TRUNCATE indexer_projection_events,
                          indexer_projection_tombstones,
                          indexer_aid_post_projections,
                          indexer_directory_resource_projections,
                          indexer_volunteer_profile_projections`,
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
