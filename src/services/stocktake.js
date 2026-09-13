// Stocktake sessions/scans/close -- preserves the "not scanned != missing"
// rule: expected_units is an immutable snapshot taken at OPEN time (only
// AVAILABLE units), reconciliation (ok/notObserved/unexpected) computed at
// read time and never stored, closing is a separate explicit action.
import { newInternalId, buildEventBatch } from '../db/d1.js';
import { ValidationError } from '../domain/validation.js';

// Director's correction (Domain Model Revision Pass v1): a warehouse count
// should expect "what's physically supposed to be HERE," not "every
// AVAILABLE unit anywhere in this batch" -- a batch that's split across a
// warehouse and two customers must not have its shipped units show up as
// falsely "Not Observed" during a warehouse stocktake. So a session is now
// scoped to EITHER a location (expected = AVAILABLE units currently at
// that location, regardless of batch) OR, for backward compatibility, a
// batch (legacy behavior, expected = every AVAILABLE unit in that batch
// regardless of location) -- exactly one of the two must be given.
export async function openStocktakeSession(db, { batchId, locationId, actor }) {
  if (!batchId && !locationId) throw new ValidationError('Either batchId or locationId is required.');
  if (batchId && locationId) throw new ValidationError('Provide batchId or locationId, not both.');

  let availableUnits;
  if (locationId) {
    const location = await db.prepare('SELECT id FROM locations WHERE id = ?').bind(locationId).first();
    if (!location) return { notFound: true };
    ({ results: availableUnits } = await db
      .prepare("SELECT id FROM units WHERE current_location_id = ? AND current_disposition = 'AVAILABLE'")
      .bind(locationId)
      .all());
  } else {
    const batch = await db.prepare('SELECT * FROM production_batches WHERE id = ?').bind(batchId).first();
    if (!batch) return { notFound: true };
    ({ results: availableUnits } = await db
      .prepare("SELECT id FROM units WHERE batch_id = ? AND current_disposition = 'AVAILABLE'")
      .bind(batchId)
      .all());
  }

  const id = newInternalId();
  const statements = [
    db
      .prepare('INSERT INTO stocktake_sessions (id, batch_id, location_id, started_by) VALUES (?, ?, ?, ?)')
      .bind(id, batchId ?? null, locationId ?? null, actor ?? null),
    ...availableUnits.map((u) =>
      db.prepare('INSERT INTO stocktake_expected_units (session_id, unit_id) VALUES (?, ?)').bind(id, u.id)
    ),
  ];
  await db.batch(statements);

  return { id, batchId: batchId ?? null, locationId: locationId ?? null, status: 'OPEN', expectedCount: availableUnits.length };
}

// Field Simulation Pass 3, Scenario A (disaster recovery): every other
// session-based flow in Labelism (Shipment packing, Return Intake) lists
// its open/recent sessions with a Resume button -- this page never did.
// A stocktake session's scans are all persisted server-side the instant
// each one happens, so no scan progress is ever actually lost if a
// device dies or a tab closes mid-count. But without this list, that
// progress was still practically unreachable: the only state tying an
// operator to a session was a JS variable in memory, gone the moment the
// page reloaded, with no way to even discover the session still existed.
export async function listStocktakeSessions(db) {
  const { results } = await db
    .prepare(
      `SELECT ss.id, ss.status, ss.started_at, ss.closed_at, l.name AS location_name,
              pb.batch_number, p.name AS product_name, v.variant_label,
              (SELECT COUNT(*) FROM stocktake_expected_units seu WHERE seu.session_id = ss.id) AS expected_count,
              (SELECT COUNT(*) FROM stocktake_scans sc WHERE sc.session_id = ss.id) AS scanned_count
       FROM stocktake_sessions ss
       LEFT JOIN locations l ON l.id = ss.location_id
       LEFT JOIN production_batches pb ON pb.id = ss.batch_id
       LEFT JOIN variants v ON v.id = pb.variant_id
       LEFT JOIN products p ON p.id = v.product_id
       ORDER BY ss.started_at DESC
       LIMIT 20`
    )
    .all();
  return results;
}

export async function getStocktakeSession(db, sessionId) {
  const session = await db.prepare('SELECT * FROM stocktake_sessions WHERE id = ?').bind(sessionId).first();
  if (!session) return null;

  const { results: expected } = await db
    .prepare(
      `SELECT u.id, u.human_code, u.current_disposition FROM stocktake_expected_units seu
       JOIN units u ON u.id = seu.unit_id
       WHERE seu.session_id = ?`
    )
    .bind(sessionId)
    .all();

  const { results: scanned } = await db
    .prepare(
      `SELECT u.id, u.human_code, u.batch_id FROM stocktake_scans ss
       JOIN units u ON u.id = ss.unit_id
       WHERE ss.session_id = ?`
    )
    .bind(sessionId)
    .all();

  const expectedIds = new Set(expected.map((u) => u.id));
  const scannedIds = new Set(scanned.map((u) => u.id));

  const ok = expected.filter((u) => scannedIds.has(u.id));
  const notObserved = expected.filter((u) => !scannedIds.has(u.id));
  // expectedIds already reflects the session's actual scope (batch OR
  // location) -- a separate batch_id comparison here would incorrectly
  // flag every scan as unexpected for location-scoped sessions, since
  // session.batch_id is null there but every real unit has a non-null
  // batch_id.
  const unexpected = scanned.filter((u) => !expectedIds.has(u.id));

  return {
    id: session.id,
    batchId: session.batch_id,
    locationId: session.location_id,
    status: session.status,
    startedAt: session.started_at,
    closedAt: session.closed_at,
    expectedCount: expected.length,
    ok: ok.map((u) => u.human_code),
    notObserved: notObserved.map((u) => ({ id: u.id, humanCode: u.human_code, missingConfirmed: u.current_disposition === 'MISSING' })),
    unexpected: unexpected.map((u) => u.human_code),
  };
}

export async function scanStocktakeUnit(db, sessionId, { code, actor }) {
  const session = await db.prepare('SELECT * FROM stocktake_sessions WHERE id = ?').bind(sessionId).first();
  if (!session) return { notFound: true };
  if (session.status !== 'OPEN') throw new ValidationError('Stocktake session is not open.');
  if (!code) throw new ValidationError('code is required.');

  // human_code alone can match more than one unit (it's only unique within
  // a batch, by design -- see units.lookupUnit for the full rationale).
  // internal_token/public_token matches are always unique. Since a
  // stocktake session (batch- or location-scoped) has a concrete expected
  // set already snapshotted, prefer whichever match (if any) is actually
  // IN that expected set instead of guessing -- resolves the common case
  // (operator manually types a code for an item that IS expected here)
  // without ever silently recording an event against the wrong physical
  // unit. This works for both scoping modes, unlike comparing batch_id
  // directly (which breaks for location-scoped sessions, where there is
  // no single batch_id to compare against).
  const { results: matches } = await db
    .prepare('SELECT * FROM units WHERE human_code = ?1 OR internal_token = ?1 OR public_token = ?1')
    .bind(code)
    .all();
  if (!matches.length) return { notFound: true, reason: 'unit' };
  let unit = matches[0];
  if (matches.length > 1) {
    const { results: expectedHere } = await db
      .prepare('SELECT unit_id FROM stocktake_expected_units WHERE session_id = ? AND unit_id IN (' + matches.map(() => '?').join(',') + ')')
      .bind(sessionId, ...matches.map((m) => m.id))
      .all();
    const expectedMatches = matches.filter((m) => expectedHere.some((e) => e.unit_id === m.id));
    if (expectedMatches.length === 1) {
      unit = expectedMatches[0];
    } else {
      throw new ValidationError(
        `Code "${code}" matches more than one unit and isn't uniquely identifiable here -- scan the QR instead of typing the code.`
      );
    }
  }

  const expectedRow = await db
    .prepare('SELECT 1 AS present FROM stocktake_expected_units WHERE session_id = ? AND unit_id = ?')
    .bind(sessionId, unit.id)
    .first();
  const alreadyExpected = Boolean(expectedRow);

  const scanId = newInternalId();
  const eventId = newInternalId();

  // INSERT OR IGNORE ... RETURNING is the atomic test-and-set: a plain
  // SELECT-then-INSERT here would reopen the exact TOCTOU race D1's
  // single-writer serialization does NOT protect against a check performed
  // as a separate statement outside a batch. Whether a row comes back is
  // itself the truth of "was this genuinely new" -- no prior read needed.
  const insertScan = await db
    .prepare('INSERT OR IGNORE INTO stocktake_scans (id, session_id, unit_id, actor) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(scanId, sessionId, unit.id, actor ?? null)
    .run();

  const inserted = insertScan.results.length > 0;
  if (inserted) {
    const eventStatements = buildEventBatch(db, {
      eventId,
      unitId: unit.id,
      eventType: 'STOCKTAKE_OBSERVED',
      payload: { sessionId },
      actor,
    });
    await db.batch(eventStatements);
  }

  return {
    unitId: unit.id,
    humanCode: unit.human_code,
    alreadyScanned: !inserted,
    unexpected: !alreadyExpected,
  };
}

export async function closeStocktakeSession(db, sessionId, actor) {
  const session = await db.prepare('SELECT * FROM stocktake_sessions WHERE id = ?').bind(sessionId).first();
  if (!session) return { notFound: true };
  if (session.status !== 'OPEN') throw new ValidationError('Stocktake session is not open.');

  await db
    .prepare("UPDATE stocktake_sessions SET status = 'CLOSED', closed_at = datetime('now'), closed_by = ? WHERE id = ?")
    .bind(actor ?? null, sessionId)
    .run();

  return { id: sessionId, status: 'CLOSED' };
}
