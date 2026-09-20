# Publisher connector contracts

Connectors are format/transport primitives, not approval to fetch or publish a source. An adapter supplies a reviewed public HTTPS URL, explicit byte budget, accepted content types, complete-feed bounds, stable IDs, geography, schema version and normalization rules. Never pass a public request parameter as a transport URL. No credentials, redirects or authenticated endpoints are supported.

`fetchPublisherBytes` preserves the response bytes and bounded ETag/Last-Modified metadata, enforces declared and streamed byte limits, cancels discarded bodies and uses a bounded timeout. HTTP errors remain compatible with the source runner's bounded 429/5xx retry policy. It does not infer completeness from HTTP 200 or Content-Length (which may describe compressed transfer bytes). Adapters must validate pagination and retain all page evidence before producing review candidates.

CPL uses the shared transport with its existing one-megabyte complete-feed limit. Other publishers remain unqualified. CSV, GeoJSON, ArcGIS, Socrata pagination and HSDS need their own contract fixtures and bounded live qualification under #28.
