import type { Pool } from 'pg';

export interface ProjectionComparisonRow {
    collection: 'aid-posts' | 'directory-resources' | 'volunteer-profiles';
    liveCount: number;
    shadowCount: number;
    missingFromShadow: number;
    extraInShadow: number;
    cidMismatches: number;
}

const TABLES = [
    ['aid-posts', 'indexer_aid_post_projections'],
    ['directory-resources', 'indexer_directory_resource_projections'],
    ['volunteer-profiles', 'indexer_volunteer_profile_projections'],
] as const;

export class PostgresProjectionComparison {
    constructor(private readonly pool: Pool) {}

    async compare(): Promise<ProjectionComparisonRow[]> {
        const rows: ProjectionComparisonRow[] = [];
        for (const [collection, table] of TABLES) {
            const result = await this.pool.query<{
                live_count: string;
                shadow_count: string;
                missing_from_shadow: string;
                extra_in_shadow: string;
                cid_mismatches: string;
            }>(
                `SELECT
                    (SELECT COUNT(*) FROM public.${table}) AS live_count,
                    (SELECT COUNT(*) FROM jetstream_v2_shadow.${table})
                        AS shadow_count,
                    (SELECT COUNT(*) FROM public.${table} live
                     LEFT JOIN jetstream_v2_shadow.${table} shadow USING (uri)
                     WHERE shadow.uri IS NULL) AS missing_from_shadow,
                    (SELECT COUNT(*) FROM jetstream_v2_shadow.${table} shadow
                     LEFT JOIN public.${table} live USING (uri)
                     WHERE live.uri IS NULL) AS extra_in_shadow,
                    (SELECT COUNT(*) FROM public.${table} live
                     JOIN jetstream_v2_shadow.${table} shadow USING (uri)
                     WHERE live.cid IS DISTINCT FROM shadow.cid)
                        AS cid_mismatches`,
            );
            const row = result.rows[0]!;
            rows.push({
                collection,
                liveCount: Number(row.live_count),
                shadowCount: Number(row.shadow_count),
                missingFromShadow: Number(row.missing_from_shadow),
                extraInShadow: Number(row.extra_in_shadow),
                cidMismatches: Number(row.cid_mismatches),
            });
        }
        return rows;
    }
}
