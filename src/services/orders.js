// Customer -> Order -> OrderLine -- Domain Model Revision Pass v1
// (Director-approved 2026-09-13). Sits alongside Product/Variant/
// ProductionBatch/Unit, does not replace it. The golden rule from the
// An order is the production promise. Creating a production batch creates
// exactly one label/unit record per promised unit; physical existence is only
// confirmed later when production attaches the label. Multiple batches let a
// single order line be generated in delivery phases.
import { newInternalId } from '../db/d1.js';
import { ValidationError } from '../domain/validation.js';
import { buildUnitStatementsForBatch } from './receiving.js';
import { cleanLabelText, labelKey, looseKey, ConfirmationRequired } from '../domain/validation.js';

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
              )) AS units_dispatched,
         -- Returned = currently back in the building: received through a return
         -- intake and not dispatched again since. A unit stays in its old
         -- DISPATCHED shipment, so "dispatched" alone would still count it.
         (SELECT COUNT(*) FROM units u JOIN production_batches pb ON pb.id = u.batch_id
            WHERE pb.order_line_id = ol.id
              AND EXISTS (
                SELECT 1 FROM unit_events r
                WHERE r.unit_id = u.id AND r.event_type = 'RETURN_RECEIVED'
                  AND NOT EXISTS (
                    SELECT 1 FROM unit_events d
                    WHERE d.unit_id = u.id AND d.event_type = 'UNIT_DISPATCHED' AND d.seq > r.seq)
              )) AS units_returned
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
      returned: acc.returned + l.units_returned,
    }),
    { ordered: 0, generated: 0, attached: 0, shipment_planned: 0, packed: 0, dispatched: 0, returned: 0 }
  );
  // With the customer right now = dispatched and not (currently) returned.
  lines.forEach((l) => { l.units_with_customer = l.units_dispatched - l.units_returned; });
  totals.with_customer = totals.dispatched - totals.returned;

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
async function preflightVariant(db, { productName, variantLabel, dimensions, attributes }, registry) {
  const statements = [];

  // 1. Resolve or plan Product
  const trimmedProductName = String(productName).trim();
  const productKey = trimmedProductName.toLowerCase();
  let productPlan = registry.products.get(productKey);
  if (!productPlan) {
    const existingProduct = await db
      .prepare('SELECT id, name FROM products WHERE LOWER(TRIM(name)) = LOWER(?)')
      .bind(trimmedProductName)
      .first();
    productPlan = existingProduct
      ? { id: existingProduct.id, exists: true }
      : { id: newInternalId(), exists: false };
    registry.products.set(productKey, productPlan);
    if (!productPlan.exists) {
      statements.push(
        db.prepare('INSERT INTO products (id, name) VALUES (?, ?)').bind(productPlan.id, trimmedProductName)
      );
    }
  }
  const productId = productPlan.id;

  // 2. Resolve or plan Dimensions (additive, INSERT OR IGNORE)
  if (Array.isArray(dimensions) && dimensions.length > 0) {
    let dimensionPlan = registry.dimensions.get(productId);
    if (!dimensionPlan) {
      const existingRows = productPlan.exists
        ? await db.prepare('SELECT name, sort_order FROM product_dimensions WHERE product_id = ?').bind(productId).all()
        : { results: [] };
      const existingDims = new Set(existingRows.results.map((d) => d.name.toLowerCase()));
      const maxOrder = existingRows.results.reduce((max, d) => Math.max(max, Number(d.sort_order)), -1);
      dimensionPlan = { names: existingDims, nextOrder: maxOrder + 1 };
      registry.dimensions.set(productId, dimensionPlan);
    }

    for (const rawName of dimensions) {
      const name = String(rawName).trim();
      const dimensionKey = name.toLowerCase();
      if (!name || dimensionPlan.names.has(dimensionKey)) continue;
      statements.push(
        db
          .prepare('INSERT OR IGNORE INTO product_dimensions (id, product_id, name, sort_order) VALUES (?, ?, ?, ?)')
          .bind(newInternalId(), productId, name, dimensionPlan.nextOrder++)
      );
      dimensionPlan.names.add(dimensionKey);
    }
  }

  // 3. Resolve or plan Variant
  const variantKey = `${productId}\u0000${String(variantLabel)}`;
  let variantPlan = registry.variants.get(variantKey);
  if (!variantPlan) {
    const existingVariant = productPlan.exists
      ? await db
          .prepare('SELECT id FROM variants WHERE product_id = ? AND variant_label = ?')
          .bind(productId, variantLabel)
          .first()
      : null;
    variantPlan = existingVariant
      ? { id: existingVariant.id, exists: true }
      : { id: newInternalId(), exists: false };
    registry.variants.set(variantKey, variantPlan);
  }

  const variantId = variantPlan.id;
  if (!variantPlan.exists && !registry.queuedVariants.has(variantKey)) {
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
    registry.queuedVariants.add(variantKey);
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
// Variation spelling guard. Never rewrites what the person typed (XL and X-L
// may be genuinely different sizes for some companies); it only refuses the
// unambiguous and asks about the ambiguous:
//   - REFUSE: two spellings that differ only by case (XL / xl), within this
//     order or against a variation the product already has.
//   - ASK:    two spellings that differ only by punctuation/spacing (XL / X-L),
//     answered by resending with acknowledgeWarnings: true.
// Whitespace inside/around a label is cleaned first (that is not a spelling).
async function checkVariantSpellings(db, items) {
  const byProduct = new Map(); // product key -> { name, labels: Map(labelKey -> Set(clean text)), sources }
  const note = (productName, label, where) => {
    const pKey = String(productName).trim().toLowerCase();
    if (!byProduct.has(pKey)) byProduct.set(pKey, { name: String(productName).trim(), spellings: new Map() });
    const spellings = byProduct.get(pKey).spellings;
    if (!spellings.has(label)) spellings.set(label, where);
  };
  for (const item of items) {
    if (item.variantId || !item.productName || !item.variantLabel) continue;
    note(item.productName, item.variantLabel, 'tempahan ini');
  }
  for (const [pKey, entry] of byProduct) {
    const { results } = await db
      .prepare(
        `SELECT v.variant_label FROM variants v JOIN products p ON p.id = v.product_id
         WHERE LOWER(TRIM(p.name)) = ?`
      )
      .bind(pKey)
      .all();
    for (const r of results) {
      const existing = cleanLabelText(r.variant_label);
      if (!entry.spellings.has(existing)) entry.spellings.set(existing, 'sedia ada');
    }
  }

  const warnings = [];
  for (const { name, spellings } of byProduct.values()) {
    const labels = [...spellings.keys()];
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i];
        const b = labels[j];
        if (spellings.get(a) === 'sedia ada' && spellings.get(b) === 'sedia ada') continue; // not this order's doing
        if (labelKey(a) === labelKey(b)) {
          throw new ValidationError(
            `Produk "${name}": variasi "${a}" dan "${b}" sama kecuali huruf besar/kecil. Guna satu ejaan sahaja.`
          );
        }
        if (looseKey(a) === looseKey(b)) {
          warnings.push(`Produk "${name}": variasi "${a}" hampir sama dengan "${b}". Pastikan ia memang saiz yang berbeza.`);
        }
      }
    }
  }
  return warnings;
}

// The same label text twice in a list of mostly different texts (a list of
// people) is usually a copy/paste slip, but two people can share a name, so
// this asks instead of refusing. A text that repeats on most garments (a brand)
// is normal and is not flagged.
function checkDuplicateNames(items) {
  const warnings = [];
  const scan = (names, where) => {
    const seen = new Map();
    for (const raw of names || []) {
      const clean = cleanLabelText(raw);
      if (!clean) continue;
      const key = clean.toLowerCase();
      seen.set(key, { name: seen.get(key)?.name ?? clean, n: (seen.get(key)?.n ?? 0) + 1 });
    }
    const total = [...seen.values()].reduce((s, v) => s + v.n, 0);
    if (total < 2 || seen.size / total < 0.6) return; // mostly repeats (e.g. one brand on every garment): normal
    for (const { name, n } of seen.values()) {
      if (n > 1) warnings.push(`${where}: teks "${name}" muncul ${n} kali. Pastikan memang sengaja berulang.`);
    }
  };
  for (const item of items) {
    const where = [item.productName, item.variantLabel].filter(Boolean).join(' ');
    scan(item.unitNames, where);
    (item.batches || []).forEach((b) => scan(b.unitNames, `${where}${b.batchLabel ? ' (' + cleanLabelText(b.batchLabel) + ')' : ''}`));
  }
  return warnings;
}

export async function createOrderWithLabels(db, { customerId, customerName, orderReference, orderDate, dueDate, notes, items, actor, acknowledgeWarnings }) {
  // A Job Order often has no JO/invoice number yet when it is first entered
  // (a real Zaicorp JO had both blank), so a blank reference is allowed and
  // gets a readable placeholder instead of blocking the order.
  if (!orderReference || !String(orderReference).trim()) {
    const prefix = `TIADA-RUJUKAN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
    const { n } = await db
      .prepare('SELECT COUNT(*) AS n FROM orders WHERE order_reference LIKE ?')
      .bind(`${prefix}-%`)
      .first();
    orderReference = `${prefix}-${Number(n) + 1}`;
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('At least one item is required in the order.');
  }
  // Whitespace cleanup only (trim + collapse); casing and punctuation are kept.
  items = items.map((it) => (it && typeof it.variantLabel === 'string' ? { ...it, variantLabel: cleanLabelText(it.variantLabel) } : it));

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

    // Item-level names must not outnumber the units ordered, whether or not
    // the item is split into batches (batch-level names are checked below).
    if (Array.isArray(item.unitNames) && item.unitNames.length > quantity) {
      throw new ValidationError(
        `items[${iIdx}]: ${item.unitNames.length} teks label tetapi kuantiti hanya ${quantity}.`
      );
    }

    if (Array.isArray(item.batches) && item.batches.length > 0) {
      let batchSum = 0;
      const groupKeys = new Map();
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
        if (b.batchLabel !== undefined && b.batchLabel !== null && !cleanLabelText(b.batchLabel)) {
          throw new ValidationError(`items[${iIdx}].batches[${bIdx}]: batchLabel must be a non-empty string if provided.`);
        }
        if (b.batchLabel) {
          // The same group named twice in one item ("SK Sekolah A" and
          // "sk  sekolah a ") is almost certainly one group entered twice.
          const key = labelKey(b.batchLabel);
          const seen = groupKeys;
          if (seen.has(key)) {
            throw new ValidationError(
              `items[${iIdx}]: kumpulan "${cleanLabelText(b.batchLabel)}" sama dengan "${seen.get(key)}" (huruf besar/kecil atau ruang berbeza sahaja). Gabungkan menjadi satu kumpulan.`
            );
          }
          seen.set(key, cleanLabelText(b.batchLabel));
        }
        if (b.unitNames !== undefined) {
          if (!Array.isArray(b.unitNames)) {
            throw new ValidationError(`items[${iIdx}].batches[${bIdx}]: unitNames must be an array of strings.`);
          }
          if (b.unitNames.length > bqty) {
            throw new ValidationError(
              `items[${iIdx}].batches[${bIdx}]: unitNames has ${b.unitNames.length} name(s) but this batch's quantity is only ${bqty}.`
            );
          }
        }
        batchSum += bqty;
      }
      if (batchSum > quantity) {
        throw new ValidationError(
          `items[${iIdx}]: sum of batch quantities (${batchSum}) exceeds ordered quantity (${quantity}).`
        );
      }
      // Names given once for the whole item are sliced across the batches, so
      // any that fall beyond the batches' total would be silently dropped.
      if (Array.isArray(item.unitNames) && item.unitNames.length > batchSum) {
        throw new ValidationError(
          `items[${iIdx}]: ${item.unitNames.length} teks label tetapi kumpulan hanya menjana ${batchSum} unit.`
        );
      }
    }
  }

  const spellingWarnings = [...(await checkVariantSpellings(db, items)), ...checkDuplicateNames(items)];
  if (spellingWarnings.length && acknowledgeWarnings !== true) {
    throw new ConfirmationRequired('Ada perkara yang perlu disahkan sebelum tempahan dibuat.', spellingWarnings);
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
  const preflightRegistry = {
    products: new Map(),
    dimensions: new Map(),
    variants: new Map(),
    queuedVariants: new Set(),
  };

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
      }, preflightRegistry);
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
          `INSERT INTO production_batches (id, variant_id, batch_number, planned_quantity, order_line_id, batch_label)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(batchId, variantId, bNum, bQty, lineId, bSpec.batchLabel ? cleanLabelText(bSpec.batchLabel) : null)
      );

      // Per-batch unitNames (e.g. each batch is one school's named
      // students) takes priority when given -- more explicit and less
      // error-prone for an AI-generated manifest than relying on positional
      // slicing across one flat list in the same order as the batches.
      // Falls back to that slicing for backward compatibility.
      const batchUnitNames = Array.isArray(bSpec.unitNames)
        ? bSpec.unitNames
        : Array.isArray(item.unitNames)
        ? item.unitNames.slice(processedUnitsCount, processedUnitsCount + bQty)
        : [];
      if (!Array.isArray(bSpec.unitNames)) processedUnitsCount += bQty;

      const { createdUnits, statements: uStmts } = buildUnitStatementsForBatch(db, batchId, bQty, 0, batchUnitNames, actor);
      allStatements.push(...uStmts);

      lineBatches.push({ batchId, batchNumber: bNum, batchLabel: bSpec.batchLabel ? cleanLabelText(bSpec.batchLabel) : null, plannedQuantity: bQty, createdUnits: createdUnits.length });
    }

    // Update in-flight count for this variant
    inFlightBatchCounts.set(variantId, (inFlightBatchCounts.get(variantId) || 0) + batchesToCreate.length);

    createdLines.push({ lineId, description, quantity, batches: lineBatches });
  }

  // ── Single atomic db.batch() -- all or nothing ──
  await db.batch(allStatements);

  return { orderId, orderReference: String(orderReference).trim(), customerName: customer.name, lines: createdLines, ...(spellingWarnings.length ? { warnings: spellingWarnings } : {}) };
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

  // Keep the batch and all of its units/events in one transaction. If the
  // guard inserts no batch, the dependent unit inserts fail their FK and D1
  // rolls the whole batch back; we then translate that expected race/overflow
  // into the same useful validation message.
  try {
    await db.batch([guardedInsert, ...unitStmts]);
  } catch (error) {
    const sumRow = await db
      .prepare('SELECT COALESCE(SUM(planned_quantity), 0) AS totalPlanned FROM production_batches WHERE order_line_id = ?')
      .bind(lineId)
      .first();
    const existing = Number(sumRow.totalPlanned);
    const unallocated = line.quantity_ordered - existing;
    if (bQty > unallocated) {
      throw new ValidationError(
        `Batch quantity (${bQty}) exceeds unallocated order line balance (${unallocated}).`
      );
    }
    throw error;
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
