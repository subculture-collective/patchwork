import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import en from './en.json';
import es from './es.json';
import {
    formatCurrency,
    formatDistance,
    formatLongDate,
    formatNumber,
    formatPercent,
    formatRelativeTime,
    formatShortDate,
} from './formatting';
import { defaultLocale, supportedLocales } from './types';

/**
 * Recursively extract all leaf-level dot-notation keys from a nested object.
 */
const extractKeys = (obj: Record<string, unknown>, prefix = ''): string[] => {
    const keys: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;

        if (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value)
        ) {
            keys.push(
                ...extractKeys(value as Record<string, unknown>, fullKey),
            );
        } else {
            keys.push(fullKey);
        }
    }

    return keys.sort();
};

describe('i18n translation key completeness', () => {
    const enKeys = extractKeys(en);
    const esKeys = extractKeys(es);

    it('English locale has translation keys', () => {
        expect(enKeys.length).toBeGreaterThan(0);
    });

    it('Spanish locale has translation keys', () => {
        expect(esKeys.length).toBeGreaterThan(0);
    });

    it('all English keys exist in Spanish translations', () => {
        const missingInEs = enKeys.filter((key) => !esKeys.includes(key));
        expect(missingInEs).toEqual([]);
    });

    it('all Spanish keys exist in English translations', () => {
        const missingInEn = esKeys.filter((key) => !enKeys.includes(key));
        expect(missingInEn).toEqual([]);
    });

    it('English and Spanish have the exact same set of keys', () => {
        expect(enKeys).toEqual(esKeys);
    });

    it('no English values are empty strings', () => {
        const emptyKeys = enKeys.filter((key) => {
            const value = key
                .split('.')
                .reduce<unknown>(
                    (obj, segment) =>
                        typeof obj === 'object' && obj !== null
                            ? (obj as Record<string, unknown>)[segment]
                            : undefined,
                    en,
                );
            return typeof value === 'string' && value.trim().length === 0;
        });
        expect(emptyKeys).toEqual([]);
    });

    it('no Spanish values are empty strings', () => {
        const emptyKeys = esKeys.filter((key) => {
            const value = key
                .split('.')
                .reduce<unknown>(
                    (obj, segment) =>
                        typeof obj === 'object' && obj !== null
                            ? (obj as Record<string, unknown>)[segment]
                            : undefined,
                    es,
                );
            return typeof value === 'string' && value.trim().length === 0;
        });
        expect(emptyKeys).toEqual([]);
    });
});

describe('production source localization', () => {
    it('contains no untranslated JSX copy outside explicit fixture-only routes', () => {
        const sourcePaths = [
            '../features/frontend-shell.tsx',
            '../auth/LoginPage.tsx',
            '../auth/SignupPage.tsx',
            '../auth/AuthCallbackPage.tsx',
            '../components/Badge.tsx',
            '../components/TextLink.tsx',
            '../components/map/InteractiveMap.tsx',
            '../features/exact-location-exchange.tsx',
            '../features/production-chat.tsx',
            '../features/request-actions.tsx',
            '../features/request-detail.tsx',
            '../features/resource-actions.tsx',
            '../features/production-groups.tsx',
        ].map((relative) => fileURLToPath(new URL(relative, import.meta.url)));
        const fixtureOnly = new Set([
            'LegacyFixtureVolunteerRoute',
            'ChatRoute',
            'SettingsRoute',
        ]);
        const translatableAttributes = new Set([
            'alt',
            'aria-label',
            'placeholder',
            'title',
        ]);
        const punctuationOnly = /^[\s·,:#()—–+P→-]+$/u;
        const technicalIdentifiers = new Set(['.subcult.tv']);
        const findings: string[] = [];
        for (const sourcePath of sourcePaths) {
            const file = ts.createSourceFile(
                sourcePath,
                readFileSync(sourcePath, 'utf8'),
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TSX,
            );
            const componentStack: string[] = [];
            const visit = (node: ts.Node): void => {
                let pushed = false;
                if (
                    ts.isVariableDeclaration(node) &&
                    ts.isIdentifier(node.name) &&
                    node.initializer &&
                    (ts.isArrowFunction(node.initializer) ||
                        ts.isFunctionExpression(node.initializer))
                ) {
                    componentStack.push(node.name.text);
                    pushed = true;
                }
                const component = componentStack.at(-1) ?? '<module>';
                if (!fixtureOnly.has(component)) {
                    let text: string | undefined;
                    if (ts.isJsxText(node)) {
                        text = node.text.replace(/\s+/g, ' ').trim();
                    } else if (
                        ts.isJsxAttribute(node) &&
                        translatableAttributes.has(node.name.getText(file)) &&
                        node.initializer &&
                        ts.isStringLiteral(node.initializer)
                    ) {
                        text = node.initializer.text.trim();
                    }
                    if (
                        text &&
                        !punctuationOnly.test(text) &&
                        !technicalIdentifiers.has(text)
                    ) {
                        const line =
                            file.getLineAndCharacterOfPosition(
                                node.getStart(file),
                            ).line + 1;
                        findings.push(`${component}:${line}: ${text}`);
                    }
                }
                ts.forEachChild(node, visit);
                if (pushed) componentStack.pop();
            };
            visit(file);
        }
        expect(findings).toEqual([]);
    });

    it('references only translation keys present in both locales', () => {
        const sourcePaths = [
            '../features/frontend-shell.tsx',
            '../auth/LoginPage.tsx',
            '../auth/SignupPage.tsx',
            '../auth/AuthCallbackPage.tsx',
            '../components/Badge.tsx',
            '../components/TextLink.tsx',
            '../components/map/InteractiveMap.tsx',
            '../features/exact-location-exchange.tsx',
            '../features/production-chat.tsx',
            '../features/request-actions.tsx',
            '../features/request-detail.tsx',
            '../features/resource-actions.tsx',
            '../features/production-groups.tsx',
        ].map((relative) => fileURLToPath(new URL(relative, import.meta.url)));
        const referenced = new Set<string>();
        const visit = (node: ts.Node): void => {
            if (
                ts.isCallExpression(node) &&
                ts.isIdentifier(node.expression) &&
                node.expression.text === 't' &&
                node.arguments[0] &&
                ts.isStringLiteral(node.arguments[0])
            ) {
                referenced.add(node.arguments[0].text);
            }
            ts.forEachChild(node, visit);
        };
        for (const sourcePath of sourcePaths) {
            const file = ts.createSourceFile(
                sourcePath,
                readFileSync(sourcePath, 'utf8'),
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TSX,
            );
            visit(file);
        }
        const has = (resource: Record<string, unknown>, key: string): boolean =>
            key
                .split('.')
                .reduce<unknown>(
                    (value, segment) =>
                        value && typeof value === 'object'
                            ? (value as Record<string, unknown>)[segment]
                            : undefined,
                    resource,
                ) !== undefined;
        const hasTranslation = (
            resource: Record<string, unknown>,
            key: string,
        ): boolean =>
            has(resource, key) ||
            (has(resource, `${key}_one`) && has(resource, `${key}_other`));
        expect(
            [...referenced].filter(
                (key) => !hasTranslation(en, key) || !hasTranslation(es, key),
            ),
        ).toEqual([]);
    });
});

describe('i18n locale configuration', () => {
    it('default locale is English', () => {
        expect(defaultLocale).toBe('en');
    });

    it('supported locales include English and Spanish', () => {
        expect(supportedLocales).toContain('en');
        expect(supportedLocales).toContain('es');
    });

    it('there are at least two supported locales', () => {
        expect(supportedLocales.length).toBeGreaterThanOrEqual(2);
    });
});

describe('formatting utilities - formatShortDate', () => {
    const testDate = new Date('2025-06-15T14:30:00Z');

    it('formats date in English locale', () => {
        const result = formatShortDate(testDate, 'en');
        expect(result).toContain('Jun');
        expect(result).toContain('15');
        expect(result).toContain('2025');
    });

    it('formats date in Spanish locale', () => {
        const result = formatShortDate(testDate, 'es');
        expect(result).toContain('jun');
        expect(result).toContain('15');
        expect(result).toContain('2025');
    });

    it('accepts string date input', () => {
        const result = formatShortDate('2025-06-15T14:30:00Z', 'en');
        expect(result).toContain('2025');
    });

    it('returns original string for invalid date', () => {
        const result = formatShortDate('not-a-date', 'en');
        expect(result).toBe('not-a-date');
    });
});

describe('formatting utilities - formatLongDate', () => {
    const testDate = new Date('2025-06-15T14:30:00Z');

    it('formats with time in English locale', () => {
        const result = formatLongDate(testDate, 'en');
        expect(result).toContain('June');
        expect(result).toContain('15');
        expect(result).toContain('2025');
    });

    it('formats with time in Spanish locale', () => {
        const result = formatLongDate(testDate, 'es');
        expect(result).toContain('junio');
        expect(result).toContain('15');
        expect(result).toContain('2025');
    });
});

describe('formatting utilities - formatRelativeTime', () => {
    const now = new Date('2025-06-15T14:30:00Z');

    it('formats seconds ago in English', () => {
        const date = new Date('2025-06-15T14:29:30Z');
        const result = formatRelativeTime(date, 'en', now);
        expect(result).toContain('second');
    });

    it('formats minutes ago in English', () => {
        const date = new Date('2025-06-15T14:00:00Z');
        const result = formatRelativeTime(date, 'en', now);
        expect(result).toContain('minute');
    });

    it('formats hours ago in English', () => {
        const date = new Date('2025-06-15T10:30:00Z');
        const result = formatRelativeTime(date, 'en', now);
        expect(result).toContain('hour');
    });

    it('formats days ago in English', () => {
        const date = new Date('2025-06-10T14:30:00Z');
        const result = formatRelativeTime(date, 'en', now);
        expect(result).toContain('day');
    });

    it('formats in Spanish locale', () => {
        const date = new Date('2025-06-15T14:00:00Z');
        const result = formatRelativeTime(date, 'es', now);
        expect(result).toContain('minuto');
    });
});

describe('formatting utilities - formatNumber', () => {
    it('formats number in English locale', () => {
        const result = formatNumber(1234567.89, 'en');
        expect(result).toContain('1,234,567.89');
    });

    it('formats number in Spanish locale', () => {
        const result = formatNumber(1234567.89, 'es');
        // Spanish uses period for thousands and comma for decimals
        expect(result).toContain('1.234.567,89');
    });
});

describe('formatting utilities - formatCurrency', () => {
    it('formats USD in English locale', () => {
        const result = formatCurrency(42.5, 'en');
        expect(result).toContain('$');
        expect(result).toContain('42.50');
    });

    it('formats USD in Spanish locale', () => {
        const result = formatCurrency(42.5, 'es');
        expect(result).toContain('US$');
    });
});

describe('formatting utilities - formatPercent', () => {
    it('formats percent in English locale', () => {
        const result = formatPercent(0.85, 'en');
        expect(result).toContain('85');
        expect(result).toContain('%');
    });

    it('formats percent in Spanish locale', () => {
        const result = formatPercent(0.85, 'es');
        expect(result).toContain('85');
        expect(result).toContain('%');
    });
});

describe('formatting utilities - formatDistance', () => {
    it('formats meters below 1000', () => {
        const result = formatDistance(500, 'en');
        expect(result).toContain('500');
        expect(result).toContain('m');
    });

    it('formats kilometers above 1000', () => {
        const result = formatDistance(2500, 'en');
        expect(result).toContain('2.5');
        expect(result).toContain('km');
    });

    it('formats distance in Spanish locale', () => {
        const result = formatDistance(2500, 'es');
        expect(result).toContain('2,5');
        expect(result).toContain('km');
    });
});

describe('fallback behavior', () => {
    it('formatShortDate falls back gracefully for invalid input', () => {
        const result = formatShortDate('invalid', 'en');
        expect(result).toBe('invalid');
    });

    it('formatLongDate falls back gracefully for invalid input', () => {
        const result = formatLongDate('invalid', 'en');
        expect(result).toBe('invalid');
    });

    it('formatRelativeTime falls back gracefully for invalid input', () => {
        const result = formatRelativeTime('invalid', 'en');
        expect(result).toBe('invalid');
    });
});
