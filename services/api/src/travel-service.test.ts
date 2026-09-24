import { describe, expect, it, vi } from 'vitest';
import { TravelService } from './travel-service.js';

const input = {
    resourceUri: 'at://did:plc:publisher/app.patchwork.directory.resource/clinic',
    origin: { latitude: 41.881, longitude: -87.629 },
    dateTime: '2026-09-19T17:00:00.000Z',
    arriveBy: false,
    mode: 'transit' as const,
    wheelchair: true,
};

const pool = (rows: unknown[]) => ({
    query: vi.fn().mockResolvedValue({ rowCount: rows.length, rows }),
});

describe('TravelService', () => {
    it('sends the precise origin only to OTP and returns coordinate-free itineraries', async () => {
        const database = pool([{ latitude: '41.9001', longitude: '-87.6501' }]);
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: { planConnection: { routingErrors: [], edges: [{ node: {
                start: '2026-05-21T12:00:00-05:00',
                end: '2026-05-21T12:20:00-05:00',
                duration: 1200,
                walkDistance: 245.4,
                legs: [{
                    mode: 'BUS', startTime: 1_779_292_800_000,
                    endTime: 1_779_294_000_000, duration: 1200,
                    distance: 4321.8, from: { name: 'State & Lake' },
                    to: { name: 'Clinic' }, route: { shortName: '22', longName: null },
                }],
            } }] } },
        }), { status: 200 }));
        const service = new TravelService(database as never, 'http://otp/graphql', fetcher);

        const result = await service.plan(input);
        const upstream = JSON.parse(String(fetcher.mock.calls[0]![1]?.body)) as {
            variables: Record<string, unknown>;
        };
        expect(upstream.variables['origin']).toEqual({ location: { coordinate: { latitude: 41.881, longitude: -87.629 } } });
        expect(upstream.variables['destination']).toEqual({ location: { coordinate: { latitude: 41.9001, longitude: -87.6501 } } });
        expect(upstream.variables['preferences']).toEqual({ accessibility: { wheelchair: { enabled: true } } });
        expect(result.itineraries[0]?.legs[0]?.route).toBe('22');
        expect(JSON.stringify(result)).not.toContain('41.881');
        expect(JSON.stringify(result)).not.toContain('-87.629');
    });

    it('does not call OTP when no current public destination exists', async () => {
        const fetcher = vi.fn();
        const service = new TravelService(pool([]) as never, 'http://otp/graphql', fetcher);
        await expect(service.plan(input)).rejects.toMatchObject({
            statusCode: 404,
            code: 'ROUTING_DESTINATION_UNAVAILABLE',
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('fails closed on malformed OTP responses', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
        const service = new TravelService(pool([{ latitude: 41.9, longitude: -87.65 }]) as never, 'http://otp/graphql', fetcher);
        await expect(service.plan(input)).rejects.toMatchObject({
            statusCode: 502,
            code: 'ROUTING_INVALID_RESPONSE',
        });
    });
});
