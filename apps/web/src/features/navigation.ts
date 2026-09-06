/** Canonical public URLs; old paths remain inbound compatibility aliases. */
export const resolveRouteAlias = (pathname: string, search = ''): string => {
    if (pathname === '/nearby') return new URLSearchParams(search).get('view') === 'map' ? '/map' : '/feed';
    return pathname === '/activity' ? '/inbox' : pathname;
};

export const canonicalRouteUrl = (route: string, search: string | URLSearchParams = ''): string => {
    const params = new URLSearchParams(search);
    let pathname = route;
    if (route === '/map' || route === '/feed') {
        pathname = '/nearby';
        params.set('view', route === '/map' ? 'map' : 'list');
    } else if (route === '/inbox') pathname = '/activity';
    const query = params.toString();
    return `${pathname}${query ? `?${query}` : ''}`;
};
