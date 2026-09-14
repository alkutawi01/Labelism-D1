# Labelism — Handoff

Originally written 2026-09-12, updated 2026-09-14 for whichever Claude session picks this up next. Read this fully before touching anything — this project has a strict collaboration protocol (see "Director protocol") and went through a hard domain-model pivot (see §3) that is easy to accidentally reintroduce if you only skim.

## 1. What this is

Labelism is a self-hosted **production-accountability / label-verification system**, currently built and used for **Izzat's custom-garment factory** (school uniforms, jerseys — made-to-order, not stocked). It gives every physical unit a persistent digital identity tracked through `Order → OrderLine → ProductionBatch → Unit → UnitEvent`, with QR labeling, scan-based attachment verification, and shipment reconciliation.

Historically it started as a general "Unit Identity Core" with book publishing as the first real use case ("Surat-surat Aisha Hamdan" — Izzat's actual first book) and jerseys/uniforms as secondary. The domain model has since been corrected specifically around the garment-factory use case (§3) — the system still works for other product types (a unit doesn't require a recipient name, size, etc.), but don't assume the book use case is what's being actively designed for now.

**This is NOT a SaaS product.** Izzat is building this for his own businesses. He is the sole intended operator. Do not add multi-tenant concepts, billing, public signup, etc.

Izzat is a non-technical founder-operator, not a developer. Explain things in terms of what he'll see/click, not implementation detail, unless he's asking a technical question directly. He prefers casual Malay/English in conversation — but see the hard UI-language rule in §11.

- Repo: https://github.com/alkutawi01/Labelism-D1 (this is the live one)
- There is an **older, retired sibling repo**, plain `Labelism` (no `-D1` suffix) — the original Vercel + Neon Postgres iteration, kept only as history/fallback. **Do not deploy or edit that repo.**
- Production: https://labelism.alkutawi01.workers.dev
- Local dev: `npx wrangler dev` (port 8788, auto-reloads on file save)
- Deploy: `npx wrangler deploy`
- DB: Cloudflare D1, binding `DB`, database name `labelism`, id `631e90a3-18ed-45a4-97b2-ec5e4b5fcee2`

## 2. Director protocol — read this before making any scope decision

Izzat runs a **ChatGPT project called "IZZAT"**, with a chat thread inside it called **"Labelism"**. That thread is called **"Director"** throughout this project's history — it holds architectural/product authority. Claude is the "execution engineer": build, test with real evidence, and push back on the Director's calls when there's a genuine technical/UX/data reason backed by evidence, not preference. **The Director's word is final on scope unless Izzat personally overrides it** — this has happened before (see Variant Dimensions Pass, §9) and is legitimate; Izzat outranks the Director he appointed.

**Working rhythm** (established over many sessions, still current): do a round of work → report findings + fixes to Director in the ChatGPT thread → ask Director to review GitHub and propose the next simulation/decision → get Director's decision → repeat.

**Rule on when to wait for sign-off:** get Director's approval before building new mutation capabilities or domain-model changes. Small, additive, read-only UI/read-model fixes (no schema change, no new mutation) can proceed without waiting — used repeatedly this way, never objected to after the fact.

**Report format Director has asked for on non-trivial changes** (a template used earlier in the project — still good practice even though recent reports have been more free-form prose):
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

**Never claim a physical/manual step happened unless it actually did.** E.g. never tell Director "Gate B: PASS" unless Izzat has personally done the physical test. Same standard for anything requiring Izzat's hands, not just Claude's.

**Browser navigation gotcha:** navigating directly to `https://chatgpt.com/` loses the thread. Go via the sidebar: click the **IZZAT** project folder, then the **Labelism** chat item inside it. `get_page_text` reads from the top of the DOM — to reach the latest message in this (now very long) thread, use a large `max_chars` (400000 has worked reliably).

**Session logout:** the ChatGPT tab has logged out mid-session more than once. Never attempt to log in yourself (entering passwords is prohibited) — report the blocker to Izzat and continue with any already-approved, non-domain-decision work meanwhile.

**A failure mode to watch for:** Director (ChatGPT) has previously overclaimed Izzat's authorization for its own decisions, framing things as "Izzat confirmed" when it was Director's own call. Verify independently when it matters.

## 3. The pivot (2026-09-14) — why the domain model looks the way it does

Before this pivot, a plan called **"Domain Model Revision Pass v1"** was approved (Customer→Order→OrderLine→Product/Variant, `UNIT_DISPATCHED` as an event not a disposition, location-scoped Stocktake, an optional `UNIT_ALLOCATION` entity) and Labelism was drifting into an inventory/ERP shape: `Customer → Order → Product → Batch → Receiving → Unit → Label → Pack → Ship → Return → Stocktake`, where a `Unit` was only created after `Receiving` confirmed physical arrival.

**Izzat corrected this entire framing.** His words (verbatim — the single most important piece of context in this project):

> "yg awak ni pelik, kami kilang baju custom made, bukan pemborong baju yg jual baju semula kepada pihak ketiga. masalah syarikat kami: ada banyak kes terlebih hasilkan baju, ada kes terkurang jahit, ada silap saiz, dan sebagainya. kami cuma tau bila customer lapor. jadi, saya nak sistem ni boleh atasi dengan kesan dari awal. apabila ada label, kalau ada 10 label, 10 label tu wajib digunakan. kalau 9 sahaja label digunakan, ertinya ada 1 unit tak dihasilkan. kalau label tak cukup ertinya ada unit terlebih. faham? simple je, tp awak dah ubah sistem jadi rumit."

And on partial shipment:

> "customer kadang2 nak sebahagian tempahan dahulu dihantar, mungkin 500 daripada 1000. sistem dah hasilkan 1000 label, so mcm mana? so masa ni la perlunya ada batch. kalau kami tau dari awal customer nak mcm tu, kami ada print label ikut batch: batch 1: 500, batch 2: 500. kalau kami tau lambat, lepas label dh dicetak, kami akan scan 500 masa packing, dan tanda itu sebagai unit dah dihantar, maka 500 lg secara automatik diketahui belum dihantar."

**The corrected model** (this is what's actually built and live):

```
Order → Labelism generates labels IMMEDIATELY per ordered quantity
      → a label = "a promise/obligation to produce one unit," not proof one already exists
      → production attaches labels to physical garments (scan + confirm)
      → packing/QC scan is the actual reconciliation point that reveals
        missing / extra / wrong units
```

- **Receiving, Return Intake, and Stocktake are NOT deleted** — demoted to optional/secondary modules, still in the code, no longer mandatory gates.
- **Batch ≠ Shipment.** `ProductionBatch` = how production was organized (can be split — Batch 1/Batch 2 for a 500+500 order). `Shipment` = what has actually been delivered to the customer. One shipment fulfills exactly one order line (v1 limit, Director-mandated — no shipment spanning multiple order lines, no separate Allocation table, revisit only if a real case proves it wrong).
- The **"Domain Model Revision Pass v1" / `UNIT_ALLOCATION` planning line is superseded** by this pivot. Do not resurrect it. If a stale prompt or memory references it, treat it as historical context only, not live direction.

## 4. Current schema (post-pivot, as actually deployed)

See `schema.sql` + the incremental `schema-add-*.sql` files for exact DDL history. Key tables:

- `customers`, `orders`, `order_lines` (`variant_id` OR free-text `description`, `quantity_ordered`, optional `notes`)
- `products`, `variants`, `product_dimensions` (see §9 — editor-defined dimension names), `variant_attributes` (key→value per variant)
- `production_batches` (`order_line_id` nullable FK, `planned_quantity`, `batch_number`)
- `batch_receipts` (optional/secondary — still exists, no longer mandatory)
- `units` (`batch_id`, `batch_receipt_id` nullable, `human_code` — unique **within a batch only**, not globally — `internal_token`/`public_token` — globally unique, what the QR actually encodes — `label_confirmed_at`, `current_disposition`, `current_condition`, `current_location_id`, `last_event_seq`)
- `unit_events` (append-only event log per unit, `seq` monotonic per unit via `SELECT MAX(seq)+1 ... WHERE unit_id=?` inside the same `db.batch()`)
- `shipments` (`order_line_id`, `reference`, `planned_quantity`, `status`: OPEN → CLOSED → DISPATCHED, `destination_location_id`)
- `shipment_units` (join table; a unit can be an active member of at most one non-DISPATCHED shipment)
- `return_intakes`, `stocktake_sessions`, `locations` — secondary modules, largely untouched in the recent pivot round

**`human_code` is deliberately non-globally-unique** — a meaningful print-run serial ("copy #1 of this batch"), Izzat's explicit correction. Only `internal_token`/`public_token` (QR content) are globally unique. `lookupUnit()`/`verifyLabelScan()` handle the resulting ambiguity by returning every match rather than silently picking one.

## 5. Data model invariants (unchanged since the original Postgres era)

- **Intent ≠ Observation ≠ Event ≠ Accepted quantity.** Batch has `planned_quantity`; a receipt (where still used) has `observedQuantity` vs `acceptedQuantity`/`rejectedQuantity` — kept strictly separate.
- **Unit projection has three separate columns**: `current_disposition`, `current_condition`, `current_location_id`. Never merge into one status field. Post-pivot, `label_confirmed_at` is a fourth current-state field alongside these — treat it the same way (mutable current state, not an immutable "ever happened" record — see the Priority 5B fix in §7).
- **"Not scanned ≠ missing."** Reconciliation (OK / NOT_OBSERVED / UNEXPECTED / MISSING) is computed at read time from events, never stored as a separate flag. Confirming "missing" is a deliberate action, never automatic.
- **Error normalization** (`src/domain/errors.js`, one central layer): FK violation → 400, uniqueness/conflict → 409, `ValidationError` → 400 with the real message, anything else → 500 (logged server-side, never raw SQL/table names in the response body).

## 6. File layout

```
src/worker.js              Thin fetch() entrypoint — auth gate, route dispatch, static-asset fallback.
src/routes/index.js         Central dispatch, returns Response or null.
src/services/catalog.js     Products, Variants, ProductionBatches, Locations, product_dimensions.
src/services/orders.js      Customer/Order/OrderLine + per-order Reconciliation view (new, §7 Priority 6).
src/services/receiving.js   Batch receipts, register-units, generateUnitsForBatch (the pivot's core mechanism).
src/services/units.js       Unit events, label verify/confirm/reissue, atomic seq via db.batch().
src/services/shipments.js   Shipment create/scan/close/dispatch, cross-order/attachment guards.
src/services/stocktake.js   Stocktake sessions/scans/reconciliation.
src/domain/errors.js        Central error normalization.
src/domain/validation.js    ValidationError class.
src/auth/index.js           Session cookie auth, fail-closed boot check.
public/*.html                Plain HTML+JS pages, no build step, no framework.
schema.sql                   Original D1 schema.
schema-add-*.sql             Additive migrations, in order — check filenames for history.
wrangler.toml                 Cloudflare config — see gotchas below.
```

No CI — deploys are one-shot from Claude's/Izzat's machine via `npx wrangler deploy`.

## 7. What's been built and verified — Core Production Simulation, Priority 1–6

Director ran a structured live-simulation framework ("Core Production Simulation") post-pivot, 6 priorities, each tested against `localhost:8788` via `javascript_tool` fetch calls (not just clicking through the UI). Recurring principle:

> "Sistem boleh tahu apa yang digital. Manusia masih perlu sahkan apa yang fizikal." (The system can know what's digital; humans still must verify what's physical.)

| # | Priority | Outcome | Commit |
|---|---|---|---|
| — | Cascading Customer→Invoice→Delivery Order picker for Pack & Ship | fixed | `44fca50` |
| — | Generate units/labels immediately from order quantity, no mandatory Receiving | the pivot itself | `2ea6130` |
| 1 | Production Shortfall | `closeShipment()` now names the specific `missingUnits` (human codes), not just a count | `8adc262` |
| 2A | Overproduction, no label at all | confirmed boundary, no fix — zero digital trace until scanned | — |
| 2B | Overproduction, duplicated label | server already rejected re-scan; fixed the wording to warn of a possible duplicate/counterfeit label | `8d5f9d6` |
| 2C | Cross-order contamination | re-verified, already solid | — |
| 3 | Wrong size / wrong garment, correct label | confirmed boundary — attachment flow only verifies label identity, never physical attributes. Director: don't add a "confirm physical match" checkbox; the printed label's own text is the QC tool. **Deferred**: recipient name as identity (§10) | — |
| 4 | Partial shipment | rollup was conflating "packed into a closed-but-undispatched shipment" with "actually dispatched" — split into a `dispatched` vs `packed but not yet dispatched` breakdown | `afb39f3` |
| 5A | Label lost/damaged before attachment | already worked (pre-existing `reissueLabel()` — rotates tokens, old QR dies) | — |
| 5B | Label lost/damaged after attachment confirmed | **real gap, fixed.** `reissueLabelAfterAttachment()`: records `DAMAGE_OBSERVED` then `LABEL_REISSUED`, rotates tokens, clears `label_confirmed_at` so the unit re-enters "awaiting attachment" and must be re-scanned+confirmed. Also fixed: `confirmLabel()`'s "was this scanned" check now requires scan `seq` > the unit's most recent `LABEL_REISSUED` seq — otherwise a stale pre-reissue scan would satisfy the check | `e1c2bdf` |
| 5C | Staff double-clicks print | confirmed safe — `window.print()` never touches the server; `generateUnitsForBatch()` already guards double-calls | — |
| 6 | F6-001 — full 100-unit, 3-variant order lifecycle, end to end | **2 real bugs found and fixed.** (a) `canUnitFulfillShipment()` never checked `label_confirmed_at` — an unattached unit could be packed, bypassing attachment verification entirely. (b) `closeShipment()`'s `missingUnits` conflated "genuinely missing" with "not yet produced" — both scoped to `label_confirmed_at IS NOT NULL`. Also built a per-order **Reconciliation view** (Orders page → "Reconciliation" button → per-line + total Ordered/Generated/Attached/Packed/Dispatched) | `3cba62e`, `d339f44` |

**Fasa 6 finding (unresolved by design):** looked up a unit by recipient name ("Ahmad") — `Unit not found`. Zero name-based lookup exists. This is the concrete evidence behind the deferred decision in §10.

## 8. Digital Preflight (D1–D4) — done, no code changes

- **D1 (cross-device consistency):** by design — all real data is server-side in D1. The one per-device thing is `Working as [name]` (`localStorage`, `public/nav.js` → `window.LabelismActor`), intentionally not a login system. Fine as-is.
- **D2 (empty states):** 9 of ~10 pages have clear "no data yet" messaging.
- **D3 (operator mistakes):** exercised extensively across Priority 1–6 (double-scan, double-print, early-close, reissue-without-rescan, double-generate). No dead ends found.
- **D4 (backup):** production D1 exported via `npx wrangler d1 export labelism --remote --output=...`; a copy is in `backups/` (gitignored/untracked). **Re-run this before real customer data flows in** — the one on disk as of 2026-09-14 is test data only.
- **D5 (operator language):** requires real factory staff, folded into the Gate B manual (§9) as a feedback sheet.

## 9. Prior productization work (2026-09-08 to 2026-09-11, pre-pivot)

Still live and relevant, unaffected by the pivot:

- **Three architectures in one week**, in order: local SQLite (no free card-free host with persistent disk) → Vercel + Neon Postgres (abandoned after discovering the Neon org was secretly on a paid plan with a real card already accruing charges, plus real Vercel framework-detection bugs) → **Cloudflare Workers + D1** (current — Izzat already had a Cloudflare account; D1 is SQLite under the hood). If the execution model ever changes again, prove concurrency safety with a dedicated spike before porting — this was done once already (10 concurrent event requests → seq 1–10, zero collisions) and worked.
- **D1 concurrency**: `db.batch()` is the all-or-nothing atomic unit (not `UPDATE ... RETURNING` like Postgres). Statements execute sequentially within one transaction — a later statement's subquery does see an earlier statement's insert within the same `db.batch()` call (this is how `seq` reservation in `buildEventBatch()` works).
- **Two Cloudflare-specific gotchas already hit — do not reintroduce:**
  1. The Assets binding bypasses the Worker (and its auth gate) by default. Fixed with `run_worker_first = true` in `wrangler.toml` — must stay set.
  2. Default `html_handling` redirects `/login.html` → `/login`, but the auth allowlist only knows `/login.html` — infinite redirect loop. Fixed with `html_handling = "none"` + `not_found_handling = "none"`; `src/worker.js` explicitly rewrites `/` → `/index.html` before `env.ASSETS.fetch()`. If you ever touch `wrangler.toml`'s `[assets]` block, re-verify all three behaviors (auth bypass, redirect loop, root 404).
- **Variant Dimensions Pass** (shipped 2026-09-11): products can optionally declare editor-defined dimensions (e.g. "Size", "Color") via `product_dimensions`; `variant_attributes` holds actual key→value pairs. The system never auto-generates the full Cartesian product of combinations — only the specific ones that exist get created. Shipped via **Izzat personally overriding** Director's sequencing (he judged the printer-arrival blocker on Gate B was unrelated to this fix) — the precedent for a legitimate owner-override: Izzat's own explicit reasoning, not Claude's initiative.
  - **Known open follow-up (not urgent, not built):** dimension identity currently equals its display name. If a rename-dimension feature is ever built, existing attributes keyed by the old name would silently detach.
- **Backup/recovery, both proven live:**
  1. **D1 Time Travel** (Cloudflare's built-in point-in-time restore) — tested with a marker row + `wrangler d1 time-travel info` bookmark + restore. The restore command is a whole-database rollback and gets correctly blocked by the safety classifier when Claude runs it directly — **hand Izzat the exact command to run himself** (he needed `npx.cmd` instead of `npx` due to a PowerShell execution-policy block).
  2. **Independent export**: `wrangler d1 export --remote` → portable `.sql` → import into a throwaway D1 DB → confirmed reconstruction. Safe for Claude to run directly (read-only against production).

## 10. Current status (as of 2026-09-14)

Director's own words, verbatim, marking the end of the digital phase:

```
CORE DIGITAL VALIDATION      ✅ CLOSED
CORE SIMULATION P1-P6        ✅ CLOSED
DIGITAL PREFLIGHT D1-D4      ✅ CLOSED
PHYSICAL GATE B              ⏳ MENUNGGU UJIAN KILANG (waiting on factory test)
```

**Director's explicit standing instruction: do not add any more features until Gate B (the physical floor test) produces results.** Stated directly: "Arahan seterusnya kepada Claude: jangan tambah feature lagi."

The recurring cron loop driving this work (`Sambung kerja Labelism...`, every 30 minutes) was **cancelled** after firing 3+ times with zero new information — its own text was stale (still referenced the pre-pivot "Domain Model Revision Pass v1" / `UNIT_ALLOCATION` plan) and there was nothing left to do without either Gate B results or updated direction from Izzat.

**Explicitly deferred — do not build until told to:**

- **Recipient name as a unit attribute.** Director's decision: yes eventually, as a **searchable attribute** (e.g. `unit_attributes` key=`recipient_name`), **never** as the unit's primary identity (QR token stays identity — a name can repeat, be misspelled, span two units). Half-built precursor exists: `unitNames`/`plannedUnitNames` gets captured at Import-from-Document time into the batch's `notes` field (`src/services/importManifest.js`) but is never assigned to a specific Unit row or shown on any label. **Deferred until after Gate B** — Director wants to know whether it's needed on the physical label, in lookup, in reconciliation, or all three, before deciding where to surface it.
- Customer 360 / customer profile pages, staff assignment / workflow engine, approval system, full inventory/ERP layer, any new unit-lifecycle status enum beyond what exists (Director explicitly warned against ERP-style status sprawl like `PRINTED`/`ATTACHED`/`DAMAGED_LABEL`/`REPLACEMENT_PENDING` — the event log + a couple of current-state columns is deliberately kept minimal).
- **Productization Pass** (pre-pivot assessment, still likely relevant post-Gate-B): Director's 2026-09-08 assessment was architecture 7.5/10, product experience 3-4/10 ("looks far too much like a prototype": no onboarding, no dashboard, technical naming, no branding). This was sequenced *after* Gate B before the pivot happened and that sequencing still makes sense — don't start it until Gate B is done, unless Izzat explicitly overrides again.
- **Real-data authorization**: blocked until Gate B (and, per the pre-pivot plan, Productization Pass) both pass. Don't treat test/synthetic data work as authorization to start using real customer data.

## 11. Language/copy rule — do not violate this

**Labelism's UI, API responses, and code comments must be 100% English.** Izzat explicitly corrected Claude for leaking Malay words ("Saiz", "Warna") into the UI early on — self-check before writing any UI copy here. Chat replies to Izzat/Director can be in Malay (he prefers that in conversation), but nothing that renders in the app or its API responses. This was checked and held during the Priority 1–6 pivot work.

Also: don't lean on Izzat's specific book or garment orders in UI copy/placeholders — he corrected an early example as too specific/unprofessional. Use generic, domain-agnostic placeholder examples.

## 12. Credentials

- Admin user: `izzat`
- Password: check `src/auth/index.js` for the current hashing mechanism before assuming any password recorded in old notes is still valid — it may have been rotated. Don't guess; ask Izzat or check what's actually configured (`LABELISM_ADMIN_USER` env var is `izzat`; the password hash lives wherever `src/auth/index.js` reads it from).

## 13. The Gate B manual (2026-09-14 deliverable)

A physical-floor-test manual was written and published as an Artifact for Izzat: 3 concrete tests (printer/label legibility; hand a production worker the system with zero explanation and observe; give packing staff a shipment with a deliberately short label count and observe whether they notice and know what to do) plus a fill-in sheet for collecting real operator language (D5). Source file: `gate-b-manual.html` in the repo root (not committed to git — a one-off deliverable, not app code). To find the published link, check `Artifact({action: "list"})` for "Gate B Manual", or ask Izzat.

Note: "Gate B" as a term predates this deliverable — it was already established pre-pivot as "physical rehearsal" (see §9, blocked on the Xprinter arriving). Director's Gate B (factory floor test of the pivoted system) is a continuation of the same concept, not a new one.

## 14. What to do when you pick this up

1. **Check with Izzat first** — has Gate B actually happened? What did it find? This determines everything about what comes next. Don't assume the old Domain Model Revision Pass v1 / UNIT_ALLOCATION framing is still live; it isn't.
2. **If Gate B found issues:** those become the next round of fixes. Reproduce live locally first (`wrangler dev` + `javascript_tool` fetches, not guessing), fix the narrowest thing that closes the actual gap, deploy + commit + push, then report to Director before claiming anything resolved.
3. **If Gate B hasn't happened yet:** there's nothing to build. Don't manufacture new simulation scenarios or start on the deferred items in §10 — Director was explicit. Report status back to Izzat, or help him plan the actual factory test.
4. **If Izzat wants to resume the recurring-loop pattern:** re-create it with corrected, current instructions (referencing Gate B / post-Gate-B backlog, not the old pivot plan).
5. **Always report to Director** (ChatGPT, IZZAT project, "Labelism" thread) before/after any domain-affecting change, per §2. Small additive read-only UI fixes can proceed without waiting for sign-off first.

## 15. Practical gotchas learned across sessions

- `wrangler dev` auto-reloads on file save; no need to restart after edits.
- API field-name gotchas that cost time: `verify-label-scan` expects `code`, not `rawCode`; `dispatch` expects `locationName`, not `destination`; production batch creation requires `batchNumber` (not auto-generated).
- `lookupUnit`/scan endpoints by bare `human_code` can return `{ambiguous: true, candidates: [...]}` since human_code repeats across batches — prefer looking up by `internal_token` (the QR content) when you have it, especially in test scripts.
- Git line-ending warnings (`LF will be replaced by CRLF`) are cosmetic on this Windows checkout, ignorable.
- The repo's `git status` can be reported as "Is a git repository: false" in some tool-reported environment contexts even though `git log`/`git status`/commits all work fine from the actual working directory — a quirk of environment reporting, not a real problem.
- A UX lesson worth remembering: when Izzat says a flow "feels hard" but can't articulate why, don't guess — run an actual realistic simulation through the real UI with realistic data and watch what breaks or feels clunky. This has repeatedly surfaced real, fixable defects that weren't obvious from reading the code alone.
