# Identity and browser sessions

AT OAuth is implemented by `packages/at-client/src/oauth-client.ts` and
`services/api/src/auth/at-auth-service.ts`. The API's auth runtime wires those
adapters to persistent encrypted OAuth state and browser sessions.

A login begins with an AT handle and a local return path. The OAuth adapter
performs authorization and callback validation. On success the API creates a
bounded browser session and sets an HttpOnly, SameSite cookie, with Secure in
HTTPS environments. Return paths are constrained to the local application and
sensitive token parameters are removed.

Protected requests restore the DID from the browser session. Browser-supplied
identity and role fields do not grant authority. Roles, policy consent, and
resource ownership are checked at the appropriate API boundary. Expired or
unrestorable sessions fail explicitly; they do not silently become an
anonymous identity for a protected operation.

OAuth refresh is owned by the official AT client adapter. Browser session
persistence, encryption, expiry, and invalidation are tested in the API auth
suites; adapter failures and callbacks are tested in the AT client suite.
Actual provider login is a separate authenticated browser qualification.
