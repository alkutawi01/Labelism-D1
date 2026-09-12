-- Variant Dimensions Pass -- additive only, per Director design agreed
-- 2026-09-11: editor-defined dimensions per product (no universal
-- Size/Color hardcoded), variant_attributes remains the actual value
-- store, no Cartesian auto-generation of combinations.
CREATE TABLE product_dimensions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, name)
);
