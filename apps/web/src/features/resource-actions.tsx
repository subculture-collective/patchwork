import { useLocale } from '../i18n';
import { currentExactPublicAddress, type ResourceDirectoryCard } from '../resource-directory-ux';

export function resourceContactLinks(resource: ResourceDirectoryCard) {
    if (resource.recordOrigin === 'synthetic') return {};
    let website: string | undefined;
    try {
        const url = new URL(resource.contact.url ?? '');
        if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) website = url.href;
    } catch { /* An invalid published contact is unavailable. */ }
    const phone = resource.contact.phone?.trim();
    const telephone = phone && /^\+?[\d\s().-]{3,30}$/.test(phone)
        ? `tel:${phone.replace(/[\s().-]/g, '')}` : undefined;
    const exact = currentExactPublicAddress(resource);
    const directions = exact ? `https://www.openstreetmap.org/directions?to=${encodeURIComponent(`${exact.latitude},${exact.longitude}`)}` : undefined;
    return { website, telephone, directions };
}

/** Only current, explicitly approved public addresses can become directions. */
export function ResourceActions({ resource }: { resource: ResourceDirectoryCard }) {
    const { t } = useLocale();
    if (resource.recordOrigin === 'synthetic') return <p className='text-sm'>{t('handoff.demoResource')}</p>;
    const links = resourceContactLinks(resource);
    const query = new URLSearchParams(window.location.search);
    query.set('resource', resource.uri);
    query.set('resourceName', resource.name);
    const linkClass = 'mh-button inline-flex px-3 py-2 text-sm';
    return <div className='space-y-2'>
        <p className='text-sm'>{t('handoff.resourceContactHint')}</p>
        <div className='flex flex-wrap gap-2'>
            {links.website && <a className={linkClass} href={links.website} target='_blank' rel='noopener noreferrer'>{t('handoff.visitWebsite')}</a>}
            {links.telephone && <a className={linkClass} href={links.telephone}>{t('handoff.callResource', { phone: resource.contact.phone! })}</a>}
            {links.directions && <a className={linkClass} href={links.directions} target='_blank' rel='noopener noreferrer'>{t('handoff.directions')}</a>}
            <a className={linkClass} href={`/posting?${query.toString()}`}>{t('handoff.askCommunity')}</a>
        </div>
        {!links.website && !links.telephone && <p className='text-sm'>{t('handoff.contactUnavailable')}</p>}
        {!links.directions && <p className='text-xs'>{t('handoff.approximateResource')}</p>}
    </div>;
}
