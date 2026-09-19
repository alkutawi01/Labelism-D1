-- Print runs. Printing used to be invisible to the server (the button just
-- opened the browser print dialog), so nothing knew which labels had been
-- printed and packing had to expect every label in a batch, printed or not.
--
-- A print run is one "Cetak" action on an order: staff tick the variations
-- and quantities to print, and those labels become "Batch N" of that order.
-- Labels not selected stay unprinted (print_run_id IS NULL) and can go into
-- a later run. A run is also what packing works against: it only expects the
-- labels in the selected run.
CREATE TABLE print_runs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  run_number INTEGER NOT NULL,
  actor TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (order_id, run_number)
);

ALTER TABLE units ADD COLUMN print_run_id TEXT REFERENCES print_runs(id);
CREATE INDEX idx_units_print_run ON units(print_run_id);

-- A packing shipment made for a print run (NULL for shipments made the old
-- way, per order line, before print runs existed).
ALTER TABLE shipments ADD COLUMN print_run_id TEXT REFERENCES print_runs(id);

-- Existing orders: every label already confirmed attached was, by
-- definition, printed. Give each such order a Batch 1 containing those
-- labels so they stay visible to (and packable by) the new screens.
INSERT INTO print_runs (id, order_id, run_number, actor)
SELECT lower(hex(randomblob(16))), x.order_id, 1, 'migration'
FROM (
  SELECT DISTINCT ol.order_id AS order_id
  FROM units u
  JOIN production_batches pb ON pb.id = u.batch_id
  JOIN order_lines ol ON ol.id = pb.order_line_id
  WHERE u.label_confirmed_at IS NOT NULL
) x;

UPDATE units
SET print_run_id = (
  SELECT pr.id
  FROM print_runs pr
  JOIN order_lines ol ON ol.order_id = pr.order_id
  JOIN production_batches pb ON pb.order_line_id = ol.id
  WHERE pb.id = units.batch_id AND pr.run_number = 1
)
WHERE label_confirmed_at IS NOT NULL AND print_run_id IS NULL;
