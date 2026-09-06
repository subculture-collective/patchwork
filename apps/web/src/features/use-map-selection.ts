import { useEffect, useState } from 'react';
import type { FeedRecordEnvelope } from './discovery-runtime';
import type { ResourceDetail, ResourceDirectoryCard } from '../resource-directory-ux';
import { fetchAidPostViaApi, fetchResourceViaApi } from './api-client';

type Selection = { uri?: string; resource?: string };
const read = (): Selection => {
    const params = new URLSearchParams(window.location.search);
    return params.get('uri') ? { uri: params.get('uri')! } : { resource: params.get('resource') ?? undefined };
};
export const useMapSelection = (requests: readonly FeedRecordEnvelope[], resources: readonly ResourceDirectoryCard[], dataset: 'all' | 'community' | 'demo') => {
    const [selection, setSelection] = useState(read);
    const [linkedRequest, setLinkedRequest] = useState<FeedRecordEnvelope>();
    const [linkedResource, setLinkedResource] = useState<ResourceDetail>();
    const [error, setError] = useState<string>();
    const [loading, setLoading] = useState(false);
    const [reload, setReload] = useState(0);
    const inDataset = (origin?: string) => dataset === 'all' || (origin === 'synthetic' ? 'demo' : 'community') === dataset;
    const localRequest = requests.find(record => record.aidPostUri === selection.uri && inDataset(record.recordOrigin));
    const localResource = resources.find(record => record.uri === selection.resource && inDataset(record.recordOrigin));
    useEffect(() => setSelection(read()), [dataset]);
    useEffect(() => { const restore = () => setSelection(read()); window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore); }, []);
    useEffect(() => {
        const controller = new AbortController();
        setError(undefined); setLinkedRequest(undefined); setLinkedResource(undefined); setLoading(false);
        if (selection.uri && !localRequest) {
            setLoading(true);
            void fetchAidPostViaApi(selection.uri, controller.signal, dataset).then(result => {
                if (controller.signal.aborted) return;
                if (result.ok) setLinkedRequest(result.data); else setError(result.error);
                setLoading(false);
            });
        } else if (selection.resource && !localResource) {
            setLoading(true);
            void fetchResourceViaApi(selection.resource, controller.signal, dataset).then(result => {
                if (controller.signal.aborted) return;
                if (result.ok) setLinkedResource(result.data); else setError(result.error);
                setLoading(false);
            });
        }
        return () => controller.abort();
    }, [selection.uri, selection.resource, localRequest, localResource, dataset, reload]);
    const select = (next: Selection) => {
        const url = new URL(window.location.href);
        url.searchParams.delete('uri'); url.searchParams.delete('resource');
        if (next.uri) url.searchParams.set('uri', next.uri);
        else if (next.resource) url.searchParams.set('resource', next.resource);
        const nextUrl = url.pathname + url.search;
        if (nextUrl !== window.location.pathname + window.location.search) window.history.pushState({}, '', nextUrl);
        setSelection(next);
    };
    return {
        request: localRequest ?? (linkedRequest && linkedRequest.aidPostUri === selection.uri && inDataset(linkedRequest.recordOrigin) ? linkedRequest : undefined),
        resource: localResource ?? (linkedResource && linkedResource.uri === selection.resource && inDataset(linkedResource.recordOrigin) ? linkedResource : undefined),
        loading, error, retry: () => setReload(value => value + 1), close: () => select({}),
        selectRequest: (id?: string) => select({ uri: requests.find(record => record.card.id === id)?.aidPostUri }),
        selectResource: (uri?: string) => select({ resource: uri }),
    };
};
