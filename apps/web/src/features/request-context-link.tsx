import { useEffect, useState } from 'react';
import { useLocale } from '../i18n';
import { fetchAidPostViaApi } from './api-client';

export function RequestContextLink({ uri }: { uri: string }) {
    const { t } = useLocale();
    const [title, setTitle] = useState('');
    useEffect(() => {
        const controller = new AbortController();
        setTitle('');
        void fetchAidPostViaApi(uri, controller.signal).then(result => {
            if (!controller.signal.aborted && result.ok) setTitle(result.data.card.title);
        });
        return () => controller.abort();
    }, [uri]);
    return <a className='block font-bold underline' href={`/requests/view?uri=${encodeURIComponent(uri)}`}>{title || t('myRequests.view')}</a>;
}
