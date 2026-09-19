// Return Intake domain -- Director-approved (2026-09-13), Field Simulation
// Study P4-D. Mirrors the Stocktake/Shipment pattern (a session groups
// scans, a membership row records each unit) rather than the previous bare
// UNIT_RETURNED disposition flip, which had no session, no order/customer
// context, and no way to tell an expected return from a mystery item.
//
// Deliberately small per Director's instruction: no replacement_of_unit_id,
// no warranty/refund/claim/RMA. Just intake (receive + locate) and a QC
// decision. Receiving a unit here is an explicit operational action (the
// operator is asserting "this physically arrived"), which is why -- unlike
// Shipment packing -- it DOES move current_location_id: Director's own
// distinction is that this is a deliberate receipt, not a passive
// observation.
import { newInternalId, buildEventBatch } from '../db/d1.js';
import { ValidationError } from '../domain/validation.js';
import { getOrCreateLocation } from './catalog.js';

const QC_OUTCOMES = {
  AVAILABLE: { disposition: 'AVAILABLE' },
  DAMAGED: { condition: 'DAMAGED' },
  REJECTED: { disposition: 'REJECTED' },
};

export async function createReturnIntake(db, { customerId, reference, locationName }) {
  if (!reference) throw new ValidationError('reference is required.');
  const id = newInternalId();
  await db
    .prepare('INSERT INTO return_intakes (id, customer_id, reference) VALUES (?, ?, ?)')
    .bind(id, customerId ?? null, reference)
    .run();
  return { id, customerId: customerId ?? null, reference, status: 'OPEN', locationName: locationName || 'Returns Area' };
}

export async function scanUnitIntoReturnIntake(db, returnIntakeId, { code, actor, locationName }) {
  const intake = await db.prepare('SELECT * FROM return_intakes WHERE id = ?').bind(returnIntakeId).first();
  if (!intake) return { notFound: true };
  if (intake.status !== 'OPEN') throw new ValidationError('This return intake is not open.');
  if (!code) throw new ValidationError('code is required.');

  // Answers Question A from P4-D: enrich with order/customer/shipment
  // history at the moment of scan, the same information lookupUnit() now
  // carries -- a staff member doing return QC needs to see this without
  // cross-referencing the Pack page by hand.
  const { results: matches } = await db
    .prepare(
      `SELECT u.*, v.variant_label, p.name AS product_name,
              o.order_reference, c.id AS customer_id, c.name AS customer_name
       FROM units u
       JOIN production_batches pb ON pb.id = u.batch_id
       JOIN variants v ON v.id = pb.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN order_lines ol ON ol.id = pb.order_line_id
       LEFT JOIN orders o ON o.id = ol.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE u.human_code = ?1 OR u.internal_token = ?1 OR u.public_token = ?1`
    )
    .bind(code)
    .all();
  if (!matches.length) return { notFound: true, reason: 'unit' };
  if (matches.length > 1) {
    throw new ValidationError(
      `Code "${code}" matches more than one unit and isn't uniquely identifiable here -- scan the QR instead of typing the code.`
    );
  }
  const unit = matches[0];

  const already = await db
    .prepare('SELECT 1 FROM return_intake_units WHERE return_intake_id = ? AND unit_id = ?')
    .bind(returnIntakeId, unit.id)
    .first();
  if (already) {
    return { unitId: unit.id, humanCode: unit.human_code, alreadyScanned: true };
  }

  // One active intake per unit. A unit physically arrives once; letting it
  // sit in two open intakes would allow two QC decisions for the same object.
  // (A finished intake does not block a later return of the same unit.)
  const openElsewhere = await db
    .prepare(
      `SELECT ri.reference FROM return_intake_units riu
       JOIN return_intakes ri ON ri.id = riu.return_intake_id
       WHERE riu.unit_id = ? AND ri.status = 'OPEN' AND ri.id != ?`
    )
    .bind(unit.id, returnIntakeId)
    .first();
  if (openElsewhere) {
    throw new ValidationError(
      `Unit ${unit.human_code} sudah berada dalam pemulangan terbuka "${openElsewhere.reference}". Selesaikan atau tutup pemulangan itu dahulu.`
    );
  }

  // Answers Question B: "expected return or mystery item?" -- a unit that
  // was never actually dispatched has no business being returned. Not a
  // hard block (a walk-in / miscategorized item is still real and needs
  // handling), just a surfaced warning the operator can act on.
  const dispatched = await db
    .prepare("SELECT 1 FROM unit_events WHERE unit_id = ? AND event_type = 'UNIT_DISPATCHED' LIMIT 1")
    .bind(unit.id)
    .first();
  const expected = !!dispatched;

  // Field Simulation P5 (Customer Verification) fix: a return intake
  // already carries an optional customer_id (who called in to return
  // something), but nothing ever checked a scanned unit against it -- any
  // unit could be accepted into any customer's intake with no signal at
  // all. Same "warn, don't block" philosophy as expected/unexpected: a
  // legitimate reason to override still exists (staff correcting a
  // mislabeled intake, a genuinely shared/company account), so this
  // surfaces the mismatch rather than refusing the scan outright.
  const customerMismatch = !!(intake.customer_id && unit.customer_id && unit.customer_id !== intake.customer_id);

  // Field Simulation Pass 3 Scenario 5 fix: two staff working the same
  // unit through two different domains with no cross-check at all. Found
  // live: Ali packs a unit into an OPEN shipment (not yet dispatched);
  // Abu, unaware, scans the same unit into a Return Intake moments later.
  // Before this fix the return intake accepted it silently -- the unit
  // ended up physically relocated to the Returns Area while STILL an
  // active member of the open shipment, which would happily dispatch it
  // later with no idea it never left the building the way the shipment
  // record assumes. Same "warn, don't block" philosophy as
  // expected/customerMismatch above: a legitimate reason to override can
  // exist (the shipment itself may be about to be corrected), so this
  // surfaces the conflict rather than refusing the scan -- the operator on
  // THIS screen may not even be the one who can fix the other side.
  const { results: activeShipments } = await db
    .prepare(
      `SELECT s.reference FROM shipment_units su
       JOIN shipments s ON s.id = su.shipment_id
       WHERE su.unit_id = ? AND s.status != 'DISPATCHED'`
    )
    .bind(unit.id)
    .all();
  const activeShipmentConflict = activeShipments.length ? activeShipments[0].reference : null;

  // Answers Question C: receiving is an explicit act of physically moving
  // the unit, not a passive observation -- so this DOES change location,
  // unlike Shipment packing.
  const location = await getOrCreateLocation(db, locationName || 'Returns Area');
  const eventId = newInternalId();
  const statements = buildEventBatch(db, {
    eventId,
    unitId: unit.id,
    eventType: 'RETURN_RECEIVED',
    payload: { returnIntakeId, reference: intake.reference, expected, customerMismatch, activeShipmentConflict },
    actor: actor ?? 'izzat',
    locationId: location.id,
  });
  // The membership row is written first, guarded in SQL so two devices
  // scanning the same unit into two intakes at once cannot both succeed; the
  // check above only gives the friendly message for the common case.
  const guarded = await db
    .prepare(
      `INSERT INTO return_intake_units (return_intake_id, unit_id, actor, expected, customer_mismatch, active_shipment_conflict)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE NOT EXISTS (
         SELECT 1 FROM return_intake_units riu JOIN return_intakes ri ON ri.id = riu.return_intake_id
         WHERE riu.unit_id = ?2 AND ri.status = 'OPEN' AND ri.id != ?1
       )`
    )
    .bind(returnIntakeId, unit.id, actor ?? null, expected ? 1 : 0, customerMismatch ? 1 : 0, activeShipmentConflict)
    .run();
  if (!guarded.meta || guarded.meta.changes === 0) {
    throw new ValidationError(`Unit ${unit.human_code} baru sahaja dimasukkan ke pemulangan terbuka lain. Selesaikan pemulangan itu dahulu.`);
  }
  try {
    await db.batch(statements);
  } catch (e) {
    await db.prepare('DELETE FROM return_intake_units WHERE return_intake_id = ? AND unit_id = ?').bind(returnIntakeId, unit.id).run();
    throw e;
  }

  return {
    unitId: unit.id,
    humanCode: unit.human_code,
    product: `${unit.product_name} · ${unit.variant_label}`,
    orderReference: unit.order_reference,
    customerName: unit.customer_name,
    expected,
    customerMismatch,
    activeShipmentConflict,
    locationName: location.name,
    alreadyScanned: false,
  };
}

// QC decision is deliberately separate from the scan -- receiving a unit
// physically and deciding what to do with it are two different moments
// (the unit might sit in the Returns Area for days before anyone
// inspects it), matching the same principle already applied to
// Stocktake/Shipment: observation now, decision later.
export async function decideReturnQc(db, returnIntakeId, unitId, { outcome, actor, reason }) {
  const row = await db
    .prepare('SELECT * FROM return_intake_units WHERE return_intake_id = ? AND unit_id = ?')
    .bind(returnIntakeId, unitId)
    .first();
  if (!row) return { notFound: true };
  const change = QC_OUTCOMES[outcome];
  if (!change) throw new ValidationError(`outcome must be one of: ${Object.keys(QC_OUTCOMES).join(', ')}.`);

  // Only the unit's most recent intake may decide it: if the unit has been
  // received again in a later intake, this older intake's decision is stale.
  const newer = await db
    .prepare(
      `SELECT ri.reference FROM return_intake_units riu
       JOIN return_intakes ri ON ri.id = riu.return_intake_id
       WHERE riu.unit_id = ?1 AND riu.rowid > (
         SELECT rowid FROM return_intake_units WHERE return_intake_id = ?2 AND unit_id = ?1)
       LIMIT 1`
    )
    .bind(unitId, returnIntakeId)
    .first();
  if (newer) {
    throw new ValidationError(
      `Unit ini sudah diterima semula dalam pemulangan "${newer.reference}". Keputusan QC mesti dibuat di sana, bukan di pemulangan lama.`
    );
  }

  // One final decision per intake. Repeating the same outcome is a no-op;
  // changing it is allowed but must carry a reason, and the event records both
  // the old and the new outcome so the trail shows the change.
  if (row.qc_outcome === outcome) return { unitId, outcome, unchanged: true };
  const isChange = !!row.qc_outcome;
  if (isChange && !String(reason || '').trim()) {
    throw new ValidationError(
      `Unit ini sudah diputuskan "${row.qc_outcome}". Untuk menukar kepada "${outcome}", nyatakan sebab (reason).`
    );
  }

  const eventId = newInternalId();
  const statements = buildEventBatch(db, {
    eventId,
    unitId,
    eventType: 'RETURN_QC_DECIDED',
    payload: isChange
      ? { returnIntakeId, outcome, previousOutcome: row.qc_outcome, changed: true, reason: String(reason).trim() }
      : { returnIntakeId, outcome },
    actor: actor ?? 'izzat',
    // Changing a decision must not leave the old one's leftovers behind:
    // a unit re-decided from DAMAGED loses the damaged condition, and one
    // re-decided to DAMAGED from REJECTED is no longer rejected.
    disposition: change.disposition ?? (isChange && row.qc_outcome === 'REJECTED' ? 'AVAILABLE' : undefined),
    condition: change.condition ?? (isChange && row.qc_outcome === 'DAMAGED' ? null : undefined),
  });
  statements.push(
    db
      .prepare(
        "UPDATE return_intake_units SET qc_outcome = ?, qc_decided_at = datetime('now') WHERE return_intake_id = ? AND unit_id = ?"
      )
      .bind(outcome, returnIntakeId, unitId)
  );
  await db.batch(statements);
  return { unitId, outcome, ...(isChange ? { changedFrom: row.qc_outcome } : {}) };
}

export async function getReturnIntake(db, id) {
  const intake = await db
    .prepare(
      `SELECT ri.*, c.name AS customer_name
       FROM return_intakes ri
       LEFT JOIN customers c ON c.id = ri.customer_id
       WHERE ri.id = ?`
    )
    .bind(id)
    .first();
  if (!intake) return null;

  const { results: units } = await db
    .prepare(
      `SELECT riu.unit_id, riu.expected, riu.customer_mismatch, riu.active_shipment_conflict, riu.qc_outcome, u.human_code
       FROM return_intake_units riu
       JOIN units u ON u.id = riu.unit_id
       WHERE riu.return_intake_id = ?
       ORDER BY riu.scanned_at`
    )
    .bind(id)
    .all();

  return { ...intake, units };
}

export async function listReturnIntakes(db) {
  const { results } = await db
    .prepare(
      `SELECT ri.id, ri.reference, ri.status, ri.created_at, c.name AS customer_name,
              (SELECT COUNT(*) FROM return_intake_units riu WHERE riu.return_intake_id = ri.id) AS scanned_count,
              (SELECT COUNT(*) FROM return_intake_units riu WHERE riu.return_intake_id = ri.id AND riu.qc_outcome IS NULL) AS pending_qc_count
       FROM return_intakes ri
       LEFT JOIN customers c ON c.id = ri.customer_id
       ORDER BY ri.created_at DESC`
    )
    .all();
  return results;
}

export async function closeReturnIntake(db, id) {
  const intake = await db.prepare('SELECT * FROM return_intakes WHERE id = ?').bind(id).first();
  if (!intake) return { notFound: true };
  if (intake.status !== 'OPEN') throw new ValidationError('This return intake is not open.');

  await db
    .prepare("UPDATE return_intakes SET status = 'CLOSED', closed_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();
  return { id, status: 'CLOSED' };
}
