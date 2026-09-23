import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccountName, accountLabel } from './AccountName';
import { shortenDid } from './useHandles';

describe('account names', () => {
    it('prefers a verified handle and keeps the DID as the title', () => {
        const html = renderToStaticMarkup(
            <AccountName did='did:plc:abcdefghijklmnop' handles={{ 'did:plc:abcdefghijklmnop': 'alice.example' }} />,
        );
        expect(html).toContain('@alice.example');
        expect(html).toContain('title="did:plc:abcdefghijklmnop"');
    });

    it('shortens long DIDs when no handle is known', () => {
        expect(shortenDid('did:plc:abcdefghijklmnop')).toBe('did:plc:abcd…mnop');
        expect(shortenDid('did:plc:short')).toBe('did:plc:short');
        expect(accountLabel('did:plc:abcdefghijklmnop', {})).toBe('did:plc:abcd…mnop');
    });
});
