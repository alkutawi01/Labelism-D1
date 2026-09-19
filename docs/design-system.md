# Labelism design system

Live guide: `/design-system.html` (every component, in light and dark). Source of truth: `public/style.css` (tokens and components) and `public/ui.js` (dialogs, toasts, busy buttons).

## Principles

1. **One look.** Every page is built from the same tokens and components. No page defines its own colours, button styles or card styles.
2. **English only.** All text a person reads (pages, buttons, messages, server errors, the AI prompt, printed labels) is English. Sentence case: "Print & Attach", not "PRINT & ATTACH".
3. **Scan first.** Wherever a person identifies a unit, the primary control is a scan field. Typing an ID is the secondary option.
4. **Say what to do.** An error says what went wrong and what to do next. A warning says what to check. Nothing is only a colour.
5. **Phone and desktop.** Printing and order entry happen on a desktop. Packing, scanning and lookup happen on a phone. Every page works at 375px wide.
6. **The label text is sacred.** The text printed on a label (a name, a brand, anything) is mandatory and must fit (see `docs/model-pengecualian-fizikal.md`, invariant I9, and `tests/label-fit-check.browser.js`).

## Tokens (`:root` in style.css)

| Group | Tokens |
|---|---|
| Surface and text | `--bg --surface --surface-2 --ink --muted --line --line-strong` |
| Brand | `--brand --brand-ink --brand-soft --on-brand` |
| Tones | `--ok --warn --bad --info`, each with `-soft` and `-line`; `--bad-solid` for solid red buttons |
| Type | `--fs-xs 11.5 / sm 13 / base 14 / md 15 / lg 18 / xl 24 / 2xl 30` |
| Space (4px grid) | `--sp-1 4 / 2 8 / 3 12 / 4 16 / 5 20 / 6 24 / 8 32 / 10 40` |
| Shape | `--radius-sm 6` controls, `--radius 10` cards, `--radius-lg 14` dialogs, `--radius-pill` |
| Controls | `--control-h 40 / sm 32 / lg 48`, `--focus` ring |
| Depth and layers | `--shadow-1..3`, `--z-sticky/nav/modal/toast` |

Dark mode overrides the same tokens once, inside `@media (prefers-color-scheme: dark)`. A page never needs its own dark rules.

**Tone means one thing everywhere:** ok = done or safe, warn = check this, bad = failed or blocking, info = for your information. Brand blue is for actions and selection, never for status.

## Components

| Component | Markup |
|---|---|
| Page | `.page` > `header.page-header` (`h1`, `p.muted`) |
| Card / section | `.section` with `.section-title`, `.section-sub`, `.section-head` |
| Buttons | `button` or `.btn-primary`; `.btn-secondary`; `.btn-ghost`; `.btn-danger`; `.btn-danger-solid`; sizes `.btn-sm` `.btn-lg`; `.btn-block`; `a.button`; `.link-btn` |
| Form | `.field` > `label` + control + `.field-hint` / `.field-error`; `.grid-2`; `.field-inline` |
| Alerts | `.msg.ok / .info / .warn / .error`; `.review-panel` for many items to check |
| Status | `.pill` (`ok`, `warn`, `bad`, `neutral`) |
| Table | `.table-wrap` > `table.data-table` (`td.num` for numbers) |
| Numbers | `.stats` > `.stat` (`is-ok`, `is-warn`, `is-bad`); `.progress` |
| Cards | `.cards` > `a.card` with `.card-icon` |
| Workflow | `ol.steps` with `is-done`, `is-current` |
| Empty state | `.empty` |
| Sticky action bar | `.submit-bar` |
| Navigation | injected by `nav.js`: left rail on desktop, bottom tab bar on phones |

## Behaviour (`ui.js`)

| Call | Use for |
|---|---|
| `UI.confirm({ title, message, confirmLabel, cancelLabel, tone })` | A decision that has consequences. `tone: 'danger'` for destructive ones. Returns a promise of true/false. |
| `UI.prompt({ ... })` | One short value. Returns the text or null. |
| `UI.toast(message, tone)` | A passing confirmation or a background error. |
| `UI.busy(button, promise)` | Any button that starts a request: shows a spinner and blocks double clicks. |
| `UI.esc(text)` | Escape anything from the server before putting it in HTML. |

**Never use the browser's `alert`, `confirm` or `prompt`.** They look different on every device, cannot be styled, and cannot be tested.

## Words

| Use | Means | Do not use |
|---|---|---|
| Order | What the customer asked for | Job, request |
| Variant | A size or version of a product | Variation, SKU |
| Label text | The name, brand or other text on the garment and its label | Recipient name |
| Group | A school or branch inside one customer's order | Batch |
| Print run | One press of Print: labels printed together | Batch, cetakan |
| ID | The short number on a label (e.g. 000001). It repeats across print runs; the QR code is what identifies a unit for certain | Unit number, unit code, serial |
| Attach / Attached | The label is stuck on the garment and confirmed | Stick, paste |
| Pack / Packed | The label was scanned into a parcel | |
| Dispatch / Dispatched | The parcel has left | Ship, send |

## Adding something new

1. Check `/design-system.html`. If it exists, use it.
2. If not, add the component to `style.css` using tokens only, add it to `design-system.html`, then use it.
3. Verify in light and dark, at 375px and at desktop width.
4. Any user-visible string is English, sentence case.
