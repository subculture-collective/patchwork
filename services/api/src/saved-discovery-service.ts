import { readProjectionPage } from './projected-discovery.js';
import { savedSearchSchema } from '@patchwork/shared';
import { lookupPostalArea } from '@patchwork/at-lexicons';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
    savedDiscoveryInputSchema,
    type SavedDiscoveryItem,
} from '@patchwork/shared';
import { z } from 'zod';
import { PublicHttpError } from './http/error-response.js';

export class SavedDiscoveryService {
    constructor(private readonly pool: Pool) {}
    async list(did: string): Promise<{ items: SavedDiscoveryItem[] }> {
        const result = await this.pool.query(
            `SELECT s.*,r.name FROM saved_discovery s LEFT JOIN indexer_directory_resource_projections r ON r.uri=s.resource_uri WHERE s.owner_did=$1 ORDER BY s.created_at DESC,s.id`,
            [did],
        );
        return {
            items: result.rows.map((row) => ({
                id: row.id,
                kind: row.kind,
                resourceUri: row.resource_uri ?? undefined,
                name: row.name ?? undefined,
                search: row.search ?? undefined,
                createdAt: row.created_at.toISOString(),
                alertsEnabled: row.alerts_enabled,
            })),
        };
    }
    async save(did: string, body: unknown) {
        const input = savedDiscoveryInputSchema.parse(body);
        if (
            input.kind === 'search' &&
            input.search.postalCode &&
            !lookupPostalArea(input.search.postalCode)
        )
            throw new PublicHttpError(
                400,
                'INVALID_POSTAL_CODE',
                'Choose a supported five-digit ZIP code.',
            );
        // Schema parsing gives fields a canonical order and rejects sensitive extras.
        const key = createHash('sha256')
            .update(JSON.stringify(input))
            .digest('hex');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                "SELECT pg_advisory_xact_lock(hashtext('account:' || $1))",
                [createHash('sha256').update(did).digest('hex')],
            );
            const deactivated = await client.query(
                'SELECT 1 FROM account_deactivations WHERE did_hash=$1',
                [createHash('sha256').update(did).digest('hex')],
            );
            if (deactivated.rowCount)
                throw new PublicHttpError(
                    403,
                    'ACCOUNT_DEACTIVATED',
                    'This account is deactivated.',
                );
            const existing = await client.query(
                'SELECT id FROM saved_discovery WHERE owner_did=$1 AND identity_hash=$2',
                [did, key],
            );
            if (existing.rowCount) {
                await client.query('COMMIT');
                return { id: existing.rows[0].id };
            }
            const count = await client.query(
                'SELECT count(*)::integer AS count FROM saved_discovery WHERE owner_did=$1',
                [did],
            );
            if (count.rows[0].count >= 200)
                throw new PublicHttpError(
                    409,
                    'SAVED_LIMIT',
                    'Remove a saved item before adding another. You can save up to 200 items.',
                );
            if (input.kind === 'resource') {
                const found = await client.query(
                    'SELECT 1 FROM indexer_directory_resource_projections WHERE uri=$1',
                    [input.resourceUri],
                );
                if (!found.rowCount)
                    throw new PublicHttpError(
                        404,
                        'RESOURCE_NOT_FOUND',
                        'This resource is no longer available.',
                    );
            }
            const id = randomUUID();
            await client.query(
                'INSERT INTO saved_discovery(id,owner_did,kind,identity_hash,resource_uri,search) VALUES($1,$2,$3,$4,$5,$6)',
                [
                    id,
                    did,
                    input.kind,
                    key,
                    input.kind === 'resource' ? input.resourceUri : null,
                    input.kind === 'search'
                        ? JSON.stringify(input.search)
                        : null,
                ],
            );
            await client.query('COMMIT');
            return { id };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
    async setAlerts(did: string, body: unknown) {
        const input = z
            .object({ id: z.string().uuid(), enabled: z.boolean() })
            .strict()
            .parse(body);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const changed = await client.query(
                `UPDATE saved_discovery SET alerts_enabled=$3,next_check_at=CASE WHEN $3 THEN NOW() END,alert_baseline=NULL WHERE owner_did=$1 AND id=$2 RETURNING id`,
                [did, input.id, input.enabled],
            );
            if (!changed.rowCount)
                throw new PublicHttpError(
                    404,
                    'SAVED_ITEM_NOT_FOUND',
                    'This saved item is unavailable.',
                );
            if (!input.enabled) await cancelSavedDeliveries(client,did);
            await client.query('COMMIT');
            return { updated: true };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
    async runDigestSweep(now = new Date()) {
        const client = await this.pool.connect();
        let selectedId: string | undefined;
        try {
            await client.query('BEGIN');
            await client.query("SET LOCAL statement_timeout='8s'");
            const selected = await client.query(
                `SELECT * FROM saved_discovery WHERE alerts_enabled AND next_check_at<=$1 ORDER BY next_check_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
                [now],
            );
            const row = selected.rows[0];
            if (!row) {
                await client.query('COMMIT');
                return { processed: 0 };
            }
            selectedId = row.id;
            let baseline: unknown;
            let changed = false;
            if (row.kind === 'resource') {
                const resource = await client.query(
                    `SELECT p.name,p.contact,p.open_hours,p.eligibility_notes,p.operational_status,l.street_address,s.profile FROM indexer_directory_resource_projections p LEFT JOIN public_resource_listings l ON l.resource_uri=p.uri LEFT JOIN resource_service_profiles s ON s.resource_uri=p.uri WHERE p.uri=$1`,
                    [row.resource_uri],
                );
                baseline = createHash('sha256')
                    .update(JSON.stringify(resource.rows))
                    .digest('hex');
                changed =
                    row.alert_baseline !== null &&
                    row.alert_baseline !== baseline;
            } else {
                const search = savedSearchSchema.parse(row.search);
                const params = new URLSearchParams({ pageSize: '100' });
                if (search.text) params.set('searchText', search.text);
                const isResource = search.nearbyIntent === 'resources';
                const fields = isResource
                    ? {
                          category: search.resourceCategory,
                          service: search.resourceService,
                          program: search.resourceProgram,
                      }
                    : {
                          category: search.category,
                          status: search.status,
                          minimumUrgency: search.minUrgency
                              ? ['low', 'low', 'medium', 'high', 'critical'][
                                    search.minUrgency - 1
                                ]
                              : undefined,
                      };
                for (const [key, value] of Object.entries(fields))
                    if (value) params.set(key, value);
                const postal = search.postalCode
                    ? lookupPostalArea(search.postalCode)
                    : undefined;
                const center = postal
                    ? { lat: postal.latitude, lng: postal.longitude }
                    : search.center;
                if (!isResource && search.postalCode)
                    params.set('postalCode', search.postalCode);
                if (center) {
                    params.set('latitude', String(center.lat));
                    params.set('longitude', String(center.lng));
                    params.set(
                        'radiusKm',
                        String((search.radiusMeters ?? 20000) / 1000),
                    );
                }
                const result = await readProjectionPage(
                    client,
                    params,
                    isResource ? 'directory' : 'feed',
                    isResource ? undefined : row.owner_did,
                    undefined,
                    true,
                );
                const matches = result.allUris ?? [];
                baseline = matches.sort();
                const previous = new Set(
                    Array.isArray(row.alert_baseline) ? row.alert_baseline : [],
                );
                changed =
                    row.alert_baseline !== null &&
                    matches.some((uri) => !previous.has(uri));
            }
            if (changed)
                await client.query(
                    `SELECT patchwork_enqueue_notification($1,'saved_discovery_changed','Your saved items have updates','Open My activity to review changes to your saved items.','normal','/activity','{}'::jsonb,$2,$3)`,
                    [
                        row.owner_did,
                        `saved-discovery:${row.owner_did}:${now.toISOString().slice(0, 10)}`,
                        now,
                    ],
                );
            await client.query(
                `UPDATE saved_discovery SET alert_baseline=$2::jsonb,next_check_at=$3::timestamptz+INTERVAL '1 day' WHERE id=$1`,
                [row.id, JSON.stringify(baseline), now],
            );
            await client.query('COMMIT');
            return { processed: 1 };
        } catch (error) {
            await client.query('ROLLBACK');
            // A malformed or expensive saved search must not starve later items.
            if (selectedId)
                await client.query(
                    `UPDATE saved_discovery SET next_check_at=$2::timestamptz+INTERVAL '1 hour' WHERE id=$1 AND alerts_enabled AND next_check_at<=$2`,
                    [selectedId, now],
                );
            throw error;
        } finally {
            client.release();
        }
    }
    async remove(did: string, body: unknown) {
        const { id } = z.object({ id: z.string().uuid() }).strict().parse(body);
        const client=await this.pool.connect();
        try {
            await client.query('BEGIN');
            const deleted=await client.query('DELETE FROM saved_discovery WHERE owner_did=$1 AND id=$2 RETURNING id',[did,id]);
            if(deleted.rowCount)await cancelSavedDeliveries(client,did);
            await client.query('COMMIT');
        } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
        return { removed: true };
    }
}

async function cancelSavedDeliveries(client:PoolClient,did:string) {
// Already handed-off provider sends cannot be recalled; cancel queued work.
                await client.query(
                    `UPDATE notification_delivery_attempts d SET status='skipped',locked_at=NULL,last_error_code='saved-alerts-disabled',updated_at=NOW()
           FROM notification_intents n WHERE d.notification_id=n.notification_id AND n.recipient_did=$1
           AND n.notification_type='saved_discovery_changed' AND d.status IN ('pending','retry')`,
                    [did],
                );
                await client.query(
                    `DELETE FROM notification_intents WHERE recipient_did=$1 AND notification_type='saved_discovery_changed' AND channels_materialized_at IS NULL`,
                    [did],
                );

}
