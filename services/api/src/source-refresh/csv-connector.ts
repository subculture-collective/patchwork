import { evidenceByteLimit } from './evidence-storage.js';
import { PublisherValidationError } from './publisher-validation-error.js';

export interface CsvContract {
    columns: readonly string[];
    idColumn: string;
    minRows: number;
    maxRows: number;
    maxBytes: number;
    maxCellCharacters: number;
}
const invalid = (message: string): never => { throw new PublisherValidationError(`CSV ${message}`); };

/** Strict UTF-8 CSV. Values remain strings; geographic/service semantics belong to adapters. */
export function parsePublisherCsv(raw: Uint8Array, contract: CsvContract): ReadonlyArray<Readonly<Record<string, string>>> {
    evidenceByteLimit(contract.maxBytes);
    if (!Number.isSafeInteger(contract.minRows) || !Number.isSafeInteger(contract.maxRows)
        || contract.minRows < 1 || contract.maxRows < contract.minRows || contract.maxRows > 100_000
        || !Number.isSafeInteger(contract.maxCellCharacters) || contract.maxCellCharacters < 1 || contract.maxCellCharacters > 32_768
        || contract.columns.length < 1 || contract.columns.length > 128
        || contract.columns.some(column => !column.trim() || column.length > contract.maxCellCharacters)
        || new Set(contract.columns).size !== contract.columns.length || !contract.columns.includes(contract.idColumn)) {
        throw new Error('Invalid CSV source contract.');
    }
    if (!raw.length || raw.length > contract.maxBytes) invalid('evidence exceeds its byte budget.');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
    catch { return invalid('requires valid UTF-8 bytes.'); }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) invalid('contains unsupported control characters.');
    const records: Readonly<Record<string, string>>[] = [];
    const ids = new Set<string>();
    let header = false; let fields: string[] = []; let cell = '';
    let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
    const append = (value: string) => {
        cell += value;
        if (cell.length > contract.maxCellCharacters) invalid('cell exceeds its character budget.');
    };
    const finishCell = () => {
        fields.push(cell); cell = ''; state = 'start';
        if (fields.length > contract.columns.length) invalid('row has too many columns.');
    };
    const finishRow = () => {
        finishCell();
        if (fields.length !== contract.columns.length) invalid('row column count changed.');
        if (!header) {
            if (fields.some((value, index) => value !== contract.columns[index])) invalid('header does not match the reviewed schema.');
            header = true;
        } else {
            if (records.length >= contract.maxRows) invalid('row count exceeds complete-feed bounds.');
            const record = Object.fromEntries(contract.columns.map((column, index) => [column, fields[index]!]));
            const id = record[contract.idColumn]!;
            if (!id.trim() || id !== id.trim() || ids.has(id)) invalid('stable identifier is empty, ambiguous or duplicated.');
            ids.add(id); records.push(Object.freeze(record));
        }
        fields = [];
    };
    for (let index = 0; index < text.length; index++) {
        const char = text[index]!;
        if (state === 'quoted') {
            if (char === '"') {
                if (text[index + 1] === '"') { append('"'); index++; }
                else state = 'closed';
            } else append(char);
            continue;
        }
        if (char === ',') { finishCell(); continue; }
        if (char === '\r' || char === '\n') {
            if (char === '\r') {
                if (text[index + 1] !== '\n') invalid('bare carriage return outside a quoted cell.');
                index++;
            }
            finishRow(); continue;
        }
        if (state === 'closed') invalid('unexpected text after a closing quote.');
        if (char === '"') {
            if (state !== 'start') invalid('unexpected quote in an unquoted cell.');
            state = 'quoted';
        } else { state = 'plain'; append(char); }
    }
    if (state === 'quoted') invalid('quoted cell is incomplete.');
    if (state !== 'start' || fields.length > 0 || cell.length > 0) finishRow();
    if (!header || records.length < contract.minRows) invalid('row count is below complete-feed bounds.');
    return Object.freeze(records);
}
