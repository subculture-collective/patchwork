import type { Pool } from 'pg';
import { z } from 'zod';
import { PublicHttpError } from './http/error-response.js';

const requestSchema = z.object({
    resourceUri: z.string().min(1).max(500),
    origin: z.object({ latitude:z.number().min(40.5).max(43), longitude:z.number().min(-89.5).max(-86.5) }).strict(),
    dateTime: z.string().datetime(), arriveBy: z.boolean().default(false),
    mode: z.enum(['walk','transit']).default('transit'), wheelchair: z.boolean().default(false),
}).strict();
const otpSchema = z.object({ data:z.object({ planConnection:z.object({
    routingErrors:z.array(z.object({description:z.string().nullable().optional()}).passthrough()).default([]),
    edges:z.array(z.object({node:z.object({
        start:z.string().datetime({offset:true}), end:z.string().datetime({offset:true}), duration:z.number(), walkDistance:z.number().default(0),
        legs:z.array(z.object({ mode:z.string(), startTime:z.number(), endTime:z.number(), duration:z.number(), distance:z.number().default(0),
            from:z.object({name:z.string().nullable().optional()}).passthrough(), to:z.object({name:z.string().nullable().optional()}).passthrough(),
            route:z.object({shortName:z.string().nullable().optional(),longName:z.string().nullable().optional()}).nullable().optional(),
        }).passthrough()),
    }).passthrough()}).passthrough()).default([]),
}).passthrough() }).passthrough(), errors:z.array(z.object({message:z.string()}).passthrough()).optional() }).passthrough();

const query = `query PatchworkTravel($origin: PlanLabeledLocationInput!, $destination: PlanLabeledLocationInput!, $dateTime: PlanDateTimeInput!, $modes: PlanModesInput!, $preferences: PlanPreferencesInput) {
  planConnection(origin:$origin,destination:$destination,dateTime:$dateTime,modes:$modes,preferences:$preferences,first:3,searchWindow:"PT1H") {
    routingErrors { description }
    edges { node { start end duration walkDistance legs { mode startTime endTime duration distance from { name } to { name } route { shortName longName } } } }
  }
}`;

export class TravelService {
    private active = 0;
    constructor(private readonly pool: Pool, private readonly endpoint: string, private readonly fetcher: typeof fetch = fetch) {}
    async plan(body: unknown, callerSignal?: AbortSignal) {
        const input=requestSchema.parse(body);
        if(this.active>=8) throw new PublicHttpError(503,'ROUTING_BUSY','Travel planning is busy. Try again shortly.');
        const destination=await this.pool.query(`SELECT latitude,longitude FROM eligible_public_resource_addresses
            WHERE resource_uri=$1 ORDER BY basis DESC,valid_until DESC LIMIT 1`,[input.resourceUri]);
        if(!destination.rowCount) throw new PublicHttpError(404,'ROUTING_DESTINATION_UNAVAILABLE','A current public destination address is unavailable.');
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),10_000);
        const abort=()=>controller.abort(); callerSignal?.addEventListener('abort',abort,{once:true});
        this.active++;
        try {
            const response=await this.fetcher(this.endpoint,{method:'POST',headers:{'content-type':'application/json','accept-language':'en'},signal:controller.signal,
                body:JSON.stringify({query,operationName:'PatchworkTravel',variables:{
                    origin:{location:{coordinate:{latitude:input.origin.latitude,longitude:input.origin.longitude}}},
                    destination:{location:{coordinate:{latitude:Number(destination.rows[0].latitude),longitude:Number(destination.rows[0].longitude)}}},
                    dateTime:input.arriveBy?{latestArrival:input.dateTime}:{earliestDeparture:input.dateTime},
                    modes:input.mode==='walk'?{direct:['WALK'],directOnly:true}:{direct:['WALK'],transit:{access:['WALK'],egress:['WALK'],transfer:['WALK']}},
                    preferences:input.wheelchair?{accessibility:{wheelchair:{enabled:true}}}:null,
                }})});
            if(!response.ok) throw new PublicHttpError(503,'ROUTING_UNAVAILABLE','Travel planning is temporarily unavailable.');
            const raw:unknown=await response.json();
            const parsed=otpSchema.safeParse(raw);
            if(!parsed.success || parsed.data.errors?.length || parsed.data.data.planConnection.routingErrors.length) throw new PublicHttpError(502,'ROUTING_INVALID_RESPONSE','The routing service returned an invalid response.');
            return { itineraries:parsed.data.data.planConnection.edges.map(edge=>edge.node).map(itinerary=>({
                startTime:new Date(itinerary.start).toISOString(),endTime:new Date(itinerary.end).toISOString(),
                durationSeconds:Math.round(itinerary.duration),walkDistanceMeters:Math.round(itinerary.walkDistance),
                legs:itinerary.legs.map(leg=>({mode:leg.mode,startTime:new Date(leg.startTime).toISOString(),endTime:new Date(leg.endTime).toISOString(),
                    durationSeconds:Math.round(leg.duration),distanceMeters:Math.round(leg.distance),from:leg.from.name??'',to:leg.to.name??'',
                    route:leg.route?.shortName??leg.route?.longName??undefined})),
            })) };
        } catch(error) {
            if(error instanceof PublicHttpError) throw error;
            if(controller.signal.aborted) throw new PublicHttpError(504,'ROUTING_TIMEOUT','Travel planning took too long. Try again.');
            throw new PublicHttpError(503,'ROUTING_UNAVAILABLE','Travel planning is temporarily unavailable.');
        } finally { clearTimeout(timer);callerSignal?.removeEventListener('abort',abort);this.active--; }
    }
}
