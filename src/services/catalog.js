// Products / Variants / Production Batches / Locations -- direct port of
// the equivalent section in labelismPg.js. Same field names, same shape,
// same validation, only the driver calls changed (D1 prepared statements
// instead of pg pool.query).
import { newInternalId } from '../db/d1.js';
import { ValidationError } from '../domain/validation.js';

export async function createProduct(db, { name }) {
  if (!name) throw new ValidationError('Product name is required.');
  const id = newInternalId();
  await db.prepare('INSERT INTO products (id, name) VALUES (?, ?)').bind(id, name).run();
  return { id, name };
}

// Lists products with their existing variants (each resolved to its
// structured dimension values, not just the flat display label) and the
// product's defined dimensions -- so the UI can offer "add a variant to an
// existing product" and show/query variants by their real attributes
// instead of one opaque concatenated string. Per Director's Variant
// Dimensions Pass design: dimensions are editor-defined per product (no
// universal Size/Color hardcoded), and this never auto-generates
// combinations -- it only reports what already exists.
export async function listProducts(db) {
  const { results: products } = await db.prepare('SELECT id, name FROM products ORDER BY name').all();
  const { results: dimensions } = await db
    .prepare('SELECT id, product_id, name FROM product_dimensions ORDER BY sort_order, name')
    .all();
  const { results: variants } = await db
    .prepare('SELECT id, product_id, variant_label FROM variants ORDER BY variant_label')
    .all();
  const { results: attrs } = await db.prepare('SELECT variant_id, key, value FROM variant_attributes').all();

  const attrsByVariant = new Map();
  for (const a of attrs) {
    if (!attrsByVariant.has(a.variant_id)) attrsByVariant.set(a.variant_id, {});
    attrsByVariant.get(a.variant_id)[a.key] = a.value;
  }
  const dimensionsByProduct = new Map();
  for (const d of dimensions) {
    if (!dimensionsByProduct.has(d.product_id)) dimensionsByProduct.set(d.product_id, []);
    dimensionsByProduct.get(d.product_id).push(d.name);
  }
  const variantsByProduct = new Map();
  for (const v of variants) {
    if (!variantsByProduct.has(v.product_id)) variantsByProduct.set(v.product_id, []);
    variantsByProduct.get(v.product_id).push({
      id: v.id,
      variantLabel: v.variant_label,
      attributes: attrsByVariant.get(v.id) ?? {},
    });
  }
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    dimensions: dimensionsByProduct.get(p.id) ?? [],
    variants: variantsByProduct.get(p.id) ?? [],
  }));
}

// Adds dimensions to a product (e.g. "Saiz", "Warna") -- additive, never
// removes existing ones, and duplicates by name are silently ignored (a
// product re-declaring a dimension it already has is not an error).
export async function addProductDimensions(db, productId, names) {
  const product = await db.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first();
  if (!product) return { notFound: true };

  const existingRow = await db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM product_dimensions WHERE product_id = ?')
    .bind(productId)
    .first();
  let nextOrder = existingRow.maxOrder + 1;

  const statements = [];
  for (const rawName of names) {
    const name = String(rawName).trim();
    if (!name) continue;
    statements.push(
      db
        .prepare('INSERT OR IGNORE INTO product_dimensions (id, product_id, name, sort_order) VALUES (?, ?, ?, ?)')
        .bind(newInternalId(), productId, name, nextOrder++)
    );
  }
  if (statements.length) await db.batch(statements);

  const { results } = await db
    .prepare('SELECT name FROM product_dimensions WHERE product_id = ? ORDER BY sort_order, name')
    .bind(productId)
    .all();
  return { productId, dimensions: results.map((r) => r.name) };
}

export async function createVariant(db, { productId, variantLabel, attributes }) {
  if (!productId || !variantLabel) {
    throw new ValidationError('productId and variantLabel are required.');
  }
  const id = newInternalId();
  const statements = [
    db.prepare('INSERT INTO variants (id, product_id, variant_label) VALUES (?, ?, ?)').bind(id, productId, variantLabel),
  ];
  if (attributes && typeof attributes === 'object') {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined && value !== null && value !== '') {
        statements.push(
          db.prepare('INSERT INTO variant_attributes (variant_id, key, value) VALUES (?, ?, ?)').bind(id, key, String(value))
        );
      }
    }
  }
  await db.batch(statements);
  return { id, productId, variantLabel };
}

export async function createProductionBatch(db, { variantId, batchNumber, plannedQuantity, unitCostCents, producerName }) {
  if (!variantId || !batchNumber || !plannedQuantity) {
    throw new ValidationError('variantId, batchNumber, and plannedQuantity are required.');
  }
  const id = newInternalId();
  await db
    .prepare(
      `INSERT INTO production_batches (id, variant_id, batch_number, planned_quantity, unit_cost_cents, producer_name)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, variantId, String(batchNumber), plannedQuantity, unitCostCents ?? null, producerName ?? null)
    .run();
  return { id, variantId, batchNumber: String(batchNumber), plannedQuantity };
}

export async function listProductionBatches(db) {
  const { results } = await db
    .prepare(
      `SELECT pb.id, pb.batch_number, pb.planned_quantity, p.name AS product_name, v.variant_label
       FROM production_batches pb
       JOIN variants v ON v.id = pb.variant_id
       JOIN products p ON p.id = v.product_id
       ORDER BY pb.created_at DESC`
    )
    .all();
  return results;
}

export async function getProductionBatch(db, id) {
  const batch = await db.prepare('SELECT * FROM production_batches WHERE id = ?').bind(id).first();
  if (!batch) return null;
  const { results: receipts } = await db
    .prepare('SELECT * FROM batch_receipts WHERE batch_id = ? ORDER BY received_at')
    .bind(id)
    .all();
  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM units WHERE batch_id = ?').bind(id).first();
  return { ...batch, receipts, unitCount: Number(countRow.n) };
}

export async function listLocations(db) {
  const { results } = await db.prepare('SELECT * FROM locations ORDER BY name').all();
  return results;
}

export async function createLocation(db, { name, locationType }) {
  if (!name) throw new ValidationError('Location name is required.');
  const id = newInternalId();
  await db
    .prepare('INSERT INTO locations (id, name, location_type) VALUES (?, ?, ?)')
    .bind(id, name, locationType ?? null)
    .run();
  return { id, name, locationType: locationType ?? null };
}

export async function listUnitsForBatch(db, batchId) {
  const { results } = await db
    .prepare(
      'SELECT id, human_code, internal_token, current_disposition, label_confirmed_at FROM units WHERE batch_id = ? ORDER BY human_code'
    )
    .bind(batchId)
    .all();
  return results;
}
