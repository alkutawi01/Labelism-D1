-- A batch's free-text NAME (e.g. a school in a bulk order) is separate from
-- its batch_number. batch_number stays an auto-assigned sequence that must be
-- unique per variant (UNIQUE(variant_id, batch_number)); using it to hold
-- names meant a second order for the same product/size/school failed with a
-- unique-constraint error. batch_label has no uniqueness rule, so names can
-- repeat across orders.
ALTER TABLE production_batches ADD COLUMN batch_label TEXT;
