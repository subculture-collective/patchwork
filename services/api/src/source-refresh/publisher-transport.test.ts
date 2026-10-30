import { expect, it, vi } from 'vitest';
import { fetchPublisherBytes } from './publisher-transport.js';
const policy = { url: 'https://publisher.example/feed.csv', maxBytes: 20, contentTypes: ['text/csv'] };
it('retains exact streamed bytes and bounded metadata using a redirect-free request', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('a,b\r\n1,2', { headers: { 'content-type': 'text/csv; charset=utf-8', etag: 'v1' } }));
    const result = await fetchPublisherBytes(policy, fetcher);
    expect(Buffer.from(result.raw).toString()).toBe('a,b\r\n1,2'); expect(result.etag).toBe('v1');
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ redirect: 'error', headers: { accept: 'text/csv' } });
});
it.each([
    ['HTTP 429', () => new Response('busy', { status: 429 })],
    ['text/csv', () => new Response('{}', { headers: { 'content-type': 'application/json' } })],
    ['empty', () => new Response('', { headers: { 'content-type': 'text/csv' } })],
    ['size', () => new Response('a'.repeat(21), { headers: { 'content-type': 'text/csv' } })],
    ['size', () => new Response('abc', { headers: { 'content-type': 'text/csv', 'content-length': '30' } })],
    ['metadata', () => new Response('abc', { headers: { 'content-type': 'text/csv', etag: 'x'.repeat(1001) } })],
])('rejects invalid publisher responses: %s', async (message, response) => {
    await expect(fetchPublisherBytes(policy, async () => response())).rejects.toThrow(message);
});
it('rejects changed response URLs and unsafe policy before fetching', async () => {
    const response = new Response('abc', { headers: { 'content-type': 'text/csv' } });
    Object.defineProperty(response, 'url', { value: 'https://other.example/feed' });
    await expect(fetchPublisherBytes(policy, async () => response)).rejects.toThrow('URL');
    const fetcher = vi.fn<typeof fetch>();
    for (const url of ['http://publisher.example/feed', 'https://user:password@publisher.example/feed', 'https://publisher.example/feed#fragment']) {
        await expect(fetchPublisherBytes({ ...policy, url }, fetcher)).rejects.toThrow('HTTPS');
    }
    expect(fetcher).not.toHaveBeenCalled();
});
it('cancels an over-budget stream before consuming the next page-sized chunk', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(21)); }, cancel });
    await expect(fetchPublisherBytes(policy, async () => new Response(body, { headers: { 'content-type': 'text/csv' } }))).rejects.toThrow('size');
    expect(cancel).toHaveBeenCalledOnce();
});
