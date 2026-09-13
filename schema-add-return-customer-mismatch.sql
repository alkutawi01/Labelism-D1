-- Field Simulation P5 (Customer Verification): return_intakes already had
-- an optional customer_id, but scanning never checked a unit against it.
-- Persisted (not just returned at scan time) so anyone reviewing the
-- intake's unit list later -- not just whoever did the scan -- can see
-- which units didn't actually belong to the customer this intake is for.
ALTER TABLE return_intake_units ADD COLUMN customer_mismatch INTEGER NOT NULL DEFAULT 0;
