import type { IncomingMessage,ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import type { TravelService } from '../travel-service.js';
import { PublicHttpError,writeJsonResponse,writePublicError } from './error-response.js';
import { readJsonBody } from './json-body.js';
export const createTravelHandler=(service:TravelService)=>(request:IncomingMessage,response:ServerResponse,url:URL):boolean=>{
    if(url.pathname!=='/travel/plan')return false;
    response.setHeader('cache-control','no-store');response.setHeader('referrer-policy','no-referrer');
    if(request.method!=='POST'){writeJsonResponse(response,405,{error:{code:'METHOD_NOT_ALLOWED',message:'Use POST.'}});return true;}
    const controller=new AbortController();request.once('aborted',()=>controller.abort());
    void readJsonBody(request,8192).then(body=>service.plan(body,controller.signal)).then(result=>writeJsonResponse(response,200,result)).catch(error=>{
        if(error instanceof ZodError)writePublicError(response,new PublicHttpError(400,'INVALID_TRAVEL_REQUEST','Check the travel details and try again.'));
        else writePublicError(response,error);
    });
    return true;
};
