# Native localization handoff

Addresses [#254](https://github.com/subculture-collective/patchwork/issues/254).
Both native apps must be translatable from their first screens. Start with
bundled English and Spanish, then add languages through resources and locale
registration. No paid translation platform, live translation API or automatic
translation of member content is part of this work.

## Ownership and key conventions

The web `en.json`/`es.json` files supply initial member-flow copy. After import,
iOS String Catalogs and Android XML are the maintained sources for native copy.
Do not synchronize three editable masters in both directions. Share semantic
IDs, glossary and translation memory, with documented platform-specific keys
when navigation or controls differ.

Keep semantic IDs stable when wording changes: `discovery.resultCount`, not
the English sentence. Convert dots/camel case to Android-safe snake case:
`discovery_result_count`. Check collisions such as `nav.map` and `nav_map`.
Do not rename an ID just to mark changed copy; mark affected translations as
needing review and record why the source changed.

Every message needs context, its UI/accessibility purpose, argument names/types,
plural intent and any real space constraint. Product names and deliberate
non-translatable text are explicit exceptions. A shared semantic ID must keep
its meaning and arguments across clients; complete catalog key sets may differ
where platform behavior differs.

| Concept | Meaning to preserve |
| --- | --- |
| Request / offer | Asking for help versus making help available; do not swap actor or action |
| Accepted connection | An explicit participant agreement, not an automatic assignment or safety guarantee |
| Resource / public place | A sourced service listing; presence does not imply participation or current availability |
| Approximate area | Published ZIP/county geography, not a precise personal location |
| Live location exchange | A short-lived encrypted participant channel; ordinary chat is server-readable |

## Executable seed examples

`seed.json` is a **five-message example fixture**, not a new application-wide
translation master. It records exact web source keys, English/Spanish values,
context and typed arguments. The tests compare its copy to the web catalogs so
a source change requires an explicit review of the seed. The selected Spanish
copy is reused source material, not a claim of professional translation review.

`scripts/mobile_localization.py` validates the fixture and exports:

- `examples/ios/Localizable.xcstrings`: source language, stable keys, context,
  explicit non-translatable brand and native plural variations.
- `examples/android/values/strings.xml`: default English strings/plurals.
- `examples/android/values-es/strings.xml`: Spanish translations, with the
  non-translatable product name inherited from the default resources.

```sh
rtk proxy python3 -B scripts/mobile_localization.py --check
rtk proxy python3 -B -m unittest discover -s scripts -p 'test_mobile_localization.py'
```

To regenerate the reviewed examples, run the first command without `--check`
and inspect its diff. The script supports these language-only seed locales,
string/integer arguments and native plural categories. It rejects missing
locales, unknown/missing arguments, missing plural fallback and name collisions.
Regional/script tags, full-app extraction, translator services and device-specific
variations belong to the actual native resource tooling, not an expanding seed
converter.

`{{name}}` becomes a positional string argument (`%1$@` for iOS, `%1$s` for
Android). Integer arguments use `%1$lld` and `%1$d`. Positions follow the
declared argument order, so translations can change sentence order without
changing the caller. Literal percent signs and Android quotes/XML are escaped.
Never join translated sentence fragments or substitute variables before native
plural selection. The seed's plural quantity is the first integer argument;
the platform resource API chooses the language-specific category.

The Python checks prove deterministic conversion, parsable resource structure,
source-copy provenance and argument/plural failure handling. They do **not**
prove Xcode compilation, Android resource linking, runtime plural selection or
an actual XLIFF export/import. Project integration, runtime selection and
XLIFF exchange remain part of #255/#256. Keep these evidence tiers distinct.

A separate bounded compiler probe on 2026-11-15 passed: Soyuz's Xcode 27.2
`xcstringstool compile` produced English/Spanish `.strings` and `.stringsdict`
files from the sample catalog. On Kvant, build-tools 35.0.0 AAPT2 compiled both
locale directories and linked them against SDK 36 with a temporary resource-only
manifest. No app was installed or launched. These establish resource format
acceptance by the inspected tools; project integration, runtime selection,
XLIFF exchange and physical-device behavior remain unqualified.

## Translator export and import

For iOS, add the catalog to the native project, extract all user-facing copy
through localized APIs and export Xcode localizations as XLIFF/localization
catalogs. Give translators comments and the shared glossary. Import the returned
localizations through Xcode, inspect the resource diff and run native tests.
The actual export/import round trip is an acceptance check for #255 after the
Xcode project exists. A JSON load/save is not an XLIFF round trip.
[Apple String Catalog workflow](https://developer.apple.com/documentation/xcode/localizing-and-varying-text-with-a-string-catalog).

For Android, provide the default strings/plurals and target-locale XML, keeping
resource identifiers and format argument types fixed. Accept native plural
categories required by the target language and preserve `other`. Validate the
returned XML, run Android lint/resource linking and preview the affected flows.
Quantity and format arguments must both reach the native plural API; this is
checked in #256. [Android string/plural resources](https://developer.android.com/guide/topics/resources/string-resource).

Translations return as versioned resource changes. Record source wording/version,
translator/reviewer status and outstanding questions. Do not mark the entire
language reviewed merely because every key has a value. Changes to policy,
safety, consent or location text need review in their product context.

## Locale selection and server copy

Default to the platform's supported app/system language. Offer a persisted
in-app choice; unsupported locales fall back to English. Keep device regional
date/number formatting separate from UI language. Retain the existing distance
unit policy and canonical scheduling timezones.

Map stable server error codes to localized app messages; unknown codes get a
safe localized fallback, not machine translation of diagnostic prose. Refetch
server-owned copy after a language change as needed. The current onboarding
schema and notification renderer register only `en`/`es`; another language needs
that server registration and translated notification/email copy too.

Bundled resources work offline. Do not submit drafts, messages, private reports
or coordinates to a translation service. Public listing/member content stays
in its source language unless a separate product decision introduces translation.

## Checks carried into feature work

Each feature adds native resources for labels, validation, loading/empty/offline
states, accessibility and permission/safety copy. Native foundations add checks
for missing/stale required translations and incompatible format/plural arguments,
with explicit exceptions for non-translatable or intentionally platform-specific
copy. Catalog counts alone do not find hard-coded display strings.

Use expansion/accent and RTL pseudolocales plus large text to find truncation
and layout-direction assumptions. They are layout tests, not support claims
for a translated RTL language. #308 performs the complete-language journey and
translator handoff audit after feature resources exist.
