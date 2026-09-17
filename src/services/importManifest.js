// Document Import -- turns a small, versioned JSON contract ("Labelism
// Import Manifest v1") into Products/Variants/ProductionBatches.
//
// Origin: Izzat wants Labelism to absorb arbitrary source documents (job
// orders, invoices, quotations, delivery orders, ...) without hardcoding a
// parser per document type. The AI step (an external chatbot the user
// already has -- no API/internet dependency inside Labelism) reads the
// document and produces this manifest; Labelism only ever parses this one
// fixed shape. See public/import.html for the prompt template shown to the
// user, and HANDOFF.md / the Director thread for the full design history.
//
// Deliberately simplified per Izzat's 2026-09-12 instruction: every source
// document reduces to Product + Variant, which Labelism already models in
// full (product_dimensions, variant_attributes). The only genuinely new
// thing a document can carry is context that isn't a first-class Labelism
// concept (planned per-unit names, a project/customer reference) -- that
// goes into a plain "notes" field on the batch, not a new schema layer.
//
// Important: this only creates Products/Variants/ProductionBatches (an
// order's planned quantity). It never creates Units directly -- Units are
// only ever created via the existing Receiving flow, once physical goods
// are actually observed and reconciled. Collapsing that distinction would
// violate the "Intent (planned) != Observation != Accepted quantity"
// invariant (see HANDOFF.md) that the rest of Labelism depends on: a job
// order is an intent, not evidence that anything physically exists yet.
import { ValidationError } from '../domain/validation.js';
import { getOrCreateProduct, getOrCreateVariant, addProductDimensions, nextBatchNumber, createProductionBatch } from './catalog.js';

const SUPPORTED_SCHEMA_VERSION = '1';

function deriveLabel(dimensions, attributes) {
  const order = dimensions.length ? dimensions : Object.keys(attributes);
  const parts = order.filter((d) => attributes[d] !== undefined).map((d) => attributes[d]);
  return parts.join(' / ');
}

// Parses and validates a raw (client-supplied) manifest object into a
// normalized shape. Throws ValidationError with a specific, indexed message
// on the first problem found -- this is untrusted input (AI-generated),
// so every field is checked before anything is written.
export function normalizeManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('Import manifest must be a JSON object.');
  }
  if (raw.schemaVersion !== undefined && String(raw.schemaVersion) !== SUPPORTED_SCHEMA_VERSION) {
    throw new ValidationError(
      `Unsupported schemaVersion "${raw.schemaVersion}" -- this Labelism only understands Import Manifest v${SUPPORTED_SCHEMA_VERSION}.`
    );
  }
  if (!Array.isArray(raw.products) || raw.products.length === 0) {
    throw new ValidationError('Import manifest must have a non-empty "products" array.');
  }

  const products = raw.products.map((p, pIdx) => {
    const where = `products[${pIdx}]`;
    if (!p || typeof p !== 'object' || !p.name || !String(p.name).trim()) {
      throw new ValidationError(`${where}.name is required.`);
    }
    const dimensions = Array.isArray(p.dimensions)
      ? [...new Set(p.dimensions.map((d) => String(d).trim()).filter(Boolean))]
      : [];
    if (!Array.isArray(p.variants) || p.variants.length === 0) {
      throw new ValidationError(`${where} ("${p.name}") must have a non-empty "variants" array.`);
    }

    const variants = p.variants.map((v, vIdx) => {
      const vwhere = `${where}.variants[${vIdx}]`;
      if (!v || typeof v !== 'object') throw new ValidationError(`${vwhere} must be an object.`);

      const quantity = Number(v.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new ValidationError(`${vwhere}.quantity must be a whole number >= 1.`);
      }

      const attributes = {};
      if (v.attributes !== undefined) {
        if (typeof v.attributes !== 'object' || Array.isArray(v.attributes) || v.attributes === null) {
          throw new ValidationError(`${vwhere}.attributes must be an object of dimension name -> value.`);
        }
        for (const [k, val] of Object.entries(v.attributes)) {
          if (val === undefined || val === null || String(val).trim() === '') continue;
          attributes[String(k).trim()] = String(val).trim();
        }
      }
      const hasAttrs = Object.keys(attributes).length > 0;
      let label = v.label !== undefined && v.label !== null ? String(v.label).trim() : '';
      if (hasAttrs) label = deriveLabel(dimensions, attributes);
      if (!label) {
        throw new ValidationError(`${vwhere} needs "attributes" (with at least one non-empty value) or a "label".`);
      }

      let unitNames = [];
      if (v.unitNames !== undefined) {
        if (!Array.isArray(v.unitNames)) throw new ValidationError(`${vwhere}.unitNames must be an array of strings.`);
        unitNames = v.unitNames.map((n) => String(n).trim()).filter(Boolean);
        if (unitNames.length > quantity) {
          throw new ValidationError(
            `${vwhere}.unitNames has ${unitNames.length} name(s) but quantity is only ${quantity}.`
          );
        }
      }

      return { attributes, label, quantity, unitNames };
    });

    return { name: String(p.name).trim(), dimensions, variants };
  });

  const context = raw.context !== undefined && raw.context !== null ? String(raw.context).trim() : '';
  return { context, products };
}

// Read-only: reports what applyManifest() would do, without writing
// anything. Lets the operator confirm the AI's interpretation of the
// document before it touches the database.
export async function previewManifest(db, manifest) {
  const productPreviews = [];
  const totals = {
    newProducts: 0, existingProducts: 0,
    newVariants: 0, existingVariants: 0,
    productionBatches: 0,
    plannedUnits: 0, namedUnits: 0,
  };

  for (const p of manifest.products) {
    const existingProduct = await db
      .prepare('SELECT id FROM products WHERE LOWER(TRIM(name)) = LOWER(?)')
      .bind(p.name)
      .first();
    existingProduct ? totals.existingProducts++ : totals.newProducts++;

    const variantPreviews = [];
    for (const v of p.variants) {
      let existingVariant = null;
      if (existingProduct) {
        existingVariant = await db
          .prepare('SELECT id FROM variants WHERE product_id = ? AND variant_label = ?')
          .bind(existingProduct.id, v.label)
          .first();
      }
      existingVariant ? totals.existingVariants++ : totals.newVariants++;
      totals.productionBatches++;
      totals.plannedUnits += v.quantity;
      totals.namedUnits += v.unitNames.length;

      variantPreviews.push({
        label: v.label,
        attributes: v.attributes,
        quantity: v.quantity,
        namedCount: v.unitNames.length,
        isNewVariant: !existingVariant,
      });
    }

    productPreviews.push({
      name: p.name,
      isNewProduct: !existingProduct,
      newDimensions: p.dimensions,
      variants: variantPreviews,
    });
  }

  return { context: manifest.context, products: productPreviews, totals };
}

// Writes Products / dimensions / Variants / ProductionBatches. Never
// creates Units -- see the module comment above for why that boundary
// matters. Sequential awaits (not a single db.batch()) because each step
// may need to read back an id it just decided to reuse or create; this
// endpoint is single-operator/low-frequency, unlike the concurrent-scan
// paths in units.js that need atomic batching.
import { createOrderWithLabels } from './orders.js';

export async function applyManifest(db, manifest, actor) {
  const customerName = manifest.customerName || manifest.context || 'Import Customer';
  const orderReference = manifest.orderReference || manifest.context || `IMPORT-${Date.now()}`;

  const items = [];
  for (const p of manifest.products) {
    for (const v of p.variants) {
      items.push({
        productName: p.name,
        variantLabel: v.label,
        dimensions: p.dimensions,
        attributes: v.attributes,
        quantity: v.quantity,
        unitNames: v.unitNames || [],
        batches: v.batches || [{ quantity: v.quantity }],
      });
    }
  }

  const result = await createOrderWithLabels(db, {
    customerName,
    orderReference,
    items,
    actor: actor ?? 'system',
  });

  return { ...result, actor: actor ?? 'system' };
}
