// Document Import -- turns a small, versioned JSON contract ("Labelism
// Import Manifest v1") into Customer/Order/OrderLines/ProductionBatches/Units.
//
// Origin: Izzat wants Labelism to absorb arbitrary source documents (job
// orders, invoices, quotations, delivery orders, ...) without hardcoding a
// parser per document type. The AI step (an external chatbot the user
// already has -- no API/internet dependency inside Labelism) reads the
// document and produces this manifest; Labelism only ever parses this one
// fixed shape.
//
// Manifest contract (schemaVersion: "1"):
// {
//   "schemaVersion": "1",        // optional, must be "1" if present
//   "customerName": "...",       // required: name of customer to create/lookup
//   "orderReference": "...",     // required: invoice/PO reference
//   "products": [
//     {
//       "name": "...",
//       "dimensions": ["Saiz"],   // optional list of dimension names
//       "variants": [
//         {
//           "label": "Saiz M",
//           "quantity": 500,
//           "unitNames": ["Ahmad", ...],  // optional, 1-to-1 recipient names
//           "batches": [                  // optional phased/grouped breakdown
//             { "quantity": 300 },
//             { "quantity": 200, "batchNumber": "SK Sekolah A" }  // batchNumber
//               // is a free-text name, not just a sequence number -- use it
//               // to label a batch by recipient group (e.g. one batch per
//               // school in a bulk order), not only by print phase.
//           ]
//         }
//       ]
//     }
//   ]
// }
import { ValidationError } from '../domain/validation.js';
import { createOrderWithLabels } from './orders.js';

const SUPPORTED_SCHEMA_VERSION = '1';

function deriveLabel(dimensions, attributes) {
  const order = dimensions.length ? dimensions : Object.keys(attributes);
  const parts = order.filter((d) => attributes[d] !== undefined).map((d) => attributes[d]);
  return parts.join(' / ');
}

// Parses and validates a raw (client-supplied) manifest object into a
// normalized shape that preserves ALL identity fields.
// Throws ValidationError on the first problem found.
export function normalizeManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('Import manifest must be a JSON object.');
  }
  if (raw.schemaVersion !== undefined && String(raw.schemaVersion) !== SUPPORTED_SCHEMA_VERSION) {
    throw new ValidationError(
      `Unsupported schemaVersion "${raw.schemaVersion}" -- this Labelism only understands Import Manifest v${SUPPORTED_SCHEMA_VERSION}.`
    );
  }

  // --- Customer identity ---
  const customerName = raw.customerName !== undefined && raw.customerName !== null
    ? String(raw.customerName).trim()
    : '';
  if (!customerName) {
    throw new ValidationError('Import manifest requires "customerName" (non-empty string).');
  }

  // --- Order reference ---
  const orderReference = raw.orderReference !== undefined && raw.orderReference !== null
    ? String(raw.orderReference).trim()
    : '';
  if (!orderReference) {
    throw new ValidationError('Import manifest requires "orderReference" (non-empty string).');
  }

  // --- Products ---
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

      // --- Phased batch breakdown (optional) ---
      let batches = null;
      if (v.batches !== undefined) {
        if (!Array.isArray(v.batches) || v.batches.length === 0) {
          throw new ValidationError(`${vwhere}.batches must be a non-empty array if provided.`);
        }
        let batchSum = 0;
        batches = v.batches.map((b, bIdx) => {
          const bqty = Number(b.quantity);
          if (!Number.isInteger(bqty) || bqty < 1) {
            throw new ValidationError(`${vwhere}.batches[${bIdx}].quantity must be a whole number >= 1.`);
          }
          batchSum += bqty;
          // batchNumber doubles as a batch NAME (e.g. a school name for a
          // KEMAS-style order split across 100 recipients), not just a
          // sequence number -- orders.js's createOrderWithLabels already
          // accepts arbitrary strings here, this was just being dropped on
          // the way in from the AI-generated manifest.
          let batchNumber;
          if (b.batchNumber !== undefined && b.batchNumber !== null) {
            batchNumber = String(b.batchNumber).trim();
            if (!batchNumber) throw new ValidationError(`${vwhere}.batches[${bIdx}].batchNumber must be a non-empty string if provided.`);
          }
          let batchUnitNames;
          if (b.unitNames !== undefined) {
            if (!Array.isArray(b.unitNames)) throw new ValidationError(`${vwhere}.batches[${bIdx}].unitNames must be an array of strings.`);
            batchUnitNames = b.unitNames.map((n) => String(n).trim()).filter(Boolean);
            if (batchUnitNames.length > bqty) {
              throw new ValidationError(`${vwhere}.batches[${bIdx}].unitNames has ${batchUnitNames.length} name(s) but this batch's quantity is only ${bqty}.`);
            }
          }
          return {
            quantity: bqty,
            ...(batchNumber ? { batchNumber } : {}),
            ...(batchUnitNames ? { unitNames: batchUnitNames } : {}),
          };
        });
        if (batchSum > quantity) {
          throw new ValidationError(
            `${vwhere}.batches sum (${batchSum}) exceeds variant quantity (${quantity}).`
          );
        }
      }

      return { attributes, label, quantity, unitNames, batches };
    });

    return { name: String(p.name).trim(), dimensions, variants };
  });

  // context is still accepted for backward compat but is not required
  const context = raw.context !== undefined && raw.context !== null ? String(raw.context).trim() : '';
  return { customerName, orderReference, context, products };
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
      const numBatches = v.batches ? v.batches.length : 1;
      totals.productionBatches += numBatches;
      totals.plannedUnits += v.quantity;
      totals.namedUnits += v.unitNames.length;

      variantPreviews.push({
        label: v.label,
        attributes: v.attributes,
        quantity: v.quantity,
        batches: v.batches ?? null,
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

  return {
    customerName: manifest.customerName,
    orderReference: manifest.orderReference,
    context: manifest.context,
    products: productPreviews,
    totals,
  };
}

// Writes Customer / Product / Dimensions / Variants / Order / OrderLines /
// ProductionBatches / Units atomically via createOrderWithLabels().
// All identity fields from the manifest (customerName, orderReference,
// batch breakdown) are preserved.
export async function applyManifest(db, manifest, actor) {
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
        // Pass phased batches if present; otherwise createOrderWithLabels
        // will generate the full quantity in a single batch.
        batches: v.batches || null,
      });
    }
  }

  const result = await createOrderWithLabels(db, {
    customerName: manifest.customerName,
    orderReference: manifest.orderReference,
    items,
    actor: actor ?? 'system',
  });

  return { ...result, actor: actor ?? 'system' };
}
