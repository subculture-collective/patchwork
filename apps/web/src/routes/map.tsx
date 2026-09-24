import type { DiscoveryMapAggregates } from '@patchwork/shared';
import type { DiscoveryFilterState } from '../discovery-filters';
import type { ResourceDirectoryCard } from '../resource-directory-ux';
import type { MapTriageAction } from '../map-ux';
import type { ChatEntrySurface } from '../chat-ux';
import type { ApiDataOrigin } from '../features/api-client';
import type { FeedRecordEnvelope } from '../features/discovery-runtime';
import { MapRoute as RequestMap } from '../features/map-route';
import { DiscoveryControls } from '../features/discovery-controls';
import { DiscoveryLocationContext, useDiscoveryLocationController } from '../features/discovery-location';
import { ResourceExplorer } from './resource-explorer';
import { Button } from '../components/Button';
import { useLocale } from '../i18n';
import '../styles/resource-explorer.css';
import '../styles/request-map.css';
interface MapRouteProps {
    aggregates?: DiscoveryMapAggregates;
    discoveryState: DiscoveryFilterState;
    onPatchDiscovery: (patch: Partial<DiscoveryFilterState>) => void;
    onPushDiscovery: (patch: Partial<DiscoveryFilterState>) => void;
    feedRecords: readonly FeedRecordEnvelope[];
    resourceCards: readonly ResourceDirectoryCard[];
    resourceErrorMessage?: string;
    isLoading: boolean;
    errorMessage?: string;
    dataOrigin: ApiDataOrigin;
    onRetry: () => void;
    hasNextPage: boolean;
    total: number;
    onLoadMore: () => void;
    onRetryResources: () => void;
    selectedPostId?: string;
    onSelectPost: (id: string | undefined) => void;
    onTriageAction: (postId: string, action: MapTriageAction) => void;
    onOpenChat: (record: FeedRecordEnvelope, surface: ChatEntrySurface) => void;
}

export const MapRoute = (props: MapRouteProps) => {
    const { t } = useLocale();
    const requests = props.discoveryState.nearbyIntent === 'requests';
    const location = useDiscoveryLocationController(props.discoveryState, props.onPatchDiscovery, requests, t('discovery.nearYou'));
    return <div className={requests ? 'pw-request-map' : 'pw-map-page'}>
        <div className='pw-map-modes' role='group' aria-label={t('mapExplorer.mode')}>
            <Button size='sm' variant={!requests ? 'primary' : 'ghost'} aria-pressed={!requests} onClick={() => props.onPatchDiscovery({ nearbyIntent: 'resources' })}>{t('mapExplorer.resources')}</Button>
            <Button size='sm' variant={requests ? 'primary' : 'ghost'} aria-pressed={requests} onClick={() => props.onPatchDiscovery({ nearbyIntent: 'requests' })}>{t('mapExplorer.requests')}</Button>
        </div>
        {requests ? <DiscoveryLocationContext.Provider value={location}><RequestMap {...props} fixtureMode={false} originLabel='' filters={<DiscoveryControls idPrefix='map' state={props.discoveryState} onPatch={props.onPatchDiscovery} />} /></DiscoveryLocationContext.Provider> : <ResourceExplorer state={props.discoveryState} onPatch={props.onPatchDiscovery} />}
    </div>;
};
