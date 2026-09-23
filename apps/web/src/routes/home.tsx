import { type DiscoveryFilterState } from '../discovery-filters';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { TextLink } from '../components/TextLink';
import { useLocale } from '../i18n';
import {
    type AppRoute,
} from '../app/routes';

const buildNearbyPatch = (): Partial<DiscoveryFilterState> => ({
    center: undefined,
    areaLabel: undefined,
    radiusMeters: undefined,
    feedTab: 'nearby',
});

interface DashboardRouteProps {
    onNavigate: (route: AppRoute) => void;
    discoveryState: DiscoveryFilterState;
    onPatchDiscovery: (patch: Partial<DiscoveryFilterState>) => void;
}

export const DashboardRoute = ({
    onNavigate,
    discoveryState,
    onPatchDiscovery,
}: DashboardRouteProps) => {
    const { t } = useLocale();
    return (
        <>
            <header className='mh-landing-hero'>
                <div className='mh-landing-hero__copy'>
                    <p className='mh-kicker'>{t('dashboard.eyebrow')}</p>
                    <h1 className='mh-landing-title'>
                        {t('dashboard.heading')}
                    </h1>
                    <p className='mh-landing-deck'>
                        {t('dashboard.description')}
                    </p>
                    <div className='mt-7 flex flex-wrap gap-3'>
                        <Button
                            onClick={() => {
                                onPatchDiscovery(buildNearbyPatch());
                                onNavigate('/map');
                            }}
                        >
                            {t('dashboard.browseNeeds')}
                        </Button>
                        <Button
                            variant='accent'
                            onClick={() => onNavigate('/posting')}
                        >
                            {t('dashboard.askForHelp')}
                        </Button>
                        <Button
                            variant='neutral'
                            onClick={() => onNavigate('/resources')}
                        >
                            {t('dashboard.findResources')}
                        </Button>
                    </div>
                    <p className='mh-landing-note'>
                        <span aria-hidden='true' />{' '}
                        {t('dashboard.locationPromise')}
                    </p>
                </div>

                <aside
                    className='mh-how-card'
                    aria-labelledby='how-patchwork-works'
                >
                    <div className='mh-how-card__patches' aria-hidden='true'>
                        <span />
                        <span />
                        <span />
                        <span />
                    </div>
                    <p className='mh-kicker'>{t('dashboard.howEyebrow')}</p>
                    <h2 id='how-patchwork-works' className='mh-how-card__title'>
                        {t('dashboard.howTitle')}
                    </h2>
                    <ol className='mt-5 grid gap-4'>
                        {(['discover', 'connect', 'coordinate'] as const).map(
                            (step, index) => (
                                <li key={step} className='mh-how-step'>
                                    <span
                                        className='mh-how-step__number'
                                        aria-hidden='true'
                                    >
                                        {index + 1}
                                    </span>
                                    <div>
                                        <h3 className='font-bold text-mh-text'>
                                            {t(`dashboard.${step}Title`)}
                                        </h3>
                                        <p className='mt-1 text-sm text-mh-textMuted'>
                                            {t(`dashboard.${step}Description`)}
                                        </p>
                                    </div>
                                </li>
                            ),
                        )}
                    </ol>
                </aside>
            </header>

            <section
                className='mh-landing-section'
                aria-labelledby='start-heading'
            >
                <div className='mh-landing-section__header'>
                    <div>
                        <p className='mh-kicker'>
                            {t('dashboard.startEyebrow')}
                        </p>
                        <h2
                            id='start-heading'
                            className='mh-landing-section__title'
                        >
                            {t('dashboard.startTitle')}
                        </h2>
                    </div>
                    <p>{t('dashboard.startDescription')}</p>
                </div>

                <div className='grid gap-4 md:grid-cols-3'>
                    <button
                        type='button'
                        className='mh-path-card mh-path-card--needs'
                        onClick={() => {
                            onPatchDiscovery(buildNearbyPatch());
                            onNavigate('/feed');
                        }}
                    >
                        <span
                            className='mh-path-card__index'
                            aria-hidden='true'
                        >
                            {t('dashboard.needsIndex')}
                        </span>
                        <span className='mh-path-card__title'>
                            {t('dashboard.needsTitle')}
                        </span>
                        <span className='mh-path-card__description'>
                            {t('dashboard.needsDescription')}
                        </span>
                        <span className='mh-path-card__link'>
                            {t('dashboard.needsAction')}{' '}
                            <span aria-hidden='true'>→</span>
                        </span>
                    </button>
                    <button
                        type='button'
                        className='mh-path-card mh-path-card--offer'
                        onClick={() => onNavigate('/volunteer')}
                    >
                        <span
                            className='mh-path-card__index'
                            aria-hidden='true'
                        >
                            {t('dashboard.offerIndex')}
                        </span>
                        <span className='mh-path-card__title'>
                            {t('dashboard.offerTitle')}
                        </span>
                        <span className='mh-path-card__description'>
                            {t('dashboard.offerDescription')}
                        </span>
                        <span className='mh-path-card__link'>
                            {t('dashboard.offerAction')}{' '}
                            <span aria-hidden='true'>→</span>
                        </span>
                    </button>
                    <button
                        type='button'
                        className='mh-path-card mh-path-card--resources'
                        onClick={() => onNavigate('/resources')}
                    >
                        <span
                            className='mh-path-card__index'
                            aria-hidden='true'
                        >
                            {t('dashboard.resourcesIndex')}
                        </span>
                        <span className='mh-path-card__title'>
                            {t('dashboard.resourcesTitle')}
                        </span>
                        <span className='mh-path-card__description'>
                            {t('dashboard.resourcesDescription')}
                        </span>
                        <span className='mh-path-card__link'>
                            {t('dashboard.resourcesAction')}{' '}
                            <span aria-hidden='true'>→</span>
                        </span>
                    </button>
                </div>
            </section>

            <section
                className='mh-nearby-band'
                aria-labelledby='nearby-heading'
            >
                <div>
                    <p className='mh-kicker'>{t('dashboard.nearbyEyebrow')}</p>
                    <h2 id='nearby-heading' className='mh-nearby-band__title'>
                        {t('dashboard.nearbyTitle')}
                    </h2>
                    <p className='mt-2 max-w-xl text-sm text-mh-textMuted sm:text-base'>
                        {t('dashboard.nearbyDescription')}
                    </p>
                </div>
                <div className='mh-nearby-band__search'>
                    <label htmlFor='search-requests' className='sr-only'>
                        {t('dashboard.searchRequests')}
                    </label>
                    <Input
                        id='search-requests'
                        name='searchRequests'
                        autoComplete='off'
                        placeholder={String(t('discovery.searchPlaceholder'))}
                        value={discoveryState.text ?? ''}
                        onChange={(event) => {
                            const nextValue = event.target.value.trim();
                            onPatchDiscovery({
                                text:
                                    nextValue.length > 0
                                        ? nextValue
                                        : undefined,
                            });
                        }}
                    />
                    <Button
                        onClick={() => {
                            onPatchDiscovery(buildNearbyPatch());
                            onNavigate('/map');
                        }}
                    >
                        {t('dashboard.exploreMap')}
                    </Button>
                </div>
            </section>

            <section
                className='mh-trust-section'
                aria-labelledby='trust-heading'
            >
                <div className='mh-trust-section__intro'>
                    <p className='mh-kicker'>{t('dashboard.trustEyebrow')}</p>
                    <h2
                        id='trust-heading'
                        className='mh-landing-section__title'
                    >
                        {t('dashboard.trustTitle')}
                    </h2>
                    <p>{t('dashboard.trustDescription')}</p>
                </div>
                <ul className='mh-trust-list'>
                    <li>
                        <strong>{t('dashboard.approximateTitle')}</strong>
                        <span>{t('dashboard.approximateDescription')}</span>
                    </li>
                    <li>
                        <strong>{t('dashboard.privateTitle')}</strong>
                        <span>{t('dashboard.privateDescription')}</span>
                    </li>
                    <li>
                        <strong>{t('dashboard.controlTitle')}</strong>
                        <span>{t('dashboard.controlDescription')}</span>
                    </li>
                </ul>
            </section>

            <aside className='mh-safety-note' aria-labelledby='safety-heading'>
                <div>
                    <p className='mh-kicker'>{t('dashboard.safetyEyebrow')}</p>
                    <h2
                        id='safety-heading'
                        className='font-heading text-xl font-bold'
                    >
                        {t('dashboard.notEmergency')}
                    </h2>
                </div>
                <p>
                    {t('dashboard.safetyDescription')}{' '}
                    <TextLink href='/legal/community-guidelines'>
                        {t('dashboard.communityGuidelines')}
                    </TextLink>
                    {t('dashboard.safetySuffix')}
                </p>
            </aside>
        </>
    );
};
