import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

export const REGIONAL_SEED_VERSION = 'chicagoland-fictional-2026-09-06-v1';
// Approximate locality centers, not addresses or actual organization locations.
// Coverage includes CMAP's seven counties and the wider tri-state metro area.
export const regionalAreas = [
    ['Rogers Park', 'Cook', 'IL', 42.01, -87.67],
    ['Uptown', 'Cook', 'IL', 41.97, -87.66],
    ['Albany Park', 'Cook', 'IL', 41.97, -87.72],
    ['Logan Square', 'Cook', 'IL', 41.93, -87.71],
    ['Austin', 'Cook', 'IL', 41.90, -87.77],
    ['Pilsen', 'Cook', 'IL', 41.85, -87.66],
    ['Little Village', 'Cook', 'IL', 41.85, -87.71],
    ['Bronzeville', 'Cook', 'IL', 41.82, -87.62],
    ['Hyde Park', 'Cook', 'IL', 41.79, -87.60],
    ['South Shore', 'Cook', 'IL', 41.76, -87.58],
    ['Roseland', 'Cook', 'IL', 41.71, -87.62],
    ['Beverly', 'Cook', 'IL', 41.72, -87.68],
    ['Evanston', 'Cook', 'IL', 42.05, -87.69],
    ['Skokie', 'Cook', 'IL', 42.03, -87.75],
    ['Des Plaines', 'Cook', 'IL', 42.03, -87.88],
    ['Arlington Heights', 'Cook', 'IL', 42.08, -87.98],
    ['Schaumburg', 'Cook', 'IL', 42.03, -88.08],
    ['Oak Park', 'Cook', 'IL', 41.89, -87.79],
    ['Cicero', 'Cook', 'IL', 41.85, -87.75],
    ['Maywood', 'Cook', 'IL', 41.88, -87.84],
    ['Oak Lawn', 'Cook', 'IL', 41.72, -87.75],
    ['Orland Park', 'Cook', 'IL', 41.63, -87.85],
    ['Blue Island', 'Cook', 'IL', 41.66, -87.68],
    ['Chicago Heights', 'Cook', 'IL', 41.51, -87.64],
    ['Wheaton', 'DuPage', 'IL', 41.87, -88.11],
    ['Glen Ellyn', 'DuPage', 'IL', 41.88, -88.07],
    ['Lombard', 'DuPage', 'IL', 41.88, -88.01],
    ['Downers Grove', 'DuPage', 'IL', 41.80, -88.01],
    ['Naperville', 'DuPage', 'IL', 41.77, -88.15],
    ['West Chicago', 'DuPage', 'IL', 41.88, -88.20],
    ['Elmhurst', 'DuPage', 'IL', 41.90, -87.94],
    ['Addison', 'DuPage', 'IL', 41.93, -88.00],
    ['Aurora', 'Kane', 'IL', 41.76, -88.32],
    ['Elgin', 'Kane', 'IL', 42.04, -88.28],
    ['St Charles', 'Kane', 'IL', 41.91, -88.32],
    ['Batavia', 'Kane', 'IL', 41.85, -88.31],
    ['Oswego', 'Kendall', 'IL', 41.68, -88.35],
    ['Yorkville', 'Kendall', 'IL', 41.64, -88.45],
    ['Plano', 'Kendall', 'IL', 41.66, -88.54],
    ['Waukegan', 'Lake', 'IL', 42.36, -87.84],
    ['Mundelein', 'Lake', 'IL', 42.27, -88.00],
    ['Highland Park', 'Lake', 'IL', 42.18, -87.80],
    ['Round Lake', 'Lake', 'IL', 42.35, -88.09],
    ['Zion', 'Lake', 'IL', 42.45, -87.83],
    ['Crystal Lake', 'McHenry', 'IL', 42.24, -88.32],
    ['Woodstock', 'McHenry', 'IL', 42.31, -88.45],
    ['McHenry', 'McHenry', 'IL', 42.33, -88.27],
    ['Harvard', 'McHenry', 'IL', 42.42, -88.61],
    ['Joliet', 'Will', 'IL', 41.53, -88.08],
    ['Bolingbrook', 'Will', 'IL', 41.70, -88.07],
    ['Romeoville', 'Will', 'IL', 41.65, -88.09],
    ['New Lenox', 'Will', 'IL', 41.51, -87.97],
    ['Crete', 'Will', 'IL', 41.44, -87.63],
    ['DeKalb', 'DeKalb', 'IL', 41.93, -88.75],
    ['Morris', 'Grundy', 'IL', 41.36, -88.42],
    ['Hammond', 'Lake', 'IN', 41.58, -87.50],
    ['Gary', 'Lake', 'IN', 41.59, -87.35],
    ['Crown Point', 'Lake', 'IN', 41.42, -87.36],
    ['Valparaiso', 'Porter', 'IN', 41.47, -87.06],
    ['Portage', 'Porter', 'IN', 41.58, -87.18],
    ['Rensselaer', 'Jasper', 'IN', 40.94, -87.15],
    ['Morocco', 'Newton', 'IN', 40.95, -87.45],
    ['Kenosha', 'Kenosha', 'WI', 42.58, -87.82],
    ['Pleasant Prairie', 'Kenosha', 'WI', 42.55, -87.93],
] as const;

const people = ['Milo Makebelieve', 'Tilly Talltale', 'Nora Notreal', 'Felix Fiction',
    'Poppy Pretend', 'Drew Daydream', 'Winnie Whatif', 'Remy Rainbow'];
const requests = [
    ['food', 'Grocery pickup', 'A bag of groceries needs collecting for a neighbor without a car.'],
    ['transport', 'Ride to an appointment', 'A neighbor is looking for a daytime ride and a return pickup.'],
    ['childcare', 'After-school supply swap', 'A household is gathering notebooks and backpacks for an after-school group.'],
    ['shelter', 'Blankets and household basics', 'A neighbor moving into a new home could use blankets and kitchen basics.'],
    ['medical', 'Help collecting mobility supplies', 'A household needs help transporting a folded mobility aid.'],
    ['other', 'Help with a small move', 'A neighbor needs a hand carrying a few lightweight boxes.'],
    ['food', 'Pantry delivery', 'A household is looking for someone to collect a pantry parcel.'],
    ['other', 'Phone setup and forms', 'A neighbor would like company while setting up a phone and filling out forms.'],
] as const;
const resources = [
    ['food-bank', 'Imaginary Acorn Pantry'],
    ['shelter', 'Makebelieve Moonbeam Welcome Center'],
    ['clinic', 'Pretend Purple Platypus Care Circle'],
    ['legal-aid', 'Fictional Flying Teapot Tenant Desk'],
] as const;
const seededAt = new Date('2026-09-06T20:00:00.000Z');
const systemDid = 'did:plc:fictional-chicagoland';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const uuid = (value: string) => { const h = hash(value); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };

export const regionalManifest = hash(JSON.stringify({regionalAreas,requests,resources,people}));

export const regionalSeedCounts = { requests: regionalAreas.length * requests.length,
    organizations: regionalAreas.length * resources.length, resources: regionalAreas.length * resources.length };

/** Called inside the showcase transaction. Own keys only; never publishes to AT or sends notifications. */
export async function seedRegionalFiction(client: PoolClient): Promise<number> {
    let count = 0;
    const claim = async (entityType: string, key: string, table: string, keyColumn: string) => {
        // Reject even another seed's key: ownership is this exact regional seed version.
        const metadataCollision = await client.query(`SELECT 1 FROM showcase_record_metadata WHERE entity_type=$1 AND entity_key=$2
            AND (origin <> 'synthetic' OR seed_version IS DISTINCT FROM $3)`, [entityType,key,REGIONAL_SEED_VERSION]);
        if (metadataCollision.rowCount) throw new Error(`REGIONAL_SEED_METADATA_COLLISION: ${entityType}`);
        const existing = await client.query(`SELECT 1 FROM ${table} t WHERE t.${keyColumn}::text = $1
            AND NOT EXISTS (SELECT 1 FROM showcase_record_metadata m WHERE m.entity_type = $2
            AND m.entity_key = $1 AND m.origin = 'synthetic' AND m.seed_version = $3)`, [key, entityType, REGIONAL_SEED_VERSION]);
        if (existing.rowCount) throw new Error(`REGIONAL_SEED_KEY_COLLISION: ${entityType}`);
        await client.query(`INSERT INTO showcase_record_metadata (entity_type, entity_key, origin, seed_version, non_participation_disclosure, assigned_at)
            VALUES ($1,$2,'synthetic',$3,FALSE,$4) ON CONFLICT (entity_type, entity_key) DO NOTHING`, [entityType,key,REGIONAL_SEED_VERSION,seededAt]);
        count++;
    };
    for (const [areaIndex, [city, county, state, latitude, longitude]] of regionalAreas.entries()) {
        const area = `${city} · ${county} County, ${state}`;
        const areaSlug = slugify(`${state}-${county}-${city}`);
        for (const [index, [category, subject, detail]] of requests.entries()) {
            const uri = `at://${systemDid}/app.patchwork.aid.post/${areaSlug}-${index}`;
            const name = people[(areaIndex + index) % people.length]!;
            const title = `${name}: ${subject} in ${city}`;
            const description = `${name} is a fictional neighbor in ${area}. ${detail} Fictional listing for exploring Patchwork; no real assistance is needed.`;
            const updatedAt = new Date(seededAt.getTime() - ((areaIndex * 3 + index) % 48) * 3600000);
            await claim('aid-post', uri, 'indexer_aid_post_projections', 'uri');
            await client.query(`INSERT INTO indexer_aid_post_projections
                (uri, collection, author_did_hash, title, description, category, urgency, status, searchable_text,
                 latitude, longitude, precision_km, record_created_at, record_updated_at, source_cursor, source_event_id, projected_at, record_origin, seed_version)
                VALUES ($1,'app.patchwork.aid.post',$2,$3,$4,$5,$6,$7,$8,$9,$10,5,$11,$11,0,$12,$13,'synthetic',$14)
                ON CONFLICT (uri) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description,
                searchable_text=EXCLUDED.searchable_text, latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
                precision_km=EXCLUDED.precision_km, urgency=EXCLUDED.urgency, status=EXCLUDED.status`,
                [uri,hash(systemDid),title,description,category,['low','medium','high'][index % 3],
                 index === 7 && areaIndex % 4 === 0 ? 'resolved' : index === 5 && areaIndex % 3 === 0 ? 'in-progress' : 'open',
                 `${title} ${description}`.toLowerCase(),latitude,longitude,updatedAt,`fictional:${areaSlug}:request:${index}`,seededAt,REGIONAL_SEED_VERSION]);
        }
        for (const [index, [category, brand]] of resources.entries()) {
            const slug = `fictional-${areaSlug}-${index}`;
            const name = `${brand} — ${city}`;
            const id = uuid(slug);
            const uri = `at://${systemDid}/app.patchwork.directory.resource/${slug}`;
            const description = `A fictional organization serving ${area}. This is an invented listing, not a real service provider.`;
            await claim('organization', id, 'organizations', 'organization_id');
            await client.query(`INSERT INTO organizations (organization_id,slug,name,description,origin,non_endorsement_label,created_by_did,created_at,updated_at)
                VALUES ($1,$2,$3,$4,'synthetic','Fictional organization — no real services or contact.',$5,$6,$6)
                ON CONFLICT (organization_id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description`,
                [id,slug,name,description,systemDid,seededAt]);
            await claim('directory-resource', uri, 'indexer_directory_resource_projections', 'uri');
            await client.query(`INSERT INTO indexer_directory_resource_projections
                (uri,collection,author_did_hash,name,service_area,category,verification_status,contact,searchable_text,
                 latitude,longitude,precision_km,open_hours,eligibility_notes,operational_status,
                 record_created_at,record_updated_at,source_cursor,source_event_id,projected_at,record_origin,seed_version)
                VALUES ($1,'app.patchwork.directory.resource',$2,$3,$4,$5,'unverified',$6,$7,$8,$9,5,
                 'Fictional schedule: weekdays, 10–4','Fictional organization. No real services are available.','open',$10,$10,0,$11,$10,'synthetic',$12)
                ON CONFLICT (uri) DO UPDATE SET name=EXCLUDED.name,service_area=EXCLUDED.service_area,searchable_text=EXCLUDED.searchable_text`,
                [uri,hash(systemDid),name,area,category,JSON.stringify({url:`https://showcase.invalid/${slug}`}),
                 `${name} ${area} ${description}`.toLowerCase(),latitude,longitude,seededAt,`fictional:${areaSlug}:resource:${index}`,REGIONAL_SEED_VERSION]);
        }
    }
    await client.query(`INSERT INTO showcase_seed_runs(seed_version,manifest_sha256,applied_at,record_count)
        VALUES($1,$2,NOW(),$3) ON CONFLICT(seed_version) DO UPDATE SET manifest_sha256=EXCLUDED.manifest_sha256,applied_at=EXCLUDED.applied_at,record_count=EXCLUDED.record_count`,
        [REGIONAL_SEED_VERSION,regionalManifest,count]);
    return count;
}
