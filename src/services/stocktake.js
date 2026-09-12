// Stocktake sessions/scans/close -- preserves the "not scanned != missing"
// rule: expected_units is an immutable snapshot taken at OPEN time (only
// AVAILABLE units), reconciliation (ok/notObserved/unexpected) computed at
// read time and never stored, closing is a separate explicit action.
import { newInternalId, buildEventBatch } from '../db/d1.js';
import { ValidationError } from '../domain/validation.js';

export async function openStocktakeSession(db, { batchId, actor }) {
  if (!batchId) throw new ValidationError('batchId is required.');
  const batch = await db.prepare('SELECT * FROM production_batches WHERE id = ?').bind(batchId).first();
  if (!batch) return { notFound: true };

  const id = newInternalId();
  const { results: availableUnits } = await db
    .prepare("SELECT id FROM units WHERE batch_id = ? AND current_disposition = 'AVAILABLE'")
    .bind(batchId)
    .all();

  const statements = [
    db.prepare('INSERT INTO stocktake_sessions (id, batch_id, started_by) VALUES (?, ?, ?)').bind(id, batchId, actor ?? null),
    ...availableUnits.map((u) =>
      db.prepare('INSERT INTO stocktake_expected_units (session_id, unit_id) VALUES (?, ?)').bind(id, u.id)
    ),
  ];
  await db.batch(statements);

  return { id, batchId, status: 'OPEN', expectedCount: availableUnits.length };
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
  const unexpected = scanned.filter((u) => !expectedIds.has(u.id) || u.batch_id !== session.batch_id);

  return {
    id: session.id,
    batchId: session.batch_id,
    status: session.status,
    startedAt: session.started_at,
    closedAt: session.closed_at,
    expectedCount: expected.length,
    ok: ok.map((u) => u.human_code),
    notObserved: notObserved.map((u) => ({ humanCode: u.human_code, missingConfirmed: u.current_disposition === 'MISSING' })),
    unexpected: unexpected.map((u) => u.human_code),
  };
}

export async function scanStocktakeUnit(db, sessionId, { code, actor }) {
  const session = await db.prepare('SELECT * FROM stocktake_sessions WHERE id = ?').bind(sessionId).first();
  if (!session) return { notFound: true };
  if (session.status !== 'OPEN') throw new ValidationError('Stocktake session is not open.');
  if (!code) throw new ValidationError('code is required.');

  const unit = await db
    .prepare('SELECT * FROM units WHERE human_code = ?1 OR internal_token = ?1 OR public_token = ?1')
    .bind(code)
    .first();
  if (!unit) return { notFound: true, reason: 'unit' };

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
    unexpected: !alreadyExpected || unit.batch_id !== session.batch_id,
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
