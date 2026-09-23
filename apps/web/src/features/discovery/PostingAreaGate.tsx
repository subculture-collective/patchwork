import type { DiscoveryFilterState } from '../../discovery-filters';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { Surface } from '../../components/Surface';
import { useLocale } from '../../i18n';
import { useApproximateLocation } from './useApproximateLocation';

interface PostingAreaGateProps {
    state: DiscoveryFilterState;
    onPatch: (patch: Partial<DiscoveryFilterState>) => void;
    onChooseOnMap: () => void;
}

/**
 * Asks for an approximate area before the request form. Unlike discovery,
 * posting never falls back to the demonstration area: the area is published.
 */
export const PostingAreaGate = ({
    state,
    onPatch,
    onChooseOnMap,
}: PostingAreaGateProps) => {
    const { t } = useLocale();
    const { access, request } = useApproximateLocation(state, onPatch, {
        auto: false,
        fallbackToDemo: false,
    });
    return (
        <section>
            <PageHeader
                title={t('posting.heading')}
                description={t('posting.areaStepHelp')}
            />
            <Surface
                title={t('posting.areaStepTitle')}
                className='max-w-2xl'
            >
                <p className='text-mh-textMuted'>{t('posting.areaRequired')}</p>
                {access === 'denied' ? (
                    <Banner tone='warning' className='mt-4'>
                        {t('posting.locationDenied')}
                    </Banner>
                ) : null}
                <div className='mt-5 flex flex-wrap gap-2'>
                    <Button
                        onClick={request}
                        disabled={access === 'requesting'}
                    >
                        {access === 'requesting'
                            ? t('discovery.locationRequestingButton')
                            : t('posting.useMyArea')}
                    </Button>
                    <Button variant='secondary' onClick={onChooseOnMap}>
                        {t('posting.chooseOnMap')}
                    </Button>
                </div>
            </Surface>
        </section>
    );
};
