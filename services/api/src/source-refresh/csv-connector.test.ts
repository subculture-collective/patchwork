import { expect, it } from 'vitest';
import { parsePublisherCsv, type CsvContract } from './csv-connector.js';
const contract: CsvContract = { columns: ['id', 'name', 'postal'], idColumn: 'id', minRows: 1, maxRows: 3, maxBytes: 2000, maxCellCharacters: 100 };
const parse = (text: string, policy = contract) => parsePublisherCsv(Buffer.from(text), policy);
it('preserves postal zeros, Unicode, quoted commas, escaped quotes and multiline values', () => {
    const text = '\ufeffid,name,postal\r\n001,"Centro, ayuda ""Sí""\r\nDeux",00123\r\n';
    const expected = [{ id: '001', name: 'Centro, ayuda "Sí"\r\nDeux', postal: '00123' }];
    expect(parse(text)).toEqual(expected); expect(parse(text)).toEqual(parse(text));
});
it('accepts explicit empty cells and optional final LF without numeric inference', () => {
    expect(parse('id,name,postal\na,,00000')).toEqual([{ id: 'a', name: '', postal: '00000' }]);
    expect(parse('id,name,postal\na,name,\n')).toEqual([{ id: 'a', name: 'name', postal: '' }]);
});
it.each([
    ['id,name,postal\na,"unfinished,123', 'incomplete'],
    ['id,name,postal\na,"done"extra,123', 'closing quote'],
    ['id,name,postal\na,un"quoted,123', 'unexpected quote'],
    ['id,name,postal\na,name', 'column count'],
    ['id,name,postal\na,name,123,extra', 'too many'],
    ['id,NAME,postal\na,name,123', 'header'],
    ['id,name,postal\na,name,123\na,other,234', 'identifier'],
    ['id,name,postal\n,name,123', 'identifier'],
    ['id,name,postal\n a,name,123', 'identifier'],
    ['id,name,postal\n', 'below'],
    ['id,name,postal\ra,name,123', 'carriage return'],
])('rejects incomplete or ambiguous input: %s', (text, error) => {
    expect(() => parse(text)).toThrow(error);
});
it('enforces source byte, row, cell and encoding budgets', () => {
    expect(() => parse('id,name,postal\na,name,123', { ...contract, maxBytes: 2 })).toThrow('byte');
    expect(() => parse('id,name,postal\na,name,123\nb,name,234', { ...contract, maxRows: 1 })).toThrow('row count');
    expect(() => parse('id,name,postal\na,' + 'x'.repeat(101) + ',123')).toThrow('cell');
    expect(() => parsePublisherCsv(new Uint8Array([0xff]), contract)).toThrow('UTF-8');
    expect(() => parse('id,name,postal\na,\u0000,123')).toThrow('control');
});
it('rejects invalid source contracts before parsing publisher data', () => {
    expect(() => parse('', { ...contract, columns: ['id', 'id'] })).toThrow('contract');
    expect(() => parse('', { ...contract, idColumn: 'missing' })).toThrow('contract');
});
