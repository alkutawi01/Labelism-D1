-- Return Intake domain -- Director-approved (2026-09-13), Field Simulation
-- Study P4-D. Return was previously a bare disposition flip (UNIT_RETURNED)
-- with no session, no order/customer context, and no distinction between
-- an expected return (unit was actually dispatched before) and a mystery
-- item. This mirrors the same pattern already proven for Stocktake
-- (counting) and Shipment (packing): a session that groups scans, plus a
-- per-unit membership row.
--
-- Deliberately kept small per Director's "jangan bina terlalu besar":
-- no replacement_of_unit_id, no warranty/refund/claim/RMA. Just intake +
-- QC decision. status is free text, same convention as everywhere else.
CREATE TABLE return_intakes (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

-- expected = 1 when the unit had a real UNIT_DISPATCHED event before being
-- scanned into this intake (answers Director's "return yang dijangka atau
-- barang misteri?" -- a unit that was never shipped out has no business
-- being "returned"). qc_outcome is filled in later, separately from the
-- scan itself -- receiving a unit physically and deciding what to do with
-- it are two different moments in real operations.
CREATE TABLE return_intake_units (
  return_intake_id TEXT NOT NULL REFERENCES return_intakes(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES units(id),
  scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT,
  expected INTEGER NOT NULL DEFAULT 0,
  qc_outcome TEXT,
  qc_decided_at TEXT,
  PRIMARY KEY (return_intake_id, unit_id)
);

CREATE INDEX idx_return_intake_units_unit ON return_intake_units(unit_id);
