/** Canonical public URLs; old paths remain inbound compatibility aliases. */
export const resolveRouteAlias = (pathname: string, _search = ''): string => {
    if (pathname === '/nearby' || pathname === '/feed') return '/map';
    return pathname === '/activity' ? '/inbox' : pathname;
};

export const canonicalRouteUrl = (route: string, search: string | URLSearchParams = ''): string => {
    const params = new URLSearchParams(search);
    let pathname = route;
    if (route === '/map' || route === '/feed') {
        pathname = '/nearby';
        params.delete('view');
    } else if (route === '/inbox') pathname = '/activity';
    const query = params.toString();
    return `${pathname}${query ? `?${query}` : ''}`;
};
