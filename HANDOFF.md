# Labelism — Handoff

Written 2026-09-12 for whichever Claude session picks this up next. Read this
fully before touching anything — this project has a strict collaboration
protocol (see "Director protocol" below) that is easy to violate by accident.

## What this is

Labelism is a self-hosted "Unit Identity Core" — it gives every physical unit
(a book copy today, jerseys/uniforms later) a persistent digital identity
tracked through **Product → Variant → ProductionBatch → Unit → UnitEvent**,
with QR labeling, scan-based operations, and stocktake reconciliation.

**This is NOT a SaaS product.** Izzat is building this for his own
businesses (book publishing is the primary, real use case — "Surat-surat
Aisha Hamdan" is his actual first book; jersey/uniform manufacturing is
secondary). He is the sole intended operator. Do not add multi-tenant
concepts, billing, public signup, etc. — none of that has been asked for.

Izzat is a non-technical founder-operator, not a developer. Explain things in
terms of what he'll see/click, not implementation detail, unless he's asking
a technical question directly.

## Director protocol — read this before making any scope decision

Izzat appointed **ChatGPT** (project "IZZAT", thread "Infrastruktur Digital
Diperlukan" on chatgpt.com) as **Project Director** with authority over
product/scope decisions. Claude is the "execution engineer": build, test with
real evidence, and push back on the Director's calls when there's a genuine
technical/UX/data reason — backed by evidence, not preference. The Director's
word is final on scope **unless Izzat personally overrides it** (this has
happened at least once — see "Variant Dimensions Pass" below — and is
legitimate; Izzat outranks the Director he appointed).

**Report back to the Director using this exact structure**, as a message in
that ChatGPT thread (open it in the Browser pane tools):

```
Progress Report
Phase: ...
Task completed: ...
What changed: ...
Evidence: ...
Issue-risk: ...
Claude recommendation: ...
Decision needed: ...
```

Do this after any non-trivial change, not just at the end of a session. The
Director has repeatedly caught real problems this way (billing surprises,
missing invariants, scope creep) that would have shipped unnoticed otherwise.

**Never claim a physical/manual step happened unless it actually did.**
E.g. never tell the Director "Gate B — Physical Rehearsal: PASS" unless
Izzat has personally done the physical QR-scan test with real printed labels
on real objects using his own phone. Same standard applies to anything that
requires Izzat's hands, not just Claude's.

## Current architecture (3rd iteration — read the history below, it matters)

**Live at**: `https://labelism.alkutawi01.workers.dev`
**Repo (local only, no git yet)**: `C:\Users\alkut\Downloads\Labelism-D1`
**Stack**: Cloudflare Workers (compute) + Cloudflare D1 (SQLite-based DB).

There is an **older, now-retired sibling repo** at
`C:\Users\alkut\Downloads\Labelism` (no `-D1` suffix) — that was the
Vercel + Neon Postgres iteration. It is kept only as history/fallback per
Director instruction. **Do not deploy or edit that repo** unless explicitly
told to revive the Postgres path — the live product is the D1 repo.

### Why 3 architectures in one week (2026-09-08 to 2026-09-11)

1. **Local SQLite** (original) — fine functionally, but no host would give
   free, card-free, *persistent-disk* hosting for a plain Node+SQLite app.
2. **Vercel + Neon Postgres** — solved the persistent-storage problem, but
   mid-deployment-verification Claude discovered the Neon org was secretly on
   a **paid plan with a real card attached**, already accruing real charges.
   This broke the entire "no credit card" premise. Also hit real Vercel
   framework-detection bugs (see git history of the old repo if curious).
3. **Cloudflare Workers + D1** (current) — Izzat revealed he already has a
   DigitalOcean droplet AND a Cloudflare account. After comparing DigitalOcean
   vs Cloudflare vs Firebase+Drive vs Google Apps Script, the Director chose
   Cloudflare Workers + D1, reverting Postgres → SQLite-equivalent (D1 *is*
   SQLite under the hood) since the original reason for Postgres (no
   card-free host had persistent disk) no longer applied to any new option.

**Lesson embedded in the code**: `nextSeqPg`-style atomic sequence patterns
differ completely between Postgres and D1 — an atomic `UPDATE ... RETURNING`
(safe on Postgres) is NOT how D1 concurrency safety is achieved; D1 uses
`db.batch()` as an all-or-nothing unit (see `src/services/units.js`). This
was proven with a dedicated technical spike (10 concurrent event requests
against one Unit → seq 1-10, unique/sequential, zero collisions) **before**
committing to the full port, per Director's explicit requirement — don't
skip proof-before-commit if the execution model changes again.

### File layout

```
src/worker.js          Thin fetch() entrypoint — auth gate, route dispatch,
                        static-asset fallback. No Express-like framework.
src/routes/index.js     Central dispatch, returns Response or null.
src/services/catalog.js   Products, Variants, ProductionBatches, Locations,
                           product_dimensions (see Variant Dimensions Pass).
src/services/receiving.js Batch receipts, register-units.
src/services/units.js     Unit events, atomic seq via db.batch().
src/services/stocktake.js Stocktake sessions/scans/reconciliation.
src/domain/errors.js       Central error normalization (see below).
src/domain/validation.js   ValidationError class.
src/auth/index.js          Session cookie auth, fail-closed boot check.
public/*.html               Plain HTML+JS pages, no build step, no framework.
schema.sql                  Original D1 schema (13 tables).
schema-add-dimensions.sql   Additive migration for product_dimensions.
wrangler.toml                Cloudflare config — see gotchas below.
```

Deploy with `npx wrangler deploy` from this directory. No CI — it's a
one-shot deploy from Claude's/Izzat's machine.

### Two Cloudflare-specific gotchas already hit (don't reintroduce)

1. **Assets binding bypasses the Worker (and its auth gate) by default.**
   An unauthenticated request to `/` was served the full app HTML directly
   by Cloudflare's static-asset layer, never reaching `authGate`. Fixed with
   `run_worker_first = true` in `wrangler.toml` — this MUST stay set.
2. **`html_handling` default redirects `/login.html` → `/login`**, but the
   auth allowlist only knows `/login.html` — this created an infinite
   redirect loop. Fixed with `html_handling = "none"`. Combined with
   `not_found_handling = "none"`, the assets binding then does NOT
   auto-map `/` → `index.html` either — `src/worker.js` explicitly rewrites
   `/` to `/index.html` before calling `env.ASSETS.fetch()`. If you ever
   touch `wrangler.toml`'s `[assets]` block, re-verify all three of these
   behaviors (auth bypass, redirect loop, root 404) — they're independent
   failure modes that all look like "the page is broken" from the outside.

### Data model invariants (unchanged since the Postgres era, still enforced)

- **Intent ≠ Observation ≠ Event ≠ Accepted quantity.** Batch has
  `planned_quantity`; a receipt has `observedQuantity` (what physically
  arrived) and `acceptedQuantity`/`rejectedQuantity` (into stock vs not) —
  kept strictly separate through the whole receiving flow.
- **Unit projection has three separate columns**: `current_disposition`,
  `current_condition`, `current_location_id`. Never merge into one status
  field.
- **"Not scanned ≠ missing."** A stocktake's expected-units snapshot is
  taken at session OPEN (only `AVAILABLE`-disposition units); reconciliation
  (OK / NOT_OBSERVED / UNEXPECTED) is computed at read time, never stored.
  Confirming "missing" is a separate, deliberate action — never automatic.
- **Error normalization** (`src/domain/errors.js`, Director-mandated as one
  central layer, not per-route patches): FK violation → 400 "Referenced
  resource does not exist.", uniqueness/conflict → 409, `ValidationError` →
  400 with the real message, anything else → 500 (logged server-side via
  `console.error`, never raw SQL/table names in the response body).

### Variant Dimensions Pass (shipped 2026-09-11)

Products can now optionally declare **editor-defined dimensions** (e.g.
"Size", "Color", "Material" — no hardcoded universal list). A new
`product_dimensions` table (`id, product_id, name, sort_order`, additive
migration in `schema-add-dimensions.sql`) records which dimension names a
product uses; `variant_attributes` (pre-existing table) still holds the
actual key→value pairs per Variant. **Critically: the system never
auto-generates the full Cartesian product** of dimension combinations — the
editor defines dimensions, then creates only the specific combinations that
actually exist (a school might order only 3 of the 72 theoretically possible
Size×Color×Cut×Sleeve combinations). Products with no dimensions declared
(e.g. a book) keep the old plain-text variant label.

This shipped via **Izzat personally overriding** the Director's "wait until
after Gate B" sequencing — he judged (correctly) that Gate B's remaining
blocker (his Xprinter hadn't arrived yet) was unrelated to this structural
fix, so there was no reason to let unrelated hardware delay block a proven
defect. The Director accepted the override after reviewing the shipped
implementation and closed it as PASS. This is the precedent for when an
owner-override is legitimate: Izzat's own reasoning, stated explicitly, not
Claude's initiative.

**Known open follow-up (Director-flagged, not urgent, not built)**:
dimension identity currently equals its display name (`variant_attributes.key`
is the literal typed name). If a future feature lets editors rename a
dimension, existing attributes keyed by the old name would silently detach.
No renaming UI exists yet, so this isn't live risk — just remember it if
that feature is ever requested.

## Language/copy rule for this project (different from Adjung Core!)

**Labelism's UI, API responses, and code comments must be 100% English.**
This is the opposite of Adjung Core (a separate project also on this
machine, which requires 100% Bahasa Melayu UI). Izzat explicitly corrected
Claude for leaking Malay words ("Saiz", "Warna") into Labelism's UI on
2026-09-11 — self-check before writing any UI copy here. Chat replies to
Izzat can still be in Malay (he prefers that in conversation), but nothing
that renders in the app or its API.

Also: **don't lean on Izzat's specific book in UI copy/placeholders.** He
corrected an example like "e.g. Surat-surat Aisha Hamdan, or Jersey Bola
Sekolah ABC" as too book-focused and unprofessional-sounding for a product
meant to be domain-agnostic. Use generic, professional placeholder examples.

## Credentials

- Admin user: `izzat`
- Password: `Labelism-d1-9f2a71` (generated fresh for the D1 deployment —
  do not confuse with the old Neon-era password, which is dead now)
- Change via re-hashing if Izzat ever asks — check `src/auth/index.js` for
  the current hashing mechanism before assuming it matches the old
  Postgres-era `scripts/hash-password.mjs` (that script lived in the OTHER
  repo and may not exist here).

## Backup/recovery — both proven live, not just documented

1. **D1 Time Travel** (Cloudflare's built-in point-in-time restore): tested
   by creating a known marker row, recording its bookmark via
   `wrangler d1 time-travel info`, deleting the row, then restoring. This
   restore command is a **whole-database rollback** and is correctly blocked
   by the safety classifier when Claude tries to run it directly — **Izzat
   ran it himself** (had to use `npx.cmd` instead of `npx` due to a
   PowerShell execution-policy block on his machine). Don't try to work
   around that classifier block; hand Izzat the exact command instead.
2. **Independent export**: `wrangler d1 export --remote` → portable `.sql`
   file → imported into a fresh throwaway D1 database → confirmed data
   reconstructs correctly. This is safe for Claude to run directly (it's
   read-only against production; only the throwaway target gets written).

Both were verified with real synthetic data through the real API, not mocked.

## Current status / what's pending

- **Technical Deployment Gate**: CLOSED (Director confirmed all-PASS
  2026-09-11): deployment functionality, D1 as operational DB, auth/route
  protection, core workflow equivalence, event ordering/concurrency, atomic
  event+projection updates, stocktake semantics, error normalization,
  persistence across redeploy, D1 Time Travel recovery, independent
  export/restore.
- **Variant Dimensions Pass**: shipped and Director-confirmed PASS (see
  above).
- **Gate B (physical rehearsal)**: IN PROGRESS, blocked on Izzat's Xprinter
  thermal label printer arriving. The "Print Labels" page (`label.html`)
  already supports real thermal label sizes (40x30mm / 50x30mm / 60x40mm
  dropdown, one label per printed page via `@page` CSS) — built proactively
  once Izzat mentioned the printer, verified against real thermal label
  size standards (not guessed). When he has the printer + label roll size
  confirmed, verify the size dropdown covers what he actually bought.
- **Productization Pass**: NOT STARTED. Director's assessment (2026-09-08):
  architecture is strong (7.5/10 — event sourcing, disposition/condition/
  location separation, stocktake semantics all correct) but product
  experience is weak (3-4/10 — "looks far too much like a prototype": no
  onboarding, no dashboard, technical naming, no branding). This comes after
  Gate B in the agreed sequence, unless Izzat overrides again like he did
  for Variant Dimensions.
- **Real-data authorization**: BLOCKED until Gate B + Productization Pass +
  final operational review all pass. Do not treat any test/synthetic data
  work as authorization to start using real book/jersey data.
- **No git repo for `Labelism-D1` yet.** Worth setting one up (GitHub, like
  the old repo had one at `alkutawi01/Labelism`) so there's real history and
  Izzat/Director can review diffs, but this hasn't been asked for explicitly
  — raise it as a suggestion, don't just do it.

## A UX lesson from this session, worth remembering

When Izzat said the flow "feels hard" (macam susah), the fix wasn't
guessing — it was running an actual realistic simulation through the real
UI (a school jersey order, 3 real variant combinations) and watching what
broke or felt clunky. This surfaced two real, fixable defects (the
Receiving form forcing users to type the same quantity twice; the flat
variant-label field being structurally wrong for multi-dimension products)
that would not have been obvious from reading the code. **When a
non-technical owner says something "feels off" but can't articulate why,
simulate the real workflow with realistic data rather than asking him to
diagnose it himself.**
