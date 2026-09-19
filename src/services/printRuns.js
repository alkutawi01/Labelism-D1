// Print runs -- see schema-add-print-runs.sql.
//
// Izzat's workflow: an order creates every label up front (1 unit ordered =
// 1 label generated). At the print step staff tick which variations to print
// and how many of each; that selection is recorded as "Cetakan N" of the order.
// Whatever is not selected stays unprinted for a later batch. Packing then
// works against ONE batch and only expects the labels printed in it, so
// printing part of an order no longer makes packing think the rest is missing.
import { newInternalId } from '../db/d1.js';
import { ValidationError } from '../domain/validation.js';
import { scanUnitIntoShipment, assertPlannedWithinOutstanding } from './shipments.js';

// A unit counts as packed if it sits in a shipment of this run, or in any
// shipment that has not been dispatched (packed the old way, before runs).
const PACKED_SQL = `EXISTS (
  SELECT 1 FROM shipment_units su JOIN shipments s ON s.id = su.shipment_id
  WHERE su.unit_id = u.id AND (s.print_run_id = ?1 OR s.status != 'DISPATCHED')
)`;

// ---------------------------------------------------------------------------
// Print step
// ---------------------------------------------------------------------------

// Every order with how many of its labels are still unprinted, so the print
// screen can default to orders that still need printing.
export async function listPrintOrders(db) {
  // One pass over the units, grouped per order. (Three correlated subqueries
  // per order took ~30s once a few hundred orders with big batches existed.)
  const { results } = await db
    .prepare(
      `SELECT o.id, o.customer_id, o.order_reference, o.created_at, c.name AS customer_name,
              COUNT(u.id) AS total_units,
              COALESCE(SUM(CASE WHEN u.print_run_id IS NULL THEN 1 ELSE 0 END), 0) AS unprinted_units,
              COALESCE(SUM(CASE WHEN u.label_confirmed_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS attached_units
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN order_lines ol ON ol.order_id = o.id
       LEFT JOIN production_batches pb ON pb.order_line_id = ol.id
       LEFT JOIN units u ON u.batch_id = pb.id
       GROUP BY o.id
       ORDER BY o.rowid DESC`
    )
    .all();
  return results;
}

// One row per variation (per recipient group, when the order has groups):
// how many labels exist, how many are already printed, how many remain.
export async function getPrintOverview(db, orderId) {
  const order = await db
    .prepare(
      `SELECT o.id, o.order_reference, o.notes, c.name AS customer_name
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`
    )
    .bind(orderId)
    .first();
  if (!order) return null;

  const { results: rows } = await db
    .prepare(
      `SELECT pb.id AS batch_id, pb.order_line_id, pb.batch_label AS group_label,
              p.name AS product_name, v.variant_label,
              (SELECT COUNT(*) FROM units u WHERE u.batch_id = pb.id) AS total,
              (SELECT COUNT(*) FROM units u WHERE u.batch_id = pb.id AND u.print_run_id IS NOT NULL) AS printed
       FROM production_batches pb
       JOIN order_lines ol ON ol.id = pb.order_line_id
       JOIN variants v ON v.id = pb.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE ol.order_id = ?
       ORDER BY ol.rowid, pb.rowid`
    )
    .bind(orderId)
    .all();

  const { results: runs } = await db
    .prepare(
      `SELECT pr.id, pr.run_number, pr.actor, pr.created_at,
              (SELECT COUNT(*) FROM units u WHERE u.print_run_id = pr.id) AS label_count,
              (SELECT COUNT(*) FROM units u WHERE u.print_run_id = pr.id AND u.label_confirmed_at IS NOT NULL) AS attached_count,
              (SELECT COUNT(*) FROM units u WHERE u.print_run_id = pr.id AND EXISTS (
                 SELECT 1 FROM shipment_units su JOIN shipments s ON s.id = su.shipment_id
                 WHERE su.unit_id = u.id AND (s.print_run_id = pr.id OR s.status != 'DISPATCHED'))) AS packed_count
       FROM print_runs pr WHERE pr.order_id = ? ORDER BY pr.run_number`
    )
    .bind(orderId)
    .all();

  return {
    order,
    rows: rows.map((r) => ({ ...r, unprinted: r.total - r.printed })),
    runs,
  };
}

// Records a print run: for each selected row, the next `quantity` unprinted
// labels (lowest serial first) become part of the new batch. Returns the run;
// the caller fetches its labels with getPrintRun() to render and print them.
export async function createPrintRun(db, orderId, { selections, actor }) {
  if (!Array.isArray(selections) || !selections.length) {
    throw new ValidationError('Pilih sekurang-kurangnya satu baris untuk dicetak.');
  }
  const order = await db.prepare('SELECT id FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) return { notFound: true };

  const wanted = new Map();
  for (const s of selections) {
    const quantity = Number(s.quantity);
    if (!s.batchId || !Number.isInteger(quantity) || quantity < 1) {
      throw new ValidationError('Kuantiti untuk dicetak mesti nombor bulat sekurang-kurangnya 1.');
    }
    wanted.set(s.batchId, (wanted.get(s.batchId) || 0) + quantity);
  }

  const runId = newInternalId();
  const statements = [];
  for (const [batchId, quantity] of wanted) {
    const row = await db
      .prepare(
        `SELECT pb.id, p.name AS product_name, v.variant_label,
                (SELECT COUNT(*) FROM units u WHERE u.batch_id = pb.id AND u.print_run_id IS NULL) AS unprinted
         FROM production_batches pb
         JOIN order_lines ol ON ol.id = pb.order_line_id
         JOIN variants v ON v.id = pb.variant_id
         JOIN products p ON p.id = v.product_id
         WHERE pb.id = ? AND ol.order_id = ?`
      )
      .bind(batchId, orderId)
      .first();
    if (!row) throw new ValidationError('Baris yang dipilih bukan sebahagian daripada tempahan ini.');
    if (quantity > row.unprinted) {
      throw new ValidationError(
        `${row.product_name} · ${row.variant_label}: hanya ${row.unprinted} label belum dicetak, tidak boleh cetak ${quantity}.`
      );
    }
    statements.push(
      db
        .prepare(
          `UPDATE units SET print_run_id = ?
           WHERE id IN (SELECT id FROM units WHERE batch_id = ? AND print_run_id IS NULL ORDER BY human_code LIMIT ?)`
        )
        .bind(runId, batchId, quantity)
    );
  }

  const { n } = await db
    .prepare('SELECT COALESCE(MAX(run_number), 0) AS n FROM print_runs WHERE order_id = ?')
    .bind(orderId)
    .first();
  const runNumber = Number(n) + 1;
  statements.unshift(
    db
      .prepare('INSERT INTO print_runs (id, order_id, run_number, actor) VALUES (?, ?, ?, ?)')
      .bind(runId, orderId, runNumber, actor ?? null)
  );

  await db.batch(statements);
  return { id: runId, orderId, runNumber };
}

// A run with everything needed to render its labels.
export async function getPrintRun(db, runId) {
  const run = await db
    .prepare(
      `SELECT pr.id, pr.order_id, pr.run_number, pr.created_at, o.order_reference, c.name AS customer_name
       FROM print_runs pr
       JOIN orders o ON o.id = pr.order_id
       JOIN customers c ON c.id = o.customer_id
       WHERE pr.id = ?`
    )
    .bind(runId)
    .first();
  if (!run) return null;

  const { results: units } = await db
    .prepare(
      `SELECT u.id, u.human_code, u.internal_token, u.recipient_name, u.label_confirmed_at,
              pb.batch_label AS group_label, p.name AS product_name, v.variant_label
       FROM units u
       JOIN production_batches pb ON pb.id = u.batch_id
       JOIN order_lines ol ON ol.id = pb.order_line_id
       JOIN variants v ON v.id = pb.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE u.print_run_id = ?
       ORDER BY ol.rowid, pb.rowid, u.human_code`
    )
    .bind(runId)
    .all();

  return { ...run, units };
}

// ---------------------------------------------------------------------------
// Packing, against one print run (batch)
// ---------------------------------------------------------------------------

export async function getRunPacking(db, runId) {
  const run = await db
    .prepare(
      `SELECT pr.id, pr.order_id, pr.run_number, o.order_reference, c.name AS customer_name
       FROM print_runs pr
       JOIN orders o ON o.id = pr.order_id
       JOIN customers c ON c.id = o.customer_id
       WHERE pr.id = ?`
    )
    .bind(runId)
    .first();
  if (!run) return null;

  const { results: rows } = await db
    .prepare(
      `SELECT pb.id AS batch_id, pb.batch_label AS group_label, p.name AS product_name, v.variant_label,
              COUNT(*) AS total,
              SUM(CASE WHEN u.label_confirmed_at IS NOT NULL THEN 1 ELSE 0 END) AS attached,
              SUM(CASE WHEN ${PACKED_SQL} THEN 1 ELSE 0 END) AS packed
       FROM units u
       JOIN production_batches pb ON pb.id = u.batch_id
       JOIN order_lines ol ON ol.id = pb.order_line_id
       JOIN variants v ON v.id = pb.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE u.print_run_id = ?1
       GROUP BY pb.id
       ORDER BY ol.rowid, pb.rowid`
    )
    .bind(runId)
    .all();

  const planned = rows.reduce((s, r) => s + Number(r.total), 0);
  const packed = rows.reduce((s, r) => s + Number(r.packed), 0);
  const { open } = await db
    .prepare("SELECT COUNT(*) AS open FROM shipments WHERE print_run_id = ? AND status = 'OPEN'")
    .bind(runId)
    .first();

  return {
    run,
    rows: rows.map((r) => ({ ...r, total: Number(r.total), attached: Number(r.attached), packed: Number(r.packed) })),
    planned,
    packed,
    missing: planned - packed,
    openShipments: Number(open),
  };
}

// Opens (or resumes) packing for the run. The schema allows a shipment to
// cover one order line only, so this makes one per line in the run behind
// the scenes; staff only ever see one packing session for the batch.
export async function startRunPacking(db, runId) {
  const status = await getRunPacking(db, runId);
  if (!status) return { notFound: true };

  const { results: lines } = await db
    .prepare(
      `SELECT ol.id AS order_line_id, COUNT(*) AS unpacked
       FROM units u
       JOIN production_batches pb ON pb.id = u.batch_id
       JOIN order_lines ol ON ol.id = pb.order_line_id
       WHERE u.print_run_id = ?1 AND NOT ${PACKED_SQL}
       GROUP BY ol.id`
    )
    .bind(runId)
    .all();
  if (!lines.length) {
    throw new ValidationError('Semua label dalam cetakan ini sudah discan untuk packing.');
  }

  const reference = `Packing ${status.run.order_reference} · Cetakan ${status.run.run_number}`;
  const statements = [];
  for (const line of lines) {
    const existing = await db
      .prepare("SELECT id FROM shipments WHERE print_run_id = ? AND order_line_id = ? AND status = 'OPEN'")
      .bind(runId, line.order_line_id)
      .first();
    // Packing plans real units, so this should always hold; it is checked so an
    // over-plan can never slip in through this path either.
    if (!existing) await assertPlannedWithinOutstanding(db, line.order_line_id, Number(line.unpacked), '');
    if (existing) {
      const { scanned } = await db
        .prepare('SELECT COUNT(*) AS scanned FROM shipment_units WHERE shipment_id = ?')
        .bind(existing.id)
        .first();
      await assertPlannedWithinOutstanding(db, line.order_line_id, Number(scanned) + Number(line.unpacked), existing.id);
      statements.push(
        db
          .prepare('UPDATE shipments SET planned_quantity = ? WHERE id = ?')
          .bind(Number(scanned) + Number(line.unpacked), existing.id)
      );
    } else {
      statements.push(
        db
          .prepare('INSERT INTO shipments (id, order_line_id, reference, planned_quantity, print_run_id) VALUES (?, ?, ?, ?, ?)')
          .bind(newInternalId(), line.order_line_id, reference, Number(line.unpacked), runId)
      );
    }
  }
  await db.batch(statements);
  return getRunPacking(db, runId);
}

export async function scanRunPacking(db, runId, { code, actor }) {
  const status = await getRunPacking(db, runId);
  if (!status) return { notFound: true };
  if (!code || !String(code).trim()) throw new ValidationError('Kod label diperlukan.');
  const trimmed = String(code).trim();

  const { results: matches } = await db
    .prepare(
      `SELECT u.*, pb.order_line_id, p.name AS product_name, v.variant_label
       FROM units u
       JOIN production_batches pb ON pb.id = u.batch_id
       JOIN variants v ON v.id = pb.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE u.human_code = ?1 OR u.internal_token = ?1 OR u.public_token = ?1`
    )
    .bind(trimmed)
    .all();
  if (!matches.length) throw new ValidationError('Label ini tidak dikenali.');

  const inRun = matches.filter((m) => m.print_run_id === runId);
  let unit;
  if (inRun.length === 1) {
    unit = inRun[0];
  } else if (inRun.length > 1) {
    throw new ValidationError(`Kod "${trimmed}" sepadan dengan lebih daripada satu unit. Scan QR, bukan taip kod.`);
  } else {
    unit = matches[0];
  }

  if (unit.print_run_id !== runId) {
    if (!unit.print_run_id) {
      throw new ValidationError(`Unit ${unit.human_code} (${unit.product_name} · ${unit.variant_label}) belum dicetak dalam mana-mana cetakan.`);
    }
    const other = await db
      .prepare(
        `SELECT pr.run_number, pr.order_id, o.order_reference, c.name AS customer_name
         FROM print_runs pr JOIN orders o ON o.id = pr.order_id JOIN customers c ON c.id = o.customer_id
         WHERE pr.id = ?`
      )
      .bind(unit.print_run_id)
      .first();
    if (other && other.order_id !== status.run.order_id) {
      throw new ValidationError(`Label ini milik tempahan "${other.order_reference}" (${other.customer_name}), bukan tempahan ini.`);
    }
    throw new ValidationError(`Label ini dalam Cetakan ${other ? other.run_number : '?'}, bukan Cetakan ${status.run.run_number}.`);
  }

  const shipment = await db
    .prepare("SELECT id FROM shipments WHERE print_run_id = ? AND order_line_id = ? AND status = 'OPEN'")
    .bind(runId, unit.order_line_id)
    .first();
  if (!shipment) {
    const already = await db
      .prepare(
        `SELECT 1 FROM shipment_units su JOIN shipments s ON s.id = su.shipment_id
         WHERE su.unit_id = ? AND s.print_run_id = ?`
      )
      .bind(unit.id, runId)
      .first();
    if (already) {
      return { unitId: unit.id, humanCode: unit.human_code, product: `${unit.product_name} · ${unit.variant_label}`, alreadyScanned: true, status };
    }
    throw new ValidationError('Tiada sesi packing yang terbuka. Tekan "Mula Scan Packing" dahulu.');
  }

  if (!unit.label_confirmed_at) {
    throw new ValidationError(`Unit ${unit.human_code} (${unit.product_name} · ${unit.variant_label}) belum disahkan ditampal. Sahkan di Cetak & Tampal dahulu.`);
  }

  const result = await scanUnitIntoShipment(db, shipment.id, { code: unit.internal_token, actor });
  return { ...result, status: await getRunPacking(db, runId) };
}

// Ends the packing session for the run. Names every label in the batch that
// was not scanned, and whether it was ever confirmed attached -- "never
// attached" means the garment is not finished yet, "attached but not
// scanned" means it is genuinely missing at packing.
export async function closeRunPacking(db, runId) {
  const before = await getRunPacking(db, runId);
  if (!before) return { notFound: true };
  if (!before.openShipments) throw new ValidationError('Tiada sesi packing yang terbuka untuk cetakan ini.');

  await db
    .prepare("UPDATE shipments SET status = 'CLOSED', closed_at = datetime('now') WHERE print_run_id = ? AND status = 'OPEN'")
    .bind(runId)
    .run();

  const { results: missingUnits } = await db
    .prepare(
      `SELECT u.human_code, v.variant_label, pb.batch_label AS group_label,
              CASE WHEN u.label_confirmed_at IS NOT NULL THEN 1 ELSE 0 END AS attached
       FROM units u
       JOIN production_batches pb ON pb.id = u.batch_id
       JOIN order_lines ol ON ol.id = pb.order_line_id
       JOIN variants v ON v.id = pb.variant_id
       WHERE u.print_run_id = ?1 AND NOT ${PACKED_SQL}
       ORDER BY ol.rowid, pb.rowid, u.human_code`
    )
    .bind(runId)
    .all();

  const after = await getRunPacking(db, runId);
  return {
    runId,
    runNumber: after.run.run_number,
    planned: after.planned,
    packed: after.packed,
    missing: after.missing,
    missingUnits: missingUnits.map((m) => ({ ...m, attached: Boolean(m.attached) })),
  };
}

// Undo a print run whose labels never came out of the printer (cancelled
// dialog, paper jam, wrong size). Its labels go back to "unprinted" so they
// can be printed again in a new run. Refused once any label of the run has
// been attached or packing has started, because physical labels exist then.
export async function cancelPrintRun(db, runId) {
  const run = await db.prepare('SELECT id, run_number FROM print_runs WHERE id = ?').bind(runId).first();
  if (!run) return { notFound: true };

  const attached = await db
    .prepare('SELECT COUNT(*) AS n FROM units WHERE print_run_id = ? AND label_confirmed_at IS NOT NULL')
    .bind(runId)
    .first();
  if (attached.n > 0) {
    throw new ValidationError(
      `Cetakan ${run.run_number} tidak boleh dibatalkan kerana ${attached.n} label sudah ditampal. Guna "Cetak semula" untuk yang belum ditampal.`
    );
  }
  const packing = await db.prepare('SELECT COUNT(*) AS n FROM shipments WHERE print_run_id = ?').bind(runId).first();
  if (packing.n > 0) {
    throw new ValidationError(`Cetakan ${run.run_number} tidak boleh dibatalkan kerana sesi packing sudah bermula.`);
  }

  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM units WHERE print_run_id = ?').bind(runId).first();
  await db.batch([
    db.prepare('UPDATE units SET print_run_id = NULL WHERE print_run_id = ?').bind(runId),
    db.prepare('DELETE FROM print_runs WHERE id = ?').bind(runId),
  ]);
  return { cancelled: true, runNumber: run.run_number, releasedLabels: n };
}
