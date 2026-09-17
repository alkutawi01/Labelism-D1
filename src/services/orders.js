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
import { buildUnitStatementsForBatch } from './receiving.js';

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
    throw new ValidationError('Selected customer not found.');
  }
  if (!name || !String(name).trim()) throw new ValidationError('Customer name is required.');
  return await createCustomer(db, { name: String(name).trim(), contactInfo });
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

export async function updateOrderLineNotes(db, id, notes) {
  const line = await db.prepare('SELECT id FROM order_lines WHERE id = ?').bind(id).first();
  if (!line) return { notFound: true };
  await db.prepare('UPDATE order_lines SET notes = ? WHERE id = ?').bind(notes ?? null, id).run();
  return { id, notes: notes ?? null };
}

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
         (SELECT COALESCE(SUM(s.planned_quantity), 0)
            FROM shipments s WHERE s.order_line_id = ol.id AND s.status NOT IN ('DISPATCHED','CANCELLED')
         ) AS shipment_planned,
         (SELECT COUNT(*) FROM shipment_units su
            JOIN shipments s ON s.id = su.shipment_id
            JOIN units u ON u.id = su.unit_id
            JOIN production_batches pb ON pb.id = u.batch_id
            WHERE pb.order_line_id = ol.id) AS units_packed,
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
      shipment_planned: acc.shipment_planned + l.shipment_planned,
      packed: acc.packed + l.units_packed,
      dispatched: acc.dispatched + l.units_dispatched,
    }),
    { ordered: 0, generated: 0, attached: 0, shipment_planned: 0, packed: 0, dispatched: 0 }
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

// ─────────────────────────────────────────────────────────────────────────────
// PREFLIGHT HELPERS -- read-only, called before any writes are assembled.
// These functions only query the DB and return IDs/statements to be included
// in the main db.batch(). They never write anything themselves.
// ─────────────────────────────────────────────────────────────────────────────

// Returns { variantId, productStatements } where productStatements is an
// array of prepared D1 statements (for Product, Dimensions, Variant) that
// must be included in the caller's db.batch() call BEFORE they are used.
// variantId is pre-generated here so it can be referenced immediately.
async function preflightVariant(db, { productName, variantLabel, dimensions, attributes }) {
  const statements = [];

  // 1. Resolve or plan Product
  const trimmedProductName = String(productName).trim();
  const existingProduct = await db
    .prepare('SELECT id, name FROM products WHERE LOWER(TRIM(name)) = LOWER(?)')
    .bind(trimmedProductName)
    .first();

  let productId;
  if (existingProduct) {
    productId = existingProduct.id;
  } else {
    productId = newInternalId();
    statements.push(
      db.prepare('INSERT INTO products (id, name) VALUES (?, ?)').bind(productId, trimmedProductName)
    );
  }

  // 2. Resolve or plan Dimensions (additive, INSERT OR IGNORE)
  if (Array.isArray(dimensions) && dimensions.length > 0) {
    const existingDims = existingProduct
      ? await db
          .prepare('SELECT name FROM product_dimensions WHERE product_id = ?')
          .bind(productId)
          .all()
          .then((r) => new Set(r.results.map((d) => d.name.toLowerCase())))
      : new Set();

    const maxOrderRow = existingProduct
      ? await db
          .prepare('SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM product_dimensions WHERE product_id = ?')
          .bind(productId)
          .first()
      : { maxOrder: -1 };
    let nextOrder = maxOrderRow.maxOrder + 1;

    for (const rawName of dimensions) {
      const name = String(rawName).trim();
      if (!name || existingDims.has(name.toLowerCase())) continue;
      statements.push(
        db
          .prepare('INSERT OR IGNORE INTO product_dimensions (id, product_id, name, sort_order) VALUES (?, ?, ?, ?)')
          .bind(newInternalId(), productId, name, nextOrder++)
      );
    }
  }

  // 3. Resolve or plan Variant
  const existingVariant = await db
    .prepare('SELECT id FROM variants WHERE product_id = ? AND variant_label = ?')
    .bind(productId, variantLabel)
    .first();

  let variantId;
  if (existingVariant) {
    variantId = existingVariant.id;
  } else {
    variantId = newInternalId();
    statements.push(
      db.prepare('INSERT INTO variants (id, product_id, variant_label) VALUES (?, ?, ?)').bind(variantId, productId, variantLabel)
    );
    // Variant attributes
    if (attributes && typeof attributes === 'object') {
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          statements.push(
            db.prepare('INSERT INTO variant_attributes (variant_id, key, value) VALUES (?, ?, ?)').bind(variantId, key, String(value))
          );
        }
      }
    }
  }

  return { variantId, statements };
}

// Determines the next safe batch numbers for a given variant, accounting
// for both existing DB rows AND in-flight batches that haven't been committed yet.
// inFlightCount: how many batches for this variant are already queued in the
// current transaction (so we don't collide with them either).
async function nextBatchNumbers(db, variantId, count, inFlightCount = 0) {
  if (count <= 0) return [];
  // Get the current maximum batch number used for this variant
  const { results: existing } = await db
    .prepare('SELECT batch_number FROM production_batches WHERE variant_id = ?')
    .bind(variantId)
    .all();
  const usedNumbers = new Set(existing.map((r) => String(r.batch_number)));

  const numbers = [];
  let candidate = 1;
  const totalNeeded = count + inFlightCount;
  const allReserved = new Set(usedNumbers);

  // Reserve both existing and in-flight numbers
  // We'll collect `totalNeeded` free numbers but only return the last `count` of them
  const allFree = [];
  while (allFree.length < totalNeeded) {
    if (!allReserved.has(String(candidate))) {
      allFree.push(String(candidate));
      allReserved.add(String(candidate));
    }
    candidate++;
  }
  // Return the last `count` numbers (the first `inFlightCount` are already taken by prior items)
  return allFree.slice(inFlightCount, inFlightCount + count);
}

// ─────────────────────────────────────────────────────────────────────────────
// createOrderWithLabels -- single atomic db.batch() covering:
//   Customer (if new) → Product → Dimensions → Variant → Order →
//   OrderLine → ProductionBatch(es) → Units
//
// All writes are in one db.batch(). Preflight reads only.
// ─────────────────────────────────────────────────────────────────────────────
export async function createOrderWithLabels(db, { customerId, customerName, orderReference, orderDate, dueDate, notes, items, actor }) {
  if (!orderReference || !String(orderReference).trim()) {
    throw new ValidationError('orderReference is required.');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('At least one item is required in the order.');
  }

  // ── Fix 5: Pre-validate ALL items and ALL batch specs before any reads/writes ──
  for (const [iIdx, item] of items.entries()) {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new ValidationError(
        `items[${iIdx}]: quantity must be a whole number >= 1, got: ${JSON.stringify(item.quantity)}.`
      );
    }
    if (!item.productName || !String(item.productName).trim()) {
      throw new ValidationError(`items[${iIdx}]: productName is required.`);
    }
    if (!item.variantLabel && !item.variantId && !item.description) {
      throw new ValidationError(`items[${iIdx}]: variantLabel or variantId or description is required.`);
    }

    if (Array.isArray(item.batches) && item.batches.length > 0) {
      let batchSum = 0;
      for (const [bIdx, b] of item.batches.entries()) {
        const bqty = Number(b.quantity ?? b.plannedQuantity);
        if (!Number.isInteger(bqty) || bqty < 1) {
          throw new ValidationError(
            `items[${iIdx}].batches[${bIdx}]: quantity must be a whole number >= 1, got: ${JSON.stringify(b.quantity ?? b.plannedQuantity)}.`
          );
        }
        if (b.batchNumber !== undefined && b.batchNumber !== null) {
          const bn = String(b.batchNumber).trim();
          if (!bn) throw new ValidationError(`items[${iIdx}].batches[${bIdx}]: batchNumber must be a non-empty string if provided.`);
        }
        batchSum += bqty;
      }
      if (batchSum > quantity) {
        throw new ValidationError(
          `items[${iIdx}]: sum of batch quantities (${batchSum}) exceeds ordered quantity (${quantity}).`
        );
      }
    }
  }

  // ── Handle Customer (Preflight read only) ──
  let customer;
  let customerStatement = null;
  if (customerId) {
    customer = await db.prepare('SELECT id, name FROM customers WHERE id = ?').bind(customerId).first();
    if (!customer) throw new ValidationError('Selected customer not found.');
  } else if (customerName && String(customerName).trim()) {
    const custId = newInternalId();
    customer = { id: custId, name: String(customerName).trim() };
    customerStatement = db.prepare('INSERT INTO customers (id, name) VALUES (?, ?)').bind(customer.id, customer.name);
  } else {
    throw new ValidationError('Customer selection or name is required.');
  }

  const orderId = newInternalId();
  const allStatements = [];

  if (customerStatement) allStatements.push(customerStatement);

  allStatements.push(
    db.prepare(
      `INSERT INTO orders (id, customer_id, order_reference, order_date, due_date, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(orderId, customer.id, String(orderReference).trim(), orderDate ?? null, dueDate ?? null, notes ?? null)
  );

  const createdLines = [];

  // Track in-flight batch counts per variantId to avoid batch number collisions
  // within the same transaction (Fix 3).
  const inFlightBatchCounts = new Map(); // variantId -> count already reserved

  for (const item of items) {
    const quantity = Number(item.quantity);
    let variantId = item.variantId;

    // ── Fix 2: ALL writes (Product/Variant/Dimensions) go into allStatements ──
    let variantPreflight = null;
    if (!variantId && item.productName && item.variantLabel) {
      variantPreflight = await preflightVariant(db, {
        productName: item.productName,
        variantLabel: item.variantLabel,
        dimensions: item.dimensions,
        attributes: item.attributes,
      });
      variantId = variantPreflight.variantId;
      allStatements.push(...variantPreflight.statements);
    }

    const lineId = newInternalId();
    const productName = item.productName || '';
    const variantLabel = item.variantLabel || '';
    const description = item.description || (productName ? `${productName} (${variantLabel})` : 'Custom Item');
    const unitNamesJson = item.unitNames && item.unitNames.length ? JSON.stringify(item.unitNames) : null;

    allStatements.push(
      db.prepare(
        `INSERT INTO order_lines (id, order_id, variant_id, description, quantity_ordered, unit_names, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(lineId, orderId, variantId ?? null, description, quantity, unitNamesJson, item.notes ?? null)
    );

    // Determine batch breakdown
    const batchesToCreate = Array.isArray(item.batches) && item.batches.length > 0
      ? item.batches
      : [{ quantity }];

    const lineBatches = [];
    let processedUnitsCount = 0;

    // ── Fix 3: Resolve batch numbers atomically, accounting for in-flight count ──
    // Separate batches into those with explicit numbers vs those needing auto-assignment
    const needsAutoNumber = batchesToCreate.filter(
      (b) => !b.batchNumber || !String(b.batchNumber).trim()
    );
    const alreadyInFlight = inFlightBatchCounts.get(variantId) || 0;
    const autoNumbers = variantId
      ? await nextBatchNumbers(db, variantId, needsAutoNumber.length, alreadyInFlight)
      : needsAutoNumber.map((_, i) => String(alreadyInFlight + i + 1));
    let autoNumberIdx = 0;

    for (let bIdx = 0; bIdx < batchesToCreate.length; bIdx++) {
      const bSpec = batchesToCreate[bIdx];
      const bQty = Number(bSpec.quantity ?? bSpec.plannedQuantity ?? quantity);
      const hasExplicit = bSpec.batchNumber && String(bSpec.batchNumber).trim();
      const bNum = hasExplicit ? String(bSpec.batchNumber).trim() : autoNumbers[autoNumberIdx++];
      const batchId = newInternalId();

      allStatements.push(
        db.prepare(
          `INSERT INTO production_batches (id, variant_id, batch_number, planned_quantity, order_line_id)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(batchId, variantId, bNum, bQty, lineId)
      );

      const batchUnitNames = Array.isArray(item.unitNames)
        ? item.unitNames.slice(processedUnitsCount, processedUnitsCount + bQty)
        : [];
      processedUnitsCount += bQty;

      const { createdUnits, statements: uStmts } = buildUnitStatementsForBatch(db, batchId, bQty, 0, batchUnitNames, actor);
      allStatements.push(...uStmts);

      lineBatches.push({ batchId, batchNumber: bNum, plannedQuantity: bQty, createdUnits: createdUnits.length });
    }

    // Update in-flight count for this variant
    inFlightBatchCounts.set(variantId, (inFlightBatchCounts.get(variantId) || 0) + batchesToCreate.length);

    createdLines.push({ lineId, description, quantity, batches: lineBatches });
  }

  // ── Single atomic db.batch() -- all or nothing ──
  await db.batch(allStatements);

  return { orderId, orderReference: String(orderReference).trim(), customerName: customer.name, lines: createdLines };
}

// ─────────────────────────────────────────────────────────────────────────────
// addBatchToOrderLine -- Fix 6: atomic enforcement via DB-level guard.
// Instead of read-then-write (race condition), we INSERT only if the remaining
// balance is sufficient, then check D1's `meta.changes` to detect overflow.
// ─────────────────────────────────────────────────────────────────────────────
export async function addBatchToOrderLine(db, lineId, { quantity, batchNumber, actor }) {
  const line = await getOrderLine(db, lineId);
  if (!line) return { notFound: true };
  if (!line.variant_id) throw new ValidationError('Cannot create a production batch for an order line without an assigned variant.');

  // ── Fix 5: validate batch quantity ──
  const bQty = Number(quantity);
  if (!Number.isInteger(bQty) || bQty < 1) throw new ValidationError('Batch quantity must be a whole number >= 1.');

  // Resolve batch number safely (reads current DB state)
  const bNum = batchNumber && String(batchNumber).trim()
    ? String(batchNumber).trim()
    : await nextBatchNumberSafe(db, line.variant_id, lineId);

  let names = [];
  if (line.unit_names) {
    try {
      const parsed = JSON.parse(line.unit_names);
      if (Array.isArray(parsed)) {
        const existingSum = line.batches.reduce((s, b) => s + b.planned_quantity, 0);
        names = parsed.slice(existingSum, existingSum + bQty);
      }
    } catch {}
  }

  const batchId = newInternalId();

  // ── Fix 6: Atomic guard using conditional INSERT ──
  // The INSERT only executes if the remaining balance >= bQty.
  // D1's meta.changes will be 0 if the condition failed.
  const guardedInsert = db.prepare(
    `INSERT INTO production_batches (id, variant_id, batch_number, planned_quantity, order_line_id)
     SELECT ?, ?, ?, ?, ?
     WHERE (
       SELECT COALESCE(SUM(planned_quantity), 0)
       FROM production_batches
       WHERE order_line_id = ?
     ) + ? <= (
       SELECT quantity_ordered FROM order_lines WHERE id = ?
     )`
  ).bind(batchId, line.variant_id, bNum, bQty, lineId, lineId, bQty, lineId);

  const { createdUnits, statements: unitStmts } = buildUnitStatementsForBatch(db, batchId, bQty, 0, names, actor);

  // Run the guarded insert first to check changes, then commit units
  const guardResult = await db.batch([guardedInsert]);
  const changes = guardResult[0]?.meta?.changes ?? guardResult[0]?.changes ?? 1;
  if (changes === 0) {
    const sumRow = await db
      .prepare('SELECT COALESCE(SUM(planned_quantity), 0) AS totalPlanned FROM production_batches WHERE order_line_id = ?')
      .bind(lineId)
      .first();
    const existing = Number(sumRow.totalPlanned);
    const unallocated = line.quantity_ordered - existing;
    throw new ValidationError(
      `Batch quantity (${bQty}) exceeds unallocated order line balance (${unallocated}).`
    );
  }

  // Batch insert was accepted; now atomically add unit statements
  if (unitStmts.length > 0) {
    await db.batch(unitStmts);
  }

  return { batchId, batchNumber: bNum, plannedQuantity: bQty, createdUnits: createdUnits.length };
}

// nextBatchNumberSafe: reads current DB state plus the current lineId's
// in-progress batches (none, since this is addBatchToOrderLine -- sequential
// calls, not bulk). Returns the next free number as a string.
async function nextBatchNumberSafe(db, variantId) {
  const { results: existing } = await db
    .prepare('SELECT batch_number FROM production_batches WHERE variant_id = ?')
    .bind(variantId)
    .all();
  const used = new Set(existing.map((r) => String(r.batch_number)));
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}
