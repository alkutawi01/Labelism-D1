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
import { newInternalId, buildEventBatch } from '../db/d1.js';
import { ValidationError } from '../domain/validation.js';
import { getOrCreateLocation } from './catalog.js';

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
    .prepare(
      `SELECT u.*, v.variant_label, p.name AS product_name
       FROM units u
       JOIN production_batches pb ON pb.id = u.batch_id
       JOIN variants v ON v.id = pb.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE u.human_code = ?1 OR u.internal_token = ?1 OR u.public_token = ?1`
    )
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

  // Field Simulation P3 (Shipment Split) fix: a unit can only be a member
  // of ONE shipment at a time, full stop -- checked across ALL shipments,
  // not just this one. Without this, the same physical unit could be
  // scanned into a second partial shipment after already being packed
  // (and even after the first shipment closed), silently double-counting
  // it toward the order's fulfilment. This is a hard error, distinct from
  // "alreadyScanned" (which only means re-scanning into the SAME shipment
  // is a harmless no-op).
  const { results: memberships } = await db
    .prepare(
      `SELECT su.shipment_id, s.reference FROM shipment_units su
       JOIN shipments s ON s.id = su.shipment_id
       WHERE su.unit_id = ?`
    )
    .bind(unit.id)
    .all();
  const sameShipment = memberships.find((m) => m.shipment_id === shipmentId);
  const otherShipment = memberships.find((m) => m.shipment_id !== shipmentId);
  if (otherShipment) {
    throw new ValidationError(`This unit is already packed in Shipment "${otherShipment.reference}" -- a unit can only belong to one shipment.`);
  }

  // Visual-check aid (Field Simulation P2): pack.html shows this alongside
  // the human code so an operator can catch a physically mislabeled item
  // (right order, wrong variant/size) at the moment of scanning -- the
  // system can't verify a physical label matches its unit record, but it
  // can surface enough for a human to notice a mismatch.
  const productLabel = `${unit.product_name} · ${unit.variant_label}`;

  if (sameShipment) {
    return { unitId: unit.id, humanCode: unit.human_code, product: productLabel, alreadyScanned: true };
  }

  await db
    .prepare('INSERT INTO shipment_units (shipment_id, unit_id, actor) VALUES (?, ?, ?)')
    .bind(shipmentId, unit.id, actor ?? null)
    .run();

  return { unitId: unit.id, humanCode: unit.human_code, product: productLabel, alreadyScanned: false };
}

export async function getShipment(db, id) {
  const shipment = await db
    .prepare(
      `SELECT s.*, ol.description, ol.quantity_ordered, o.order_reference, c.name AS customer_name,
              l.name AS destination_name
       FROM shipments s
       JOIN order_lines ol ON ol.id = s.order_line_id
       JOIN orders o ON o.id = ol.order_id
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN locations l ON l.id = s.destination_location_id
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

// Field Simulation P4 (Return & Replacement) build: the domain design from
// Phase A/B always described dispatch as "a separate, later action taken
// when the shipment is actually sent out" (UNIT_DISPATCHED event + a
// location change, deliberately NOT a disposition -- see the file header)
// but no action anywhere in the app ever actually created it. Units sat as
// AVAILABLE @ Warehouse forever, even after a shipment closed -- which
// meant P4's own scenarios ("100 shipped", "customer received it") had no
// real state to build on. This fills that gap; it does not change the
// Director-approved design, only implements what was already specified.
export async function dispatchShipment(db, shipmentId, { locationName, actor }) {
  const shipment = await db.prepare('SELECT * FROM shipments WHERE id = ?').bind(shipmentId).first();
  if (!shipment) return { notFound: true };
  if (shipment.status !== 'CLOSED') {
    throw new ValidationError('Only a closed shipment can be dispatched -- close it first once packing is complete.');
  }
  if (!locationName) throw new ValidationError('A destination location is required.');

  const location = await getOrCreateLocation(db, locationName);

  const { results: units } = await db
    .prepare('SELECT unit_id FROM shipment_units WHERE shipment_id = ?')
    .bind(shipmentId)
    .all();

  const statements = [];
  for (const { unit_id } of units) {
    statements.push(
      ...buildEventBatch(db, {
        eventId: newInternalId(),
        unitId: unit_id,
        eventType: 'UNIT_DISPATCHED',
        payload: { shipmentId, reference: shipment.reference },
        actor: actor ?? 'izzat',
        locationId: location.id,
      })
    );
  }
  statements.push(
    db
      .prepare("UPDATE shipments SET status = 'DISPATCHED', destination_location_id = ? WHERE id = ?")
      .bind(location.id, shipmentId)
  );

  await db.batch(statements);
  return { id: shipmentId, status: 'DISPATCHED', locationName: location.name, dispatchedCount: units.length };
}

export async function listShipmentsForOrderLine(db, orderLineId) {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.reference, s.planned_quantity, s.status, l.name AS destination_name,
              (SELECT COUNT(*) FROM shipment_units su WHERE su.shipment_id = s.id) AS scanned_count
       FROM shipments s
       LEFT JOIN locations l ON l.id = s.destination_location_id
       WHERE s.order_line_id = ? ORDER BY s.created_at`
    )
    .bind(orderLineId)
    .all();
  return results;
}
