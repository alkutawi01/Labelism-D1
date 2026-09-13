-- Shipment domain -- Director-approved (2026-09-13), Phase B of the
-- Field Simulation Study's P1 (Pick & Pack) follow-up. A Shipment answers
-- "which promise (order line) is this unit fulfilling," which is a
-- DIFFERENT question from Location ("where physically is it") and from
-- Stocktake ("does what's here match what's expected"). Deliberately kept
-- to v1 limits per Director: one shipment fulfills exactly one order_line
-- (no shipment_lines table spanning several lines yet), and there is no
-- Allocation table -- "wait for evidence" per Director, still not proven
-- needed.
--
-- status is free text (no CHECK constraint), same convention as
-- disposition/event_type elsewhere in this schema -- so the vocabulary
-- (OPEN, CLOSED, DISPATCHED, ...) can grow without another migration.
CREATE TABLE shipments (
  id TEXT PRIMARY KEY,
  order_line_id TEXT NOT NULL REFERENCES order_lines(id),
  reference TEXT NOT NULL,
  planned_quantity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

-- Membership here is the source of truth for "this unit is committed to
-- fulfilling this shipment" -- distinct from disposition and location,
-- neither of which is touched by scanning a unit into a shipment.
CREATE TABLE shipment_units (
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES units(id),
  scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT,
  PRIMARY KEY (shipment_id, unit_id)
);

CREATE INDEX idx_shipment_units_unit ON shipment_units(unit_id);
