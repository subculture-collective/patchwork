import { renderToString } from 'react-dom/server';
import { AppShell } from './app/AppShell';
import { resolveNavRoutes } from './app/routes';
import { defaultDiscoveryFilterState } from './discovery-filters';
import { DashboardRoute } from './routes/home';
import './i18n';

export function render() {
    return renderToString(
        <AppShell appTitle="Patchwork" currentRoute="/" navRoutes={resolveNavRoutes('api', undefined)} auth={{ status: 'anonymous', onLogout: () => {} }} locale="en" onChangeLocale={() => {}} onRouteClick={() => {}}>
            <DashboardRoute discoveryState={defaultDiscoveryFilterState} onNavigate={() => {}} onPatchDiscovery={() => {}} />
        </AppShell>,
    );
}

export { publicPageMeta, publicOrigin } from './seo';
