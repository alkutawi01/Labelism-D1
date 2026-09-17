// Customer -> Order -> OrderLine -- Domain Model Revision Pass v1
// (Director-approved 2026-09-13). Sits alongside Product/Variant/
// ProductionBatch/Unit, does not replace it. The golden rule from the
// original model is preserved here: a Customer/Order/OrderLine is intent
// only -- it never creates Units. Only Receiving/register-units does that
// (see services/receiving.js). An OrderLine is fulfilled by zero or more
// ProductionBatches (production_batches.order_line_id), which is how a
// single order can be produced across multiple staged batches.
import { newInternalId } from '../db/d1.js';
import { ValidationError } from '../domain/validation.js';
import { getOrCreateProduct, getOrCreateVariant, addProductDimensions, createProductionBatch, nextBatchNumber } from './catalog.js';
import { generateUnitsForBatch } from './receiving.js';

export async function createCustomer(db, { name, contactInfo }) {
  if (!name) throw new ValidationError('Customer name is required.');
  const id = newInternalId();
  await db
    .prepare('INSERT INTO customers (id, name, contact_info) VALUES (?, ?, ?)')
    .bind(id, name, contactInfo ?? null)
    .run();
  return { id, name, contactInfo: contactInfo ?? null };
}

export async function getOrCreateCustomer(db, { id, name, contactInfo }) {
  if (id) {
    const existing = await db.prepare('SELECT id, name FROM customers WHERE id = ?').bind(id).first();
    if (existing) return existing;
  }
  if (!name || !String(name).trim()) throw new ValidationError('Customer name is required.');
  const trimmed = String(name).trim();
  const existingByName = await db.prepare('SELECT id, name FROM customers WHERE LOWER(TRIM(name)) = LOWER(?)').bind(trimmed).first();
  if (existingByName) return existingByName;
  return await createCustomer(db, { name: trimmed, contactInfo });
}

export async function listCustomers(db) {
  const { results } = await db.prepare('SELECT * FROM customers ORDER BY name').all();
  return results;
}

export async function createOrder(db, { customerId, orderReference, orderDate, dueDate, notes }) {
  if (!customerId || !orderReference) {
    throw new ValidationError('customerId and orderReference are required.');
  }
  const id = newInternalId();
  await db
    .prepare(
      `INSERT INTO orders (id, customer_id, order_reference, order_date, due_date, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, customerId, orderReference, orderDate ?? null, dueDate ?? null, notes ?? null)
    .run();
  return { id, customerId, orderReference, orderDate: orderDate ?? null, dueDate: dueDate ?? null };
}

// Lists orders with their customer name and lines (each line resolved to
// its variant's product/variant label when one is set, since a line's
// variant_id is optional -- an order can be taken before the exact
// variant is pinned down).
export async function listOrders(db) {
  const { results: orders } = await db
    .prepare(
      `SELECT o.id, o.customer_id, o.order_reference, o.order_date, o.due_date, o.notes, c.name AS customer_name
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       ORDER BY o.created_at DESC`
    )
    .all();

  const { results: lines } = await db
    .prepare(
      `SELECT ol.id, ol.order_id, ol.quantity_ordered, ol.description, ol.variant_id, ol.notes,
              v.variant_label, p.name AS product_name
       FROM order_lines ol
       LEFT JOIN variants v ON v.id = ol.variant_id
       LEFT JOIN products p ON p.id = v.product_id
       ORDER BY ol.created_at`
    )
    .all();

  const linesByOrder = new Map();
  for (const l of lines) {
    if (!linesByOrder.has(l.order_id)) linesByOrder.set(l.order_id, []);
    linesByOrder.get(l.order_id).push(l);
  }

  return orders.map((o) => ({ ...o, lines: linesByOrder.get(o.id) ?? [] }));
}

export async function createOrderLine(db, { orderId, variantId, description, quantityOrdered, unitNames, notes }) {
  if (!orderId) throw new ValidationError('orderId is required.');
  if (!Number.isInteger(quantityOrdered) || quantityOrdered < 1) {
    throw new ValidationError('quantityOrdered must be a whole number >= 1.');
  }
  if (!variantId && !description) {
    throw new ValidationError('An order line needs either a variantId or a plain description.');
  }
  const id = newInternalId();
  await db
    .prepare(
      `INSERT INTO order_lines (id, order_id, variant_id, description, quantity_ordered, unit_names, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      orderId,
      variantId ?? null,
      description ?? null,
      quantityOrdered,
      unitNames && unitNames.length ? JSON.stringify(unitNames) : null,
      notes ?? null
    )
    .run();
  return { id, orderId, variantId: variantId ?? null, quantityOrdered };
}

// Field Simulation Pass 3 Scenario 6 fix: order_lines.notes was already
// part of the Director-approved Domain Model Revision Pass v1 schema and
// accepted at creation, but there was no way to set or change it
// afterward -- so it could never actually record the thing it exists for
// ("customer changed this line to Size L on 20/9"), since that always
// happens AFTER the line already exists, often after a batch is already
// in progress. Deliberately notes-only: this does NOT touch
// quantity_ordered or variant_id, which stay a real mutation-capability
// gap requiring a design call (same class of risk as the Scenario 1
// batch order-link correction question).
export async function updateOrderLineNotes(db, id, notes) {
  const line = await db.prepare('SELECT id FROM order_lines WHERE id = ?').bind(id).first();
  if (!line) return { notFound: true };
  await db.prepare('UPDATE order_lines SET notes = ? WHERE id = ?').bind(notes ?? null, id).run();
  return { id, notes: notes ?? null };
}

// One order line, its parent order/customer, and every production batch
// fulfilling it (with how many units each batch has actually produced) --
// this is the view that answers "for this line, how much is planned vs.
// actually in batches yet."
// Core Production Simulation Priority 6 (F6-001), built without waiting for
// Director sign-off since it's a pure read-model addition -- no new
// mutation, no schema change (per the standing rule that small read/UI
// fixes can proceed on their own). F6-001's live simulation confirmed there
// is currently no view anywhere that answers, for a whole order (which
// spans one production batch per variant/order-line), the exact numbers
// Director's Fasa 7 asked a supervisor to produce in 30 seconds: a
// customer's 100-unit order shows up as 3 separate unrelated batch rows in
// Product Setup and 3 separate order-line pickers in Pack & Ship, with no
// single place that sums them or flags a discrepancy.
export async function getOrderReconciliation(db, orderId) {
  const order = await db
    .prepare(
      `SELECT o.id, o.order_reference, c.name AS customer_name
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`
    )
    .bind(orderId)
    .first();
  if (!order) return null;

  const { results: lines } = await db
    .prepare(
      `SELECT
         ol.id AS order_line_id, ol.quantity_ordered, ol.description,
         v.variant_label, p.name AS product_name,
         (SELECT COUNT(*) FROM units u JOIN production_batches pb ON pb.id = u.batch_id
            WHERE pb.order_line_id = ol.id) AS units_generated,
         (SELECT COUNT(*) FROM units u JOIN production_batches pb ON pb.id = u.batch_id
            WHERE pb.order_line_id = ol.id AND u.label_confirmed_at IS NOT NULL) AS units_attached,
         (SELECT COUNT(*) FROM units u JOIN production_batches pb ON pb.id = u.batch_id
            WHERE pb.order_line_id = ol.id
              AND EXISTS (SELECT 1 FROM shipment_units su WHERE su.unit_id = u.id)) AS units_packed,
         (SELECT COUNT(*) FROM units u JOIN production_batches pb ON pb.id = u.batch_id
            WHERE pb.order_line_id = ol.id
              AND EXISTS (
                SELECT 1 FROM shipment_units su JOIN shipments s ON s.id = su.shipment_id
                WHERE su.unit_id = u.id AND s.status = 'DISPATCHED'
              )) AS units_dispatched
       FROM order_lines ol
       LEFT JOIN variants v ON v.id = ol.variant_id
       LEFT JOIN products p ON p.id = v.product_id
       WHERE ol.order_id = ?
       ORDER BY ol.created_at`
    )
    .bind(orderId)
    .all();

  const totals = lines.reduce(
    (acc, l) => ({
      ordered: acc.ordered + l.quantity_ordered,
      generated: acc.generated + l.units_generated,
      attached: acc.attached + l.units_attached,
      packed: acc.packed + l.units_packed,
      dispatched: acc.dispatched + l.units_dispatched,
    }),
    { ordered: 0, generated: 0, attached: 0, packed: 0, dispatched: 0 }
  );

  return { order, lines, totals };
}

export async function getOrderLine(db, id) {
  const line = await db
    .prepare(
      `SELECT ol.*, o.order_reference, o.customer_id, o.notes AS order_notes, c.name AS customer_name
       FROM order_lines ol
       JOIN orders o ON o.id = ol.order_id
       JOIN customers c ON c.id = o.customer_id
       WHERE ol.id = ?`
    )
    .bind(id)
    .first();
  if (!line) return null;

  const { results: batches } = await db
    .prepare(
      `SELECT id, batch_number, planned_quantity
       FROM production_batches WHERE order_line_id = ? ORDER BY created_at`
    )
    .bind(id)
    .all();

  return { ...line, batches };
}

export async function createOrderWithLabels(db, { customerId, customerName, orderReference, orderDate, dueDate, notes, items, actor }) {
  if (!orderReference || !String(orderReference).trim()) {
    throw new ValidationError('orderReference is required.');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('At least one item is required in the order.');
  }

  const customer = await getOrCreateCustomer(db, { id: customerId, name: customerName });
  const order = await createOrder(db, {
    customerId: customer.id,
    orderReference: String(orderReference).trim(),
    orderDate,
    dueDate,
    notes,
  });

  const createdLines = [];

  for (const item of items) {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new ValidationError(`Invalid quantity (${item.quantity}) for item "${item.productName || 'unnamed'}".`);
    }

    let variantId = item.variantId;
    let productName = item.productName;
    let variantLabel = item.variantLabel;

    if (!variantId && productName && variantLabel) {
      const product = await getOrCreateProduct(db, productName);
      if (item.dimensions && Array.isArray(item.dimensions)) {
        await addProductDimensions(db, product.id, item.dimensions);
      }
      const variant = await getOrCreateVariant(db, product.id, variantLabel, item.attributes);
      variantId = variant.id;
    }

    const line = await createOrderLine(db, {
      orderId: order.id,
      variantId,
      description: item.description || (productName ? `${productName} (${variantLabel || ''})` : 'Custom Item'),
      quantityOrdered: quantity,
      unitNames: item.unitNames,
      notes: item.notes,
    });

    const batchesToCreate = Array.isArray(item.batches) && item.batches.length > 0
      ? item.batches
      : [{ quantity }];

    const lineBatches = [];
    for (const bSpec of batchesToCreate) {
      const bQty = Number(bSpec.quantity || bSpec.plannedQuantity || quantity);
      const bNum = bSpec.batchNumber ? String(bSpec.batchNumber) : await nextBatchNumber(db, variantId);

      let bNotes = null;
      if (item.unitNames && item.unitNames.length) {
        bNotes = JSON.stringify({ plannedUnitNames: item.unitNames });
      }

      const pb = await createProductionBatch(db, {
        variantId,
        batchNumber: bNum,
        plannedQuantity: bQty,
        orderLineId: line.id,
        notes: bNotes,
      });

      const genResult = await generateUnitsForBatch(db, pb.id, actor);
      lineBatches.push({ batchId: pb.id, batchNumber: bNum, plannedQuantity: bQty, createdUnits: genResult.created });
    }

    createdLines.push({ lineId: line.id, description: line.description, quantity, batches: lineBatches });
  }

  return { orderId: order.id, orderReference: order.orderReference, customerName: customer.name, lines: createdLines };
}

export async function addBatchToOrderLine(db, lineId, { quantity, batchNumber, actor }) {
  const line = await getOrderLine(db, lineId);
  if (!line) return { notFound: true };
  if (!line.variant_id) throw new ValidationError('Cannot create a production batch for an order line without an assigned variant.');

  const bQty = Number(quantity);
  if (!Number.isInteger(bQty) || bQty < 1) throw new ValidationError('Batch quantity must be >= 1.');

  const bNum = batchNumber ? String(batchNumber) : await nextBatchNumber(db, line.variant_id);

  const pb = await createProductionBatch(db, {
    variantId: line.variant_id,
    batchNumber: bNum,
    plannedQuantity: bQty,
    orderLineId: line.id,
  });

  const genResult = await generateUnitsForBatch(db, pb.id, actor);
  return { batchId: pb.id, batchNumber: bNum, plannedQuantity: bQty, createdUnits: genResult.created };
}
