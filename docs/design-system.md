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


## Nearby journeys

Nearby has two explicit intents, persisted as `nearby=resources` or `nearby=requests`. Existing request links keep their meaning; links with resource refinements select resources unless the visitor explicitly chooses requests. Moving from the directory to Nearby carries the resource intent and filters.

- **Find help close to me.** Choose Public resources, enter a ZIP or use device location, and refine service/program/type. Map pins and the resource list use the same bounded server query. The list is nearest first when a center exists. Distances are straight-line estimates from the selected center or ZIP representative point, never travel times or distance from an inferred home.
- **Look in another area.** A ZIP change or location refresh preserves the chosen radius. Changing radius reframes the resource map. Panning changes the camera only; Search this area explicitly commits a new center/radius and clears the old ZIP while retaining resource refinements. Searches wider than the supported radius disclose the limit.
- **Choose a place before travelling.** A resource result opens address, published hours, eligibility notes, contact links and directions. Closing detail retains the search/list. Show on map repositions the camera without altering the search center or fetching different results. Source provenance and claim boundaries remain visible.
- **Help a neighbor.** Community requests uses county/ZIP counts and a request list. Selecting a ZIP can open that list on mobile. Public resource searches keep the mobile map and offer a separate resource list; they never redirect visitors to an empty requests list.
- **Recover without starting over.** Location denial retains a chosen area and ZIP entry remains available. Filters are expandable with visible removable selections. Empty resource results offer a wider search when below the maximum radius. API failure is distinguished from an empty result. URL state supports reload, sharing and browser history; exact request addresses remain private.

At mobile widths, the resource journey keeps ZIP/location controls above the map, places keyword/program/service/type refinements in a disclosure, and switches between the retained map and resource list. County and ZIP boundaries remain keyboard operable; resource mode uses area names without request counts. The resource list can load additional pages. The server aggregates the complete matching set for the visible map independently of the loaded list; individual pins represent eligible public addresses.


## Whole-product acceptance contracts

| Journey | Acceptance owner and remaining qualification |
| --- | --- |
| Find help | Shared server filtering, full-list pagination and independent resource-map aggregation; verify viewport count conservation and cross-page selection. |
| Determine whether a service can help | Versioned service assertions with source, review state and expiry. Optional eligibility answers stay in browser memory and clear on resource/account changes or reload. Structured source ingestion and Chicago coverage qualification remain required. |
| Plan a visit | Published service schedules distinguish scheduled open, scheduled closed and unknown. Self-hosted road/transit routing, precise-origin consent, coverage qualification and arrival-time matching remain required. |
| Ask for help | ZIP-only publication, restored drafts, authoring receipts and lifecycle controls; qualify actual authentication, PDS publication and indexing on disposable test identities. |
| Help a neighbor | Offers, responses, private connections and expiry; qualify actual lifecycle persistence and recovery rather than relying solely on browser fixtures. |
| Coordinate and finish | Chat, schedule/timezones, peer address exchange, groups and outcomes; qualify real authenticated delivery and consent boundaries. |
| Return later | Private saved resources/searches, daily opt-in digests, ownership, export and deletion. Exact origins and eligibility answers are rejected by saved-search contracts. |
| Maintain a resource | Independent claims, bilingual management, reviewed service editor and revision conflicts. Provider edits preserve original imported source snapshots. |
| Resolve problems | Existing moderation/account controls; dedicated listing corrections and source-review workflow remain required. |

Saved discovery is capped at 200 items per account, with an explicit recoverable limit response. Alert baselines are established on opt-in; one generic notification per account per UTC day summarizes changes. Delivery follows existing channel preferences. Search alerts identify newly matching records; resource alerts compare public service/contact details. No source query, resource name, precise location or eligibility answer enters notification copy.

A provider's service assertions require reconfirmation after 30 days. Blank fields remain unknown. Simple eligibility rules are independent requirements combined with AND; alternative or complex rules remain explanatory text. Provider edits require the loaded resource timestamp and service-profile revision so a stale form cannot overwrite a newer edit.

The routing exception described in the product plan is not active until the dedicated transient-routing service, consent UI and updated privacy checks are implemented and qualified. Existing exact-personal-location restrictions remain authoritative meanwhile.
