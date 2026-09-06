import type { IncomingMessage } from 'node:http';
import { PublicHttpError } from './error-response.js';
import { idempotencyKeyFromRequest, withIdempotencyKey } from './idempotent-request.js';
import type { PostgresIdempotencyExecutor, IdempotentResponse } from './idempotency-store.js';

type CommandKeyField = 'commandId' | 'idempotencyKey' | null;
/** HTTP retry identity stays outside strict domain payloads unless a legacy contract requires it. */
export const createIdempotentMutation = (
    executor: Pick<PostgresIdempotencyExecutor, 'execute'> | undefined,
    defaultField: CommandKeyField = null,
) => async (
    request: IncomingMessage,
    actorDid: string,
    body: unknown,
    effect: (body: Record<string, unknown>, key: string) => Promise<IdempotentResponse>,
    field: CommandKeyField = defaultField,
): Promise<IdempotentResponse> => {
    if (!executor) throw new PublicHttpError(503, 'IDEMPOTENCY_STORE_UNAVAILABLE', 'Durable command processing is unavailable.');
    const idempotencyKey = idempotencyKeyFromRequest(request);
    const commandBody = field ? withIdempotencyKey(body, idempotencyKey, field) : { ...(body as Record<string, unknown>) };
    return executor.execute({actorDid, method: request.method ?? 'POST', pathname: new URL(request.url ?? '/', 'http://localhost').pathname, idempotencyKey, body: commandBody}, () => effect(commandBody, idempotencyKey));
};
