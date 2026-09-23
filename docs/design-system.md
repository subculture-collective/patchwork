# Patchwork design system

Patchwork's interface is editorial and hand-assembled. It uses a heavy serif
display face, ink outlines, flat hard shadows and a small set of saturated
"patch" colours on warm paper. The look should read as a printed neighbourhood
bulletin: confident headlines, plain working text, and colour used to mark
meaning.

This document describes the system that ships in `apps/web`. The source of
truth for values is `apps/web/src/styles/tokens.css`. Components live in
`apps/web/src/components/`.

> History: until September 2026 this file described a soft "organic" preset
> (moss/sage, diffuse shadows) that the code no longer used. The owner chose
> to keep the shipped editorial direction and make it consistent.

## 1. Principles

1. **One container per idea.** A section is one surface. Do not nest a
   bordered box inside a title-barred box inside a panel.
2. **Colour carries meaning.** Pine means act or selected. Mustard marks
   emphasis. Terracotta is the "ask for help" call to action. Red means
   danger, destructive actions and errors, and nothing else.
3. **Results before controls.** On discovery pages, the thing people came for
   (requests, places, the map) comes before the filters. Rarely used filters
   collapse.
4. **Mobile first.** Most people asking for or offering help use a phone.
   Design each surface at 360px first, then add columns.
5. **Plain language.** Headings describe what the person can do ("Requests
   near you"), not the system ("Feed operations"). Protocol terms such as DID,
   PDS and CID stay out of primary UI.

## 2. Tokens

All colours, shadows and radii come from CSS custom properties in
`tokens.css`. Tailwind exposes them as `mh-*` colours. Feature code must not
introduce raw hex values or one-off shadows.

### Colour

| Token | Value | Use |
| --- | --- | --- |
| `--mh-bg` | `#f2efe7` | Page paper |
| `--mh-surface` | `#fffdf7` | Cards, inputs |
| `--mh-surface-elev` | `#e8e2d4` | Neutral buttons, quiet fills |
| `--mh-panel` | `#d9d1c0` | Rare: grouped tool areas |
| `--mh-text` | `#172019` | Ink: text and outlines |
| `--mh-text-muted` | `#4f5a51` | Secondary text (AA on paper) |
| `--mh-text-soft` | `#626a62` | Placeholders, metadata only |
| `--mh-accent` | `#12664f` | Pine: primary action, selected state, links |
| `--mh-accent-2` | `#9ec5ad` | Sage: info badges, quiet highlights |
| `--mh-accent-3` | `#f2c14e` | Mustard: emphasis, underlines, markers |
| `--mh-cta` | `#e85d3f` | Terracotta: brand mark and illustration |
| `--mh-cta-strong` | `#c2462b` | Terracotta fill for the "Ask for help" button (4.9:1 with light text) |
| `--mh-success` | `#287c52` | Success status |
| `--mh-warning` | `#8a5f00` | Warning text and borders |
| `--mh-danger` | `#b93b2c` | Errors and destructive actions |
| `--mh-border` | `#172019` | Ink outline |
| `--mh-border-soft` | `#aaa99f` | Input borders, dividers |
| `--mh-border-subtle` | `#d4cec1` | Hairlines inside cards |
| `--mh-focus` | `#0b62d6` | Focus ring (distinct from every brand colour) |

Text on pine, strong terracotta and red uses `--mh-on-accent` (`#fffdf7`).

### Type

| Role | Family | Notes |
| --- | --- | --- |
| Display and headings | Fraunces 600–900 | Tight tracking (`-0.03em` to `-0.05em`), line-height ≤ 1.05 |
| Body, labels, controls | Public Sans 400/500/700 | 16px minimum for body and inputs, line-height 1.5 |
| Eyebrows, metadata | JetBrains Mono 400/700 | Uppercase, `0.12em` tracking, one per section at most |

Form labels, button text and chips use Public Sans in sentence case. Uppercase
mono is reserved for eyebrows above section headings and compact metadata such
as timestamps.

### Shape and depth

- Radius: the "patch" corner, `--mh-radius-patch` (`2px 14px 2px 14px`), for
  cards, buttons and inputs. Pills (`999px`) for chips and badges only.
- Outline: `1.5px` ink on cards and buttons; `1px` soft border on inputs.
- Shadow: flat offset only, in three steps: `--mh-shadow-sm` (2px),
  `--mh-shadow` (4px) and `--mh-shadow-lg` (7px, hover and floating
  surfaces). No blurred shadows.
- Spacing: 4px base (`--mh-space-*`). Touch targets are at least 44px.

### Motion

Transitions last 150ms (`--mh-transition-standard`). Hover lifts a button by
1px and grows its shadow; pressing removes the shadow. There are no infinite
decorative animations. `prefers-reduced-motion: reduce` disables transitions
globally.

## 3. Components

| Component | Purpose |
| --- | --- |
| `Button` | Variants `primary` (pine), `accent` (terracotta), `neutral`, `danger`, `ghost`; sizes `sm`/`md` |
| `ToggleChip`, `ChipGroup` | Multi-select filters (`aria-pressed`); selected = pine fill |
| `SegmentedControl` | One-of-few choices (radio group), e.g. Latest / Nearby |
| `Field` | Label, hint, error and control wiring for `Input`, `Select`, `Textarea` |
| `Surface` | The single card container, with an optional heading and actions |
| `PageHeader` | Eyebrow, title, description, actions and status for each route |
| `Banner` | Page-level `info`, `success`, `warning` and `danger` messages |
| `EmptyState` | No results / not signed in, with a next action |
| `Sheet` | Mobile drawer and dialog for navigation and filters |
| `Badge` | Status and category labels |

`Panel` and `Card` remain as thin wrappers during migration. New code uses
`Surface`.

## 4. Layout

- Content width: `max-w-7xl` with `px-4 sm:px-6 lg:px-10`.
- App shell: a single header bar with the brand, primary destinations and the
  account menu. Below 900px, a top bar with a menu button opens a sheet, and a
  bottom tab bar gives one-tap access to Home, Map, Requests and Resources.
- Discovery pages: results and map first. Filters appear as a compact bar
  (search, Latest/Nearby, a "Filters" button with an active-count badge), and
  the full set opens in a sheet.
- The paper grid texture belongs to the page background only; surfaces are
  flat.

## 5. Accessibility

1. Text contrast is at least 4.5:1. `--mh-text-soft` is not used for
   sentence text.
2. Focus is always visible, using `--mh-focus` with a paper-coloured offset.
3. Status never relies on colour alone; badges carry text.
4. Errors use `role="alert"` and are linked to their field with
   `aria-describedby`.
5. Every route has one `h1`, rendered by `PageHeader`.

## 6. Anti-patterns

- Red for selected or neutral states.
- Nested containers: panel → title bar → inner box.
- Filters that push results below the fold on a phone.
- Uppercase letter-spaced form labels.
- Decorative shapes that overlap content (the old route-header ring).
- Raw hex values or blurred shadows in feature code.

## 7. Visual baselines

`apps/web/e2e/visual.spec.ts` captures the home, map, requests, resources,
login, sign-up and posting pages at 390px and 1280px. It is opt-in so the
default e2e run does not depend on rendering details:

```sh
cd apps/web
PATCHWORK_VISUAL=1 npx playwright test e2e/visual.spec.ts                      # compare
PATCHWORK_VISUAL=1 npx playwright test e2e/visual.spec.ts --update-snapshots   # after an intended change
```

Web fonts are blocked and API data is mocked, so the baselines use fallback
fonts and fixed content. Snapshots are platform-specific (`-linux.png`).
