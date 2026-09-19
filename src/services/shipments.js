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
  // A shipment made for a print run (batch) only takes labels printed in that
  // run -- otherwise packing Batch 2 could quietly consume a Batch 1 unit.
  if (shipment.print_run_id && unit.print_run_id !== shipment.print_run_id) {
    return { ok: false, reason: 'Unit ini bukan dalam batch cetakan untuk sesi packing ini.' };
  }
  // Core Production Simulation Priority 6 (F6-001), Director-approved
  // 2026-09-14: confirmed live that a unit whose label was NEVER confirmed
  // attached (still sitting on Print Labels as "awaiting attachment") could
  // still be scanned into a shipment and counted as packed -- silently
  // bypassing the entire P2 attachment-verification discipline the rest of
  // Labelism is built around. A label that was never confirmed attached is
  // not known to be on any physical garment yet, so it cannot fulfill a
  // shipment.
  if (!unit.label_confirmed_at) {
    return {
      ok: false,
      reason: `Unit ${unit.human_code}'s label has not been confirmed attached yet -- attach and confirm it on Print Labels before packing.`,
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
  //
  // Field Simulation Pass 3 Scenario 4 fix: that block was written before
  // Return Intake existed, and only ever meant "don't let a unit be an
  // ACTIVE member of two shipments at once." A shipment reaching
  // DISPATCHED means the unit has physically left the building -- that
  // membership is now a closed historical fact, not a hold. Without this
  // exclusion, any unit that was ever dispatched and later returned
  // (RETURN_RECEIVED + QC AVAILABLE) could never be packed into a new
  // shipment again, permanently, even though it's legitimately back in
  // inventory -- confirmed live before fixing. Excluding DISPATCHED here
  // does NOT touch Shipment Split's original guarantee: OPEN and CLOSED
  // (not-yet-dispatched) memberships still block, since those units
  // haven't left yet and really are still spoken for.
  const { results: memberships } = await db
    .prepare(
      `SELECT su.shipment_id, s.reference FROM shipment_units su
       JOIN shipments s ON s.id = su.shipment_id
       WHERE su.unit_id = ? AND s.status != 'DISPATCHED'`
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

  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM shipment_units WHERE shipment_id = ?').bind(shipmentId).first();
  const currentScanned = Number(countRow.n);
  if (currentScanned >= shipment.planned_quantity) {
    throw new ValidationError(`Cannot pack unit: shipment planned capacity of ${shipment.planned_quantity} has already been reached.`);
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
//
// Core Production Simulation, Priority 1 (production shortfall) -- Izzat's
// original problem: 10 labels generated, only 8 garments finished, and the
// company only ever found out when the customer complained. Confirmed live
// before this fix: closing a shipment with a shortfall returned only
// `missing: 2` -- a bare count, with no way to tell WHICH two of the ten
// units never showed up without cross-referencing the batch's full unit
// list by hand. Now that units/labels exist immediately from the ordered
// quantity (not gated behind Receiving), this is the actual moment Izzat
// needs named, actionable output, not just a number. Named units are
// scoped to this order line's batches, excluding units already committed
// to a DIFFERENT shipment for the same line, so a legitimate partial
// shipment (Priority 4: 500 of 1000 shipped now, 500 later) doesn't get
// its still-to-ship units wrongly reported as "missing" here.
export async function closeShipment(db, id, actor) {
  const shipment = await db.prepare('SELECT * FROM shipments WHERE id = ?').bind(id).first();
  if (!shipment) return { notFound: true };
  if (shipment.status !== 'OPEN') throw new ValidationError('This shipment is not open.');

  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM shipment_units WHERE shipment_id = ?').bind(id).first();
  const packedCount = Number(countRow.n);
  const missing = Math.max(0, shipment.planned_quantity - packedCount);

  let missingUnits = [];
  let missingUnitsUncertain = false;
  if (missing > 0) {
    // Core Production Simulation Priority 6 (F6-001), Director-approved
    // 2026-09-14: confirmed live that closing a partial shipment while
    // OTHER units for the same order line were still legitimately awaiting
    // attachment (production not finished yet, a normal and expected state
    // visible on Print Labels) reported those units as "MISSING" alongside
    // a genuinely unaccounted-for one. "Missing" should mean "confirmed
    // attached to a real garment, but never came back" -- a unit that was
    // never confirmed attached isn't missing, it just isn't produced yet,
    // and label_confirmed_at IS NOT NULL is exactly the same test the
    // shipment-scan gate above now enforces before packing.
    const { results } = await db
      .prepare(
        `SELECT u.human_code FROM units u
         JOIN production_batches pb ON pb.id = u.batch_id
         WHERE pb.order_line_id = ?
           AND u.label_confirmed_at IS NOT NULL
           AND u.id NOT IN (SELECT unit_id FROM shipment_units WHERE shipment_id = ?)
           AND u.id NOT IN (
             SELECT su.unit_id FROM shipment_units su
             JOIN shipments s ON s.id = su.shipment_id
             WHERE s.order_line_id = ? AND s.id != ?
           )
         ORDER BY u.human_code`
      )
      .bind(shipment.order_line_id, id, shipment.order_line_id, id)
      .all();
    // Gate B readiness fix (2026-09-15), found live during the dry-run:
    // a shipment's plannedQuantity is just a headcount, not a pre-committed
    // list of which specific units belong to it -- so when MORE attached-
    // and-unshipped units exist than are actually missing (a real partial
    // shipment: 5 planned now out of 15 still on hand, meant for later
    // batches), the query above can't know which specific unit(s) are the
    // "real" missing ones out of that larger pool. Naming all of them
    // anyway (the previous behaviour) told the operator e.g. "MISSING 1 --
    // unit(s) 000020...000030" for an 11-unit list when only 1 was truly
    // unaccounted for -- actively misleading, exactly the kind of "system
    // tells people something that isn't true" gap Gate B exists to catch.
    // Only name specific units when the candidate pool size exactly equals
    // the missing count -- i.e. there is no other unit this order line
    // could be legitimately holding back, so by elimination every
    // candidate really is missing. Otherwise, report the count honestly
    // and say why specific units can't be named yet.
    if (results.length === missing) {
      missingUnits = results.map((r) => r.human_code);
    } else {
      missingUnitsUncertain = true;
    }
  }

  await db
    .prepare("UPDATE shipments SET status = 'CLOSED', closed_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();

  return {
    id,
    status: 'CLOSED',
    plannedQuantity: shipment.planned_quantity,
    packedCount,
    missing,
    missingUnits,
    missingUnitsUncertain,
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
