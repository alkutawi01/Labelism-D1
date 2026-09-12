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
