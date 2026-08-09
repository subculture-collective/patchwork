import { describe, expect, it } from 'vitest';
import i18n from './index.js';

describe.each(['en', 'es'] as const)('%s record action labels', locale => {
    it('distinguishes actions for records with identical titles', () => {
        const t = i18n.getFixedT(locale);
        const action = t('safety.reportLabel', { title: 'Same title' });
        const first = t('safety.positionedAction', {
            action,
            position: 1,
            total: 2,
        });
        const second = t('safety.positionedAction', {
            action,
            position: 2,
            total: 2,
        });

        expect(first).not.toBe(second);
        expect(first).toContain('1');
        expect(second).toContain('2');
    });
});
