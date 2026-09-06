import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { createIdempotentMutation } from './idempotent-mutation.js';
import type { IdempotentCommand } from './idempotency-store.js';

const request = new IncomingMessage(new Socket());
request.method = 'POST';
request.url = '/coordination/offers';
request.headers = { 'idempotency-key': 'durable-retry-1' };

describe('HTTP idempotency and strict domain command compatibility', () => {
    it('keeps retry metadata durable without adding fields rejected by newer domain schemas', async () => {
        const recorded: IdempotentCommand[] = [];
        const execute = createIdempotentMutation({ execute: async (command, effect) => { recorded.push(command); return effect(); } });
        const schema = z.object({ requestUri: z.string(), note: z.string() }).strict();
        const body = { requestUri: 'at://did:plc:testing/app.patchwork.aid.post/one', note: 'Offer help' };
        expect(await execute(request, 'did:plc:helper', body, async (command, key) => ({ statusCode: 201, body: { ...schema.parse(command), key } }))).toMatchObject({ statusCode: 201, body: { key: 'durable-retry-1' } });
        expect(recorded[0]).toMatchObject({ idempotencyKey: 'durable-retry-1', body });
        expect(body).not.toHaveProperty('commandId');
    });
    it('retains explicit legacy command IDs and permits body-only overrides for AT writes', async () => {
        const execute = createIdempotentMutation({ execute: async (_command, effect) => effect() }, 'commandId');
        expect(await execute(request, 'did:plc:owner', {}, async command => ({statusCode: 200, body: command}))).toMatchObject({body:{commandId:'durable-retry-1'}});
        expect(await execute(request, 'did:plc:owner', {}, async command => ({statusCode: 200, body: command}), null)).toEqual({statusCode:200,body:{}});
    });
});
