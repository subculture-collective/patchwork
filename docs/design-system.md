# Patchwork interface system

Patchwork is a neighborhood noticeboard for asking for help, responding to a neighbor, and finding public resources. Design each screen around the next useful action.

## Journeys

- Home offers three direct paths: ask for help, browse requests, find a resource. Avoid repeating these choices in promotional sections.
- Nearby puts search and ZIP selection before the map. Desktop shows map and results together; narrow screens switch between them. Selecting a ZIP focuses the existing results list. Keep request and resource details dismissible without losing search context.
- Resource discovery prioritizes finding and contacting a service. Resource categories filter the complete server result, persist in the URL, and remain separate from request categories. Publishing and management are secondary disclosures.
- Request creation explains what is public before submission. A five-digit ZIP is the minimum public location; a street address belongs in private coordination. Public resources may use an eligible published street address.
- My activity groups requests, offers, and connections. Messages remain reachable from that context. Sign-in gates explain why an account is needed and offer a public browsing path.

## Visual language

Use a quiet, warm noticeboard: an off-white background, dark readable text, green actions and request boundaries, and coral public-resource pins. Typography and whitespace establish hierarchy. Use the existing serif for major headings and the sans face for controls and body text.

The implementation tokens in `apps/web/src/styles/tokens.css` are authoritative. Shared cards and panels use thin borders, restrained rounding, and minimal depth. Do not put patterned backgrounds or another bordered card inside every panel. Reserve strong color for actions, selected state, and meaningful warnings; an open request is not an error.

## Interaction contracts

- Search and location remain visible. Less frequent request filters use a disclosure with an explicit applied state.
- Buttons and filter chips have at least 44px touch targets, visible keyboard focus, and semantic selected state.
- Map controls include a direct skip to results. Offscreen geography must not fill the keyboard sequence. County selection and ZIP detail preserve the public-location boundary.
- Detail sheets are non-modal and restore focus when closed. Actual modal tasks use native dialog behavior for focus containment and Escape.
- Preserve spaces while typing search text. Browser Back restores filter state. Resource filtering, counts, and pagination use the same query.
- Preserve confirmed owner edits when an older discovery response arrives. Follow-up actions must use the newest confirmed record revision.
- Loading, empty, stale, offline, and failed states explain what happened and what can be done next. Never promise offline delivery or imply verification that the data does not establish.
- Shared panels use real headings. Navigation and footer sit outside the main-content landmark.
- English and Spanish controls use the same hierarchy. Keep geography, public-address provenance, and privacy wording accurate in both.

## Validation

Check complete journeys in a real browser, including narrow screens, 200% text, keyboard navigation, denied location, ZIP lookup, map/list continuity, request details, resource contact, and errors. Use automated accessibility checks alongside visual inspection. Local fixture and read-only public-data previews are not authenticated live acceptance or deployment evidence.
