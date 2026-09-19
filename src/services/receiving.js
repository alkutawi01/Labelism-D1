// Receiving/reconciliation + Unit registration -- keeps the same three-way
// separation (planned vs observed vs accepted) proven in the spike and
// required by CLAUDE.md/memory for this domain.
import { newInternalId, newOpaqueToken } from '../db/d1.js';
import { ValidationError, requireInt } from '../domain/validation.js';

export async function createReceipt(db, batchId, { observedQuantity, acceptedQuantity, rejectedQuantity, rejectionReason, notes }) {
  const batch = await db.prepare('SELECT * FROM production_batches WHERE id = ?').bind(batchId).first();
  if (!batch) return { notFound: true };

  requireInt(observedQuantity, 'observedQuantity');
  const accepted = acceptedQuantity ?? observedQuantity;
  const rejected = rejectedQuantity ?? 0;
  requireInt(accepted, 'acceptedQuantity');
  requireInt(rejected, 'rejectedQuantity');
  if (accepted + rejected > observedQuantity) {
    throw new ValidationError(
      `Accepted (${accepted}) + rejected (${rejected}) cannot exceed observed (${observedQuantity}).`
    );
  }

  const id = newInternalId();
  await db
    .prepare(
      `INSERT INTO batch_receipts (id, batch_id, actual_quantity, accepted_quantity, rejected_quantity, rejection_reason, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, batchId, observedQuantity, accepted, rejected, rejectionReason ?? null, notes ?? null)
    .run();

  return {
    id,
    batchId,
    observedQuantity,
    acceptedQuantity: accepted,
    rejectedQuantity: rejected,
    plannedQuantity: batch.planned_quantity,
    variance: observedQuantity - batch.planned_quantity,
  };
}

// Izzat's correction (2026-09-14): Labelism was drifting into an
// inventory/ERP shape (Receiving confirms physical arrival BEFORE any
// Unit/label can exist) that doesn't match his actual business -- a
// custom-garment factory whose real problem is overproduction/
// underproduction/wrong-size, caught only when the customer complains.
// His model: an Order Line is a production OBLIGATION, so the label set
// should be generated directly from quantity_ordered ("if there are 10
// labels, all 10 must be used -- 9 used means 1 unit was never made; not
// enough labels means there's an extra unit"), handed to production
// immediately, with the packing scan as the actual reconciliation point
// -- not a separate physical-count confirmation gate beforehand.
// Receiving/batch_receipts stays available for whoever still wants that
// reconciliation step, but is no longer mandatory before units can exist.
// Mirrors registerUnits()'s unit-creation shape exactly, just keyed off
// the batch's planned_quantity instead of a receipt's accepted_quantity,
// and batch_receipt_id stays null (schema already allows this).
export function buildUnitStatementsForBatch(db, batchId, plannedQuantity, existingInBatch = 0, unitNames = [], actor = 'system') {
  const toCreate = plannedQuantity - existingInBatch;
  // Invariant, enforced here because every unit-creating path funnels through
  // this function: more recipient names than units to create is never valid.
  // Silently dropping the extra names would hide a data-entry mistake.
  if (Array.isArray(unitNames) && unitNames.length > Math.max(toCreate, 0)) {
    throw new ValidationError(
      `There are ${unitNames.length} label texts but only ${Math.max(toCreate, 0)} units will be generated. Check the list.`
    );
  }
  if (toCreate <= 0) return { createdUnits: [], statements: [] };

  const createdUnits = [];
  const statements = [];
  for (let i = 0; i < toCreate; i++) {
    const seqNo = existingInBatch + i + 1;
    const unitId = newInternalId();
    const humanCode = String(seqNo).padStart(6, '0');
    const internalToken = newOpaqueToken();
    const publicToken = newOpaqueToken();
    const recipientName = unitNames[i] ? String(unitNames[i]).trim() : null;

    statements.push(
      db
        .prepare(
          `INSERT INTO units (id, batch_id, human_code, internal_token, public_token, current_disposition, recipient_name)
           VALUES (?, ?, ?, ?, ?, 'AVAILABLE', ?)`
        )
        .bind(unitId, batchId, humanCode, internalToken, publicToken, recipientName)
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO unit_events (id, unit_id, seq, event_type, payload, actor)
           VALUES (?, ?, 1, 'UNIT_REGISTERED', ?, ?)`
        )
        .bind(newInternalId(), unitId, JSON.stringify({ source: 'order_obligation', recipientName }), actor ?? 'system')
    );
    statements.push(db.prepare('UPDATE units SET last_event_seq = 1 WHERE id = ?').bind(unitId));

    createdUnits.push({ id: unitId, humanCode, recipientName });
  }
  return { createdUnits, statements };
}

export async function generateUnitsForBatch(db, batchId, actor, unitNames = []) {
  const batch = await db.prepare('SELECT * FROM production_batches WHERE id = ?').bind(batchId).first();
  if (!batch) return { notFound: true };

  let names = Array.isArray(unitNames) && unitNames.length ? unitNames : [];
  if (!names.length && batch.notes) {
    try {
      const parsed = JSON.parse(batch.notes);
      if (Array.isArray(parsed.plannedUnitNames)) names = parsed.plannedUnitNames;
    } catch {}
  }

  const existingRow = await db.prepare('SELECT COUNT(*) AS n FROM units WHERE batch_id = ?').bind(batchId).first();
  const existingInBatch = Number(existingRow.n);
  const { createdUnits, statements } = buildUnitStatementsForBatch(db, batchId, batch.planned_quantity, existingInBatch, names, actor);

  if (!statements.length) {
    return { created: 0, alreadyRegistered: existingInBatch, message: 'All units for this batch are already generated.' };
  }

  await db.batch(statements);
  return { created: createdUnits.length, units: createdUnits };
}

export async function registerUnits(db, receiptId, actor) {
  const receipt = await db.prepare('SELECT * FROM batch_receipts WHERE id = ?').bind(receiptId).first();
  if (!receipt) return { notFound: true };

  const alreadyRow = await db
    .prepare('SELECT COUNT(*) AS n FROM units WHERE batch_receipt_id = ?')
    .bind(receiptId)
    .first();
  const already = Number(alreadyRow.n);
  const toCreate = receipt.accepted_quantity - already;
  if (toCreate <= 0) {
    return { created: 0, alreadyRegistered: already, message: 'All units for this receipt are already registered.' };
  }

  const existingRow = await db
    .prepare('SELECT COUNT(*) AS n FROM units WHERE batch_id = ?')
    .bind(receipt.batch_id)
    .first();
  const existingInBatch = Number(existingRow.n);

  const created = [];
  const statements = [];
  for (let i = 0; i < toCreate; i++) {
    const seqNo = existingInBatch + i + 1;
    const unitId = newInternalId();
    const humanCode = String(seqNo).padStart(6, '0');
    const internalToken = newOpaqueToken();
    const publicToken = newOpaqueToken();

    statements.push(
      db
        .prepare(
          `INSERT INTO units (id, batch_id, batch_receipt_id, human_code, internal_token, public_token, current_disposition)
           VALUES (?, ?, ?, ?, ?, ?, 'AVAILABLE')`
        )
        .bind(unitId, receipt.batch_id, receipt.id, humanCode, internalToken, publicToken)
    );
    // Each unit starts its own event log at seq 1 -- no cross-unit ordering
    // dependency, so a plain insert (not the MAX(seq) pattern) is correct
    // and safe here regardless of concurrency model.
    statements.push(
      db
        .prepare(
          `INSERT INTO unit_events (id, unit_id, seq, event_type, payload, actor)
           VALUES (?, ?, 1, 'UNIT_REGISTERED', ?, ?)`
        )
        .bind(newInternalId(), unitId, JSON.stringify({ receiptId: receipt.id }), actor ?? 'system')
    );
    statements.push(
      db.prepare('UPDATE units SET last_event_seq = 1 WHERE id = ?').bind(unitId)
    );

    created.push({ id: unitId, humanCode });
  }

  await db.batch(statements);
  return { created: created.length, units: created };
}
