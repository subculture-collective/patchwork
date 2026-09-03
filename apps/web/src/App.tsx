import { FrontendShell } from './features/frontend-shell';
import { AuthProvider } from './auth/AuthProvider';
import { AuthCallbackPage } from './auth/AuthCallbackPage';
import { LoginPage } from './auth/LoginPage';
import { SignupPage } from './auth/SignupPage';
import { InviteManagementPage } from './auth/InviteManagementPage';

export const APP_TITLE = 'Patchwork';

export const App = () => {
    const pathname =
        typeof window === 'undefined' ? '/' : window.location.pathname;
    return (
        <AuthProvider>
            {pathname === '/login' ? <LoginPage />
            : pathname === '/signup' ? <SignupPage />
            : pathname === '/admin/invites' ? <InviteManagementPage />
            : pathname === '/auth/callback' ? <AuthCallbackPage />
            : <FrontendShell appTitle={APP_TITLE} />}
        </AuthProvider>
    );
};
