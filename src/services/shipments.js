// Shipment domain -- Director-approved (2026-09-13), built in response to
// Field Simulation Study P1 (Pick & Pack) confirming Stocktake is the
// wrong abstraction for packing verification: Stocktake answers "is what's
// expected here actually here" (inventory presence); a Shipment answers
// "is this unit fulfilling THIS promise to THIS customer" (order
// fulfillment). Scanning into a shipment deliberately never touches
// disposition or current_location_id -- packing is not the same event as
// physically leaving the building (that's a separate, later dispatch
// action using the existing UNIT_DISPATCHED event).
//
// v1 limit (Director-mandated, revisit only if a real case proves it
// wrong): one shipment fulfills exactly one order_line. No shipment_lines
// table spanning multiple order lines, no Allocation table.
import { newInternalId } from '../db/d1.js';
import { ValidationError } from '../domain/validation.js';

export async function createShipment(db, { orderLineId, reference, plannedQuantity }) {
  if (!orderLineId || !reference) throw new ValidationError('orderLineId and reference are required.');
  if (!Number.isInteger(plannedQuantity) || plannedQuantity < 1) {
    throw new ValidationError('plannedQuantity must be a whole number >= 1.');
  }
  const line = await db.prepare('SELECT id FROM order_lines WHERE id = ?').bind(orderLineId).first();
  if (!line) return { notFound: true };

  const id = newInternalId();
  await db
    .prepare('INSERT INTO shipments (id, order_line_id, reference, planned_quantity) VALUES (?, ?, ?, ?)')
    .bind(id, orderLineId, reference, plannedQuantity)
    .run();
  return { id, orderLineId, reference, plannedQuantity, status: 'OPEN' };
}

// The core Error-A fix: a unit can only fulfill a shipment for the SAME
// order_line it was actually produced for. Returns { ok: true } or
// { ok: false, reason, unit info } so the caller can build a specific
// message naming the real order/customer instead of a bare "unexpected".
async function canUnitFulfillShipment(db, unit, shipment) {
  const batch = await db
    .prepare(
      `SELECT pb.order_line_id, ol.order_id, o.order_reference, o.customer_id, c.name AS customer_name
       FROM production_batches pb
       LEFT JOIN order_lines ol ON ol.id = pb.order_line_id
       LEFT JOIN orders o ON o.id = ol.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE pb.id = ?`
    )
    .bind(unit.batch_id)
    .first();

  if (!batch || batch.order_line_id !== shipment.order_line_id) {
    return {
      ok: false,
      reason: batch && batch.order_reference
        ? `This unit belongs to order "${batch.order_reference}" (${batch.customer_name}), not this shipment's order line.`
        : 'This unit is not linked to any order line, so it cannot fulfill this shipment.',
    };
  }
  return { ok: true };
}

export async function scanUnitIntoShipment(db, shipmentId, { code, actor }) {
  const shipment = await db.prepare('SELECT * FROM shipments WHERE id = ?').bind(shipmentId).first();
  if (!shipment) return { notFound: true };
  if (shipment.status !== 'OPEN') throw new ValidationError('This shipment is not open.');
  if (!code) throw new ValidationError('code is required.');

  const { results: matches } = await db
    .prepare('SELECT * FROM units WHERE human_code = ?1 OR internal_token = ?1 OR public_token = ?1')
    .bind(code)
    .all();
  if (!matches.length) return { notFound: true, reason: 'unit' };
  let unit = matches[0];
  if (matches.length > 1) {
    // Prefer whichever match actually fulfills this shipment's order line --
    // resolves the common case (typed code for the right item) without
    // guessing across genuinely unrelated units.
    const checks = await Promise.all(matches.map((m) => canUnitFulfillShipment(db, m, shipment)));
    const fulfilling = matches.filter((_, i) => checks[i].ok);
    if (fulfilling.length === 1) {
      unit = fulfilling[0];
    } else {
      throw new ValidationError(
        `Code "${code}" matches more than one unit and isn't uniquely identifiable here -- scan the QR instead of typing the code.`
      );
    }
  }

  const fulfillCheck = await canUnitFulfillShipment(db, unit, shipment);
  if (!fulfillCheck.ok) {
    throw new ValidationError(fulfillCheck.reason);
  }

  const already = await db
    .prepare('SELECT 1 FROM shipment_units WHERE shipment_id = ? AND unit_id = ?')
    .bind(shipmentId, unit.id)
    .first();
  if (already) {
    return { unitId: unit.id, humanCode: unit.human_code, alreadyScanned: true };
  }

  await db
    .prepare('INSERT INTO shipment_units (shipment_id, unit_id, actor) VALUES (?, ?, ?)')
    .bind(shipmentId, unit.id, actor ?? null)
    .run();

  return { unitId: unit.id, humanCode: unit.human_code, alreadyScanned: false };
}

export async function getShipment(db, id) {
  const shipment = await db
    .prepare(
      `SELECT s.*, ol.description, ol.quantity_ordered, o.order_reference, c.name AS customer_name
       FROM shipments s
       JOIN order_lines ol ON ol.id = s.order_line_id
       JOIN orders o ON o.id = ol.order_id
       JOIN customers c ON c.id = o.customer_id
       WHERE s.id = ?`
    )
    .bind(id)
    .first();
  if (!shipment) return null;

  const { results: scanned } = await db
    .prepare(
      `SELECT u.id, u.human_code FROM shipment_units su
       JOIN units u ON u.id = su.unit_id WHERE su.shipment_id = ?`
    )
    .bind(id)
    .all();

  return { ...shipment, scannedCount: scanned.length, scanned };
}

// Closing returns the reconciliation summary directly -- the Error-C fix.
// A caller that only looks at this response (not a separate GET) still
// sees whether anything is missing.
export async function closeShipment(db, id, actor) {
  const shipment = await db.prepare('SELECT * FROM shipments WHERE id = ?').bind(id).first();
  if (!shipment) return { notFound: true };
  if (shipment.status !== 'OPEN') throw new ValidationError('This shipment is not open.');

  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM shipment_units WHERE shipment_id = ?').bind(id).first();
  const packedCount = Number(countRow.n);

  await db
    .prepare("UPDATE shipments SET status = 'CLOSED', closed_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();

  return {
    id,
    status: 'CLOSED',
    plannedQuantity: shipment.planned_quantity,
    packedCount,
    missing: Math.max(0, shipment.planned_quantity - packedCount),
  };
}

export async function listShipmentsForOrderLine(db, orderLineId) {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.reference, s.planned_quantity, s.status,
              (SELECT COUNT(*) FROM shipment_units su WHERE su.shipment_id = s.id) AS scanned_count
       FROM shipments s WHERE s.order_line_id = ? ORDER BY s.created_at`
    )
    .bind(orderLineId)
    .all();
  return results;
}
