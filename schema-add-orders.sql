-- Domain Model Revision Pass v1 -- Director-approved design (2026-09-13),
-- following the LABELISM Field Simulation Study. Customer -> Order ->
-- OrderLine sits ALONGSIDE the existing Product/Variant/ProductionBatch/
-- Unit model, not replacing it. production_batches.order_line_id is
-- nullable so existing and future non-order production keeps working
-- unchanged (Director: "don't backfill Faris Petra -- treat it as a
-- legacy batch before the order model").
--
-- Explicitly NOT added: a "DISPATCHED" disposition value. Director
-- rejected that -- a unit leaving the premises is represented by the
-- UNIT_DISPATCHED event + current_location_id, not a new disposition
-- string, because "shipped" conflates physical movement with business
-- ownership (consignment/loan/replacement all "leave the building"
-- without being sold). disposition stays exactly as it was.
--
-- Also NOT added in this pass: UNIT_ALLOCATION (reserved-for-order-line
-- tracking). Director suggested it as a separate entity, not a status,
-- but marked it optional -- deferred per Izzat's explicit choice to keep
-- this pass to Customer/Order/OrderLine + location-scoped Stocktake.

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_info TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_reference TEXT NOT NULL,
  order_date TEXT,
  due_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- variant_id is nullable (Director-approved) -- an order line can exist
-- before the exact variant is pinned down, or reference a product-level
-- intent only.
CREATE TABLE order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id TEXT REFERENCES variants(id),
  description TEXT,
  quantity_ordered INTEGER NOT NULL,
  unit_names TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE production_batches ADD COLUMN order_line_id TEXT REFERENCES order_lines(id);

-- Reserved now per Director's instruction, so unit_events.actor_id isn't a
-- later schema surprise -- not migrating every call site to require it
-- yet (Productization Pass work); actor (free-text display label) stays
-- for backward compatibility.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE unit_events ADD COLUMN actor_id TEXT REFERENCES users(id);

-- stocktake_sessions.batch_id must become nullable (a location-scoped
-- session has no single batch) -- SQLite can't alter a column's NOT NULL
-- in place, so recreate the table. D1 does not honor
-- `PRAGMA legacy_alter_table`, so a plain RENAME TABLE here would silently
-- rewrite the FK definitions inside the two child tables
-- (stocktake_expected_units/stocktake_scans) to point at the old name --
-- so all three tables are renamed away and recreated fresh instead, each
-- child pointing at the real "stocktake_sessions" name from the start.
ALTER TABLE stocktake_sessions RENAME TO stocktake_sessions_old;
ALTER TABLE stocktake_expected_units RENAME TO stocktake_expected_units_old;
ALTER TABLE stocktake_scans RENAME TO stocktake_scans_old;

CREATE TABLE stocktake_sessions (
  id TEXT PRIMARY KEY,
  batch_id TEXT REFERENCES production_batches(id),
  location_id TEXT REFERENCES locations(id),
  status TEXT NOT NULL DEFAULT 'OPEN',
  started_by TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_by TEXT,
  closed_at TEXT
);

CREATE TABLE stocktake_expected_units (
  session_id TEXT NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES units(id),
  PRIMARY KEY (session_id, unit_id)
);

CREATE TABLE stocktake_scans (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES units(id),
  scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT,
  UNIQUE (session_id, unit_id)
);

INSERT INTO stocktake_sessions (id, batch_id, status, started_by, started_at, closed_by, closed_at)
  SELECT id, batch_id, status, started_by, started_at, closed_by, closed_at FROM stocktake_sessions_old;
INSERT INTO stocktake_expected_units (session_id, unit_id)
  SELECT session_id, unit_id FROM stocktake_expected_units_old;
INSERT INTO stocktake_scans (id, session_id, unit_id, scanned_at, actor)
  SELECT id, session_id, unit_id, scanned_at, actor FROM stocktake_scans_old;

DROP TABLE stocktake_scans_old;
DROP TABLE stocktake_expected_units_old;
DROP TABLE stocktake_sessions_old;

CREATE INDEX idx_stocktake_expected_session ON stocktake_expected_units(session_id);
CREATE INDEX idx_stocktake_scans_session ON stocktake_scans(session_id);
