CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (product_id, variant_label)
);

CREATE TABLE variant_attributes (
  variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (variant_id, key)
);

CREATE TABLE production_batches (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  batch_number TEXT NOT NULL,
  planned_quantity INTEGER NOT NULL,
  unit_cost_cents INTEGER,
  producer_name TEXT,
  planned_production_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (variant_id, batch_number)
);

CREATE TABLE batch_receipts (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  actual_quantity INTEGER NOT NULL,
  accepted_quantity INTEGER,
  rejected_quantity INTEGER,
  rejection_reason TEXT,
  notes TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE units (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  batch_receipt_id TEXT REFERENCES batch_receipts(id),
  human_code TEXT NOT NULL,
  internal_token TEXT NOT NULL,
  public_token TEXT,
  current_disposition TEXT,
  current_condition TEXT,
  current_location_id TEXT REFERENCES locations(id),
  label_confirmed_at TEXT,
  last_event_seq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (batch_id, human_code),
  UNIQUE (internal_token),
  UNIQUE (public_token)
);

CREATE TABLE unit_attributes (
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (unit_id, key)
);

CREATE TABLE unit_events (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT,
  actor TEXT,
  occurred_at TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (unit_id, seq)
);

CREATE TABLE stocktake_sessions (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES production_batches(id),
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

CREATE INDEX idx_stocktake_expected_session ON stocktake_expected_units(session_id);
CREATE INDEX idx_stocktake_scans_session ON stocktake_scans(session_id);
