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

// Case/whitespace-insensitive match on product name -- reuses the existing
// product if one already exists rather than creating a duplicate. Used by
// the document-import flow (see src/services/importManifest.js), where the
// same product may legitimately be re-ordered across multiple documents.
export async function getOrCreateProduct(db, name) {
  const trimmed = String(name).trim();
  const existing = await db
    .prepare('SELECT id, name FROM products WHERE LOWER(TRIM(name)) = LOWER(?)')
    .bind(trimmed)
    .first();
  if (existing) return { id: existing.id, name: existing.name, created: false };
  const created = await createProduct(db, { name: trimmed });
  return { ...created, created: true };
}

// Exact match on (product_id, variant_label) -- the same uniqueness key the
// variants table already enforces. Reuses the existing variant if one
// matches instead of failing on the UNIQUE constraint.
export async function getOrCreateVariant(db, productId, variantLabel, attributes) {
  const existing = await db
    .prepare('SELECT id FROM variants WHERE product_id = ? AND variant_label = ?')
    .bind(productId, variantLabel)
    .first();
  if (existing) return { id: existing.id, productId, variantLabel, created: false };
  const created = await createVariant(db, { productId, variantLabel, attributes });
  return { ...created, created: true };
}

// Next free batch_number for a variant, as a plain incrementing string --
// manual batch numbers aren't required to be sequential, so this loops past
// any that were already taken by hand instead of assuming COUNT+1 is free.
export async function nextBatchNumber(db, variantId) {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM production_batches WHERE variant_id = ?')
    .bind(variantId)
    .first();
  let n = Number(row.n) + 1;
  while (
    await db
      .prepare('SELECT 1 FROM production_batches WHERE variant_id = ? AND batch_number = ?')
      .bind(variantId, String(n))
      .first()
  ) {
    n++;
  }
  return String(n);
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

export async function createProductionBatch(db, { variantId, batchNumber, plannedQuantity, unitCostCents, producerName, notes, orderLineId }) {
  if (!variantId || !batchNumber || !plannedQuantity) {
    throw new ValidationError('variantId, batchNumber, and plannedQuantity are required.');
  }
  const id = newInternalId();
  await db
    .prepare(
      `INSERT INTO production_batches (id, variant_id, batch_number, planned_quantity, unit_cost_cents, producer_name, notes, order_line_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, variantId, String(batchNumber), plannedQuantity, unitCostCents ?? null, producerName ?? null, notes ?? null, orderLineId ?? null)
    .run();
  return { id, variantId, batchNumber: String(batchNumber), plannedQuantity, orderLineId: orderLineId ?? null };
}

export async function listProductionBatches(db) {
  const { results } = await db
    .prepare(
      `SELECT pb.id, pb.batch_number, pb.planned_quantity, pb.notes, p.name AS product_name, v.variant_label
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

// Cheap read-only counts for the dashboard -- a single query, no per-row
// work, so it's safe to call on every Home page load.
export async function getDashboardStats(db) {
  const row = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT COUNT(*) FROM variants) AS variants,
        (SELECT COUNT(*) FROM production_batches) AS batches,
        (SELECT COUNT(*) FROM units) AS units,
        (SELECT COUNT(*) FROM units WHERE current_disposition = 'AVAILABLE') AS availableUnits,
        (SELECT COUNT(*) FROM locations) AS locations`
    )
    .first();
  return {
    products: Number(row.products),
    variants: Number(row.variants),
    batches: Number(row.batches),
    units: Number(row.units),
    availableUnits: Number(row.availableUnits),
    locations: Number(row.locations),
  };
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

// Includes location -- Field Simulation Study G1 (partial shipment) found
// that this view previously had no way to show an allocation/location
// breakdown for a batch without looking up every unit individually.
export async function listUnitsForBatch(db, batchId) {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.human_code, u.internal_token, u.current_disposition, u.label_confirmed_at,
              u.current_location_id, l.name AS location_name
       FROM units u
       LEFT JOIN locations l ON l.id = u.current_location_id
       WHERE u.batch_id = ? ORDER BY u.human_code`
    )
    .bind(batchId)
    .all();
  return results;
}
