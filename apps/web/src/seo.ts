export const publicOrigin = 'https://patchwork.subcult.tv';
export const publicPageMeta: Record<string, { title: string; description: string }> = {
    '/': { title: 'Mutual aid requests and community resources | Patchwork', description: 'Find nearby requests and community resources in Patchwork’s pre-alpha preview. Accounts require an invite; this preview is not an emergency service.' },
    '/map': { title: 'Nearby mutual aid map | Patchwork', description: 'Explore nearby mutual aid requests and community resources using an approximate area. Patchwork is a pre-alpha preview.' },
    '/feed': { title: 'Mutual aid requests | Patchwork', description: 'Browse community requests and offers of help in Patchwork’s pre-alpha preview.' },
    '/resources': { title: 'Community resource directory | Patchwork', description: 'Browse community organizations and resource listings in Patchwork’s pre-alpha preview.' },
    '/volunteer': { title: 'Volunteer opportunities | Patchwork', description: 'Explore ways to offer support through Patchwork’s pre-alpha community preview.' },
    '/organizations': { title: 'Community organizations | Patchwork', description: 'Explore community organization listings and participation in Patchwork’s pre-alpha preview.' },
    '/legal/terms': { title: 'Terms of use | Patchwork', description: 'Read the terms for using the Patchwork pre-alpha preview.' },
    '/legal/privacy': { title: 'Privacy and location handling | Patchwork', description: 'Read how Patchwork handles account information, messages and approximate location.' },
    '/legal/community-guidelines': { title: 'Community guidelines | Patchwork', description: 'Read the community guidelines for requests, offers and participation on Patchwork.' },
};

export function updatePageMetadata(path: string, isNotFound: boolean): void {
    const meta = isNotFound ? undefined : publicPageMeta[path];
    const ensureMeta = (name: string, content: string) => {
        let element = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
        if (!element) {
            element = document.createElement('meta');
            element.name = name;
            document.head.append(element);
        }
        element.content = content;
    };
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!meta) {
        canonical?.remove();
        ensureMeta('robots', 'noindex,nofollow');
        return;
    }
    document.querySelector('meta[name="robots"]')?.remove();
    ensureMeta('description', meta.description);
    if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.append(canonical);
    }
    canonical.href = publicOrigin + path;
    for (const [property, content] of Object.entries({ 'og:title': meta.title, 'og:description': meta.description, 'og:url': publicOrigin + path })) {
        let element = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
        if (!element) {
            element = document.createElement('meta');
            element.setAttribute('property', property);
            document.head.append(element);
        }
        element.content = content;
    }
}
