import { Panel } from '../components/Panel';
import { useLocale } from '../i18n';

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
            <header className='mh-route-header'>
                <p className='mh-kicker'>{t('legal.draft')}</p>
                <h1 className='mh-route-title'>{content.title}</h1>
                <p className='mt-2 max-w-3xl text-mh-textMuted'>
                    {content.summary}
                </p>
            </header>
            <Panel title={t('legal.summaryTitle')}>
                <ul className='list-disc space-y-2 pl-5'>
                    {content.points.map((point) => (
                        <li key={point}>{point}</li>
                    ))}
                </ul>
                <p className='mt-4 text-sm font-bold'>{t('legal.noGo')}</p>
            </Panel>
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
