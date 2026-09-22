# Publisher connector contracts

Connectors are format/transport primitives, not approval to fetch or publish a source. An adapter supplies a reviewed public HTTPS URL, explicit byte budget, accepted content types, complete-feed bounds, stable IDs, geography, schema version and normalization rules. Never pass a public request parameter as a transport URL. No credentials, redirects or authenticated endpoints are supported.

`fetchPublisherBytes` preserves the response bytes and bounded ETag/Last-Modified metadata, enforces declared and streamed byte limits, cancels discarded bodies and uses a bounded timeout. HTTP errors remain compatible with the source runner's bounded 429/5xx retry policy. It does not infer completeness from HTTP 200 or Content-Length (which may describe compressed transfer bytes). Adapters must validate pagination and retain all page evidence before producing review candidates.

CPL uses the shared transport with its existing one-megabyte complete-feed limit. Other publishers remain unqualified. CSV, GeoJSON, ArcGIS, Socrata pagination and HSDS need their own contract fixtures and bounded live qualification under #28.

## CSV primitive

`parsePublisherCsv` uses the quoted-field and escaped-quote rules described in [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180), with explicit UTF-8/BOM and LF support. It requires an exact reviewed header, stable ID column, byte/cell/row budgets and complete-feed minimum. It rejects malformed quoting, wrong-width rows, duplicate or blank identifiers, invalid UTF-8 and unsupported control characters. A malformed row rejects the complete batch; there is no silent row skipping.

Values remain strings: leading-zero postal codes, bilingual names, whitespace and quoted line breaks are preserved. No spreadsheet expressions execute and no geographic coordinates, hours or eligibility are inferred. Adapters must add field semantics and previous-snapshot loss checks. A complete-looking truncated CSV can only be detected using publisher counts, paging metadata or a baseline; syntax alone cannot prove completeness.

Onboarding recipe: review source reuse rights and exact URL; capture bounded official bytes; record expected headers/IDs/encoding and feed bounds in adapter code; retain raw evidence; validate every row and source completeness; normalize deterministically; generate preview candidates; qualify bounded live replay before registering or scheduling the source. CSV fixtures currently qualify the parser, not a national publisher.

## ArcGIS point-query contract

The first ArcGIS primitive validates count and object-ID responses, then verifies each requested page against its exact ID set. It requires reviewed field names/types and WGS84 point coordinates, rejects transfer-limit flags and malformed or missing records, and returns records in object-ID order. Null geometry is preserved for explicit source-level exclusion; coordinates are never inferred. Object IDs identify rows during collection; adapters must separately qualify durable service identity.

This follows the [Esri query contract](https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/) for enumerating IDs and requesting subsets. The primitive does not fetch a source or prove a transactional snapshot. Source counts, before/after ID comparison, page evidence retention, and source-specific normalization remain separate steps. Fixtures are synthetic and contain no provider contact records.

`collectArcgisPoints` requests a count, enumerates IDs, downloads explicit ID subsets sequentially, then repeats the ID and count checks. A changed membership set rejects the collection even if its size is unchanged. Page count, cumulative bytes and total duration are bounded; caller cancellation reaches the active request. The optional evidence callback runs before parsing and must finish before another request starts, so a storage failure stops collection. Matching IDs prove advertised membership coverage, not unchanged attributes or a transactional snapshot. Source policy must account for edits during collection.
