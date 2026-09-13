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

export async function createCustomer(db, { name, contactInfo }) {
  if (!name) throw new ValidationError('Customer name is required.');
  const id = newInternalId();
  await db
    .prepare('INSERT INTO customers (id, name, contact_info) VALUES (?, ?, ?)')
    .bind(id, name, contactInfo ?? null)
    .run();
  return { id, name, contactInfo: contactInfo ?? null };
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
      `SELECT ol.id, ol.order_id, ol.quantity_ordered, ol.description, ol.variant_id,
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

// One order line, its parent order/customer, and every production batch
// fulfilling it (with how many units each batch has actually produced) --
// this is the view that answers "for this line, how much is planned vs.
// actually in batches yet."
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
