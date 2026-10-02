import { useLocale } from '../i18n';
import { Surface } from '../components/Surface';
import { PageHeader } from '../components/PageHeader';

export const LegalPolicyRoute = ({
    route,
}: {
    route: '/legal/terms' | '/legal/privacy' | '/legal/community-guidelines';
}) => {
    const { t } = useLocale();
    const content =
        route === '/legal/terms'
            ? {
                  title: t('legal.termsTitle'),
                  summary: t('legal.termsSummary'),
                  points: [
                      t('legal.terms1'),
                      t('legal.terms2'),
                      t('legal.terms3'),
                      t('legal.terms4'),
                  ],
              }
            : route === '/legal/privacy'
              ? {
                    title: t('legal.privacyTitle'),
                    summary: t('legal.privacySummary'),
                    points: [
                        t('legal.privacy1'),
                        t('legal.privacy2'),
                        t('legal.privacy3'),
                        t('legal.privacy4'),
                        t('legal.privacy5'),
                    ],
                }
              : {
                    title: t('legal.guidelinesTitle'),
                    summary: t('legal.guidelinesSummary'),
                    points: [
                        t('legal.guidelines1'),
                        t('legal.guidelines2'),
                        t('legal.guidelines3'),
                        t('legal.guidelines4'),
                    ],
                };
    return (
        <section className='space-y-6'>
            <PageHeader
                eyebrow={t('legal.draft')}
                title={content.title}
                description={content.summary}
            />
            <Surface title={t('legal.summaryTitle')}>
                <ul className='list-disc space-y-2 pl-5'>
                    {content.points.map((point) => (
                        <li key={point}>{point}</li>
                    ))}
                </ul>
                <p className='mt-4 text-sm font-bold'>{t('legal.noGo')}</p>
            </Surface>
            <nav
                aria-label={t('legal.navLabel')}
                className='flex flex-wrap gap-4'
            >
                <a className='mh-link' href='/legal/terms'>
                    {t('legal.termsNav')}
                </a>
                <a className='mh-link' href='/legal/privacy'>
                    {t('legal.privacyNav')}
                </a>
                <a className='mh-link' href='/legal/community-guidelines'>
                    {t('legal.guidelinesNav')}
                </a>
            </nav>
        </section>
    );
};
