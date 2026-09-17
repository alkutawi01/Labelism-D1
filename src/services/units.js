// Unit lookup, label confirmation, and event recording -- the concurrency-
// critical path validated by the D1 spike (see PROGRESS.md). Every write
// here goes through db.batch() so the event insert and projection update
// commit or fail together, same guarantee as withTransaction() in the
// Postgres version.
import { newInternalId, newOpaqueToken, buildEventBatch } from '../db/d1.js';
import { ValidationError } from '../domain/validation.js';

// A scanned QR encodes the full scan.html URL (see label.html), so a
// phone-camera scan or a pasted decode both hand back a URL rather than
// the bare token -- pull the token out if it looks like one of our URLs,
// otherwise treat the input as a raw code (human_code or token typed/
// pasted directly).
function extractScannedCode(raw) {
  const trimmed = (raw ?? '').trim();
  try {
    const url = new URL(trimmed);
    const param = url.searchParams.get('code');
    if (param) return param;
  } catch {
    // Not a URL -- fall through, use as-is.
  }
  return trimmed;
}

// Step 1 of the P2 fix: verify the label actually attached to the physical
// object is the one this unit record expects, BEFORE confirmLabel is
// allowed to fire. Records LABEL_SCANNED_FOR_ATTACHMENT as an observation
// (matches the rest of Labelism's principle that a scan proves something
// was seen, not that a business decision was made) -- confirmLabel is the
// separate, later step that turns a verified scan into the real commitment.
export async function verifyLabelScan(db, unitId, rawCode, actor) {
  const unit = await db.prepare('SELECT * FROM units WHERE id = ?').bind(unitId).first();
  if (!unit) return { notFound: true };
  if (!rawCode) throw new ValidationError('A scanned code is required.');
  if (unit.label_confirmed_at) {
    throw new ValidationError('This label is already confirmed attached.');
  }

  const code = extractScannedCode(rawCode);
  const { results: matches } = await db
    .prepare(
      `SELECT u.*, v.variant_label, p.name AS product_name, pb.batch_number
       FROM units u
       JOIN production_batches pb ON pb.id = u.batch_id
       JOIN variants v ON v.id = pb.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE u.human_code = ?1 OR u.internal_token = ?1 OR u.public_token = ?1`
    )
    .bind(code)
    .all();

  if (!matches.length) return { verified: false, reason: 'not_found' };
  if (matches.length > 1) {
    // human_code repeats across batches -- a short typed code can't prove
    // physical identity here. Scanning the QR (internal_token, always
    // globally unique) sidesteps this entirely.
    return { verified: false, reason: 'ambiguous' };
  }

  const scanned = matches[0];
  if (scanned.id !== unitId) {
    return {
      verified: false,
      reason: 'mismatch',
      actualUnit: {
        id: scanned.id,
        humanCode: scanned.human_code,
        product: scanned.product_name,
        variant: scanned.variant_label,
        batchNumber: scanned.batch_number,
      },
    };
  }

  const eventId = newInternalId();
  const statements = buildEventBatch(db, {
    eventId,
    unitId,
    eventType: 'LABEL_SCANNED_FOR_ATTACHMENT',
    actor: actor ?? 'izzat',
  });
  await db.batch(statements);
  return { verified: true };
}

export async function confirmLabel(db, unitId, actor) {
  const unit = await db.prepare('SELECT * FROM units WHERE id = ?').bind(unitId).first();
  if (!unit) return { notFound: true };

  const now = new Date().toISOString();
  const eventId = newInternalId();
  const statements = buildEventBatch(db, {
    eventId,
    unitId,
    eventType: 'LABEL_ATTACHED_CONFIRMED',
    actor: actor ?? 'izzat',
  });
  statements.push(db.prepare('UPDATE units SET label_confirmed_at = ? WHERE id = ?').bind(now, unitId));

  await db.batch(statements);
  return { unitId, labelConfirmedAt: now };
}

// A printed label can be lost or spoiled (jammed printer, torn sticker,
// misread QR) BEFORE it ever reaches the physical object -- distinct from a
// unit going missing/damaged AFTER attachment, which is recorded via the
// normal event actions on scan.html instead. Reissuing rotates the unit's
// tokens, so the orphaned physical label (which may still be lying around
// with a scannable QR on it) permanently stops resolving to anything --
// lookupUnit's WHERE clause simply no longer matches the old value, the
// same "not found" a scan of a token that never existed would get. Only
// allowed before label_confirmed_at is set: once attachment is confirmed,
// the label IS the physical object's identity and rotating it would sever
// that link instead of protecting it.
export async function reissueLabel(db, unitId, actor) {
  const unit = await db.prepare('SELECT * FROM units WHERE id = ?').bind(unitId).first();
  if (!unit) return { notFound: true };
  if (unit.label_confirmed_at) {
    throw new ValidationError(
      'This label is already confirmed attached -- reissuing would sever a real physical identity. Use Record Damage / Confirm Missing instead.'
    );
  }

  const newInternal = newOpaqueToken();
  const newPublic = newOpaqueToken();
  const eventId = newInternalId();
  const statements = buildEventBatch(db, {
    eventId,
    unitId,
    eventType: 'LABEL_REISSUED',
    payload: { reason: 'lost_or_spoiled_before_attachment' },
    actor: actor ?? 'izzat',
  });
  statements.push(
    db.prepare('UPDATE units SET internal_token = ?, public_token = ? WHERE id = ?').bind(newInternal, newPublic, unitId)
  );

  await db.batch(statements);
  return { unitId, internalToken: newInternal, publicToken: newPublic };
}

// Izzat's correction (2026-09-17): the mandatory verifyLabelScan-before-
// confirmLabel gate below (removed) never actually caught the mismatch it
// was built for. Scanning a QR only re-reads what the label itself already
// says ("this is Ahmad's label") -- it proves nothing about which physical
// garment it ended up stuck to. If Ahmad's label gets attached to Ali's
// garment, a scan of that label still says "Ahmad" and the old gate would
// have happily confirmed it. The actual safety net is the 1:1 label/unit
// obligation itself: the mistake surfaces naturally when staff go looking
// for Ali's garment and find it has no label, because Ahmad's label used
// it up. Scanning stays useful elsewhere (verifyLabelScan, packing scans)
// for genuinely verifiable things -- "is this QR real" and "does it belong
// to this batch/order" -- just not as a forced prerequisite here.
//
// Priority 5B (Core Production Simulation), Director-approved 2026-09-14:
// a label that tears/fails AFTER attachment is confirmed is a different
// risk than reissueLabel()'s pre-attachment case -- the old physical label
// may still be lying around as a scannable object, so simply printing a
// second live QR for the same unit would mean two valid identities for one
// obligation, which is exactly the failure mode Director ruled out. His
// decision: rotate the token (old QR permanently dies, same mechanism as
// reissueLabel), but do NOT touch the unit's own identity (id/batch never
// change), and do NOT treat label_confirmed_at as an immutable "ever
// confirmed" record -- it is current-state, like current_disposition/
// current_condition, so it is cleared here to force a real re-verification
// against the NEW physical label before it can be confirmed again. The
// full history (that this unit went through a post-attachment reissue)
// survives permanently in unit_events regardless of what the current-state
// columns say. Also records DAMAGE_OBSERVED first so the reason a
// previously-confirmed unit needed a new label is preserved in the audit
// trail, per Director's expected event sequence.
export async function reissueLabelAfterAttachment(db, unitId, actor) {
  const unit = await db.prepare('SELECT * FROM units WHERE id = ?').bind(unitId).first();
  if (!unit) return { notFound: true };
  if (!unit.label_confirmed_at) {
    throw new ValidationError(
      'This unit was never confirmed attached -- use the "Lost -- Reissue" action on Print Labels instead.'
    );
  }

  await db.batch(
    buildEventBatch(db, {
      eventId: newInternalId(),
      unitId,
      eventType: 'DAMAGE_OBSERVED',
      payload: { reason: 'label_damaged_or_lost_after_attachment' },
      actor: actor ?? 'izzat',
    })
  );

  const newInternal = newOpaqueToken();
  const newPublic = newOpaqueToken();
  const statements = buildEventBatch(db, {
    eventId: newInternalId(),
    unitId,
    eventType: 'LABEL_REISSUED',
    payload: { reason: 'lost_or_spoiled_after_attachment', previousInternalToken: unit.internal_token },
    actor: actor ?? 'izzat',
  });
  statements.push(
    db.prepare('UPDATE units SET internal_token = ?, public_token = ?, label_confirmed_at = NULL WHERE id = ?')
      .bind(newInternal, newPublic, unitId)
  );
  await db.batch(statements);

  return { unitId, internalToken: newInternal, publicToken: newPublic, requiresReattachment: true };
}

// human_code is only unique WITHIN a batch (schema: UNIQUE(batch_id,
// human_code)) -- on purpose, per Izzat's explicit correction: it is a
// meaningful print-run serial ("copy #1 of this batch"), not a global
// identifier, and copy numbers legitimately repeat across different
// batches/editions (book edition 1 copy #1, edition 2 copy #1 -- both
// correctly "000001"). internal_token/public_token (what the QR actually
// encodes) ARE globally unique, so a scanned QR is never ambiguous. The
// only ambiguity risk is a human manually TYPING a short code that
// happens to match more than one batch's copy #N -- handled by returning
// every match so the caller can ask which one was meant, instead of
// silently picking one (the previous .first()-on-non-unique-key bug).
// Field Simulation debt called out three times now (P1's wrong-shipment
// scan, P4's return intake, general scan-operator workflow): lookupUnit()
// is meant to be a unit's "identity card" for a human, but only ever
// showed product/variant/batch -- never which order/customer/shipment it
// actually belongs to. Director approved this as a read-model enrichment,
// not a schema change: same joins already proven in canUnitFulfillShipment
// and Return Intake's scan, just surfaced generically wherever a unit gets
// looked up (scan.html's Return/Transfer/Damage actions included).
export async function lookupUnit(db, code) {
  const { results } = await db
    .prepare(
      `SELECT u.*, pb.batch_number, v.variant_label, p.name AS product_name, l.name AS location_name,
              o.order_reference, c.name AS customer_name
       FROM units u
       JOIN production_batches pb ON pb.id = u.batch_id
       JOIN variants v ON v.id = pb.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN locations l ON l.id = u.current_location_id
       LEFT JOIN order_lines ol ON ol.id = pb.order_line_id
       LEFT JOIN orders o ON o.id = ol.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE u.human_code = ?1 OR u.internal_token = ?1 OR u.public_token = ?1`
    )
    .bind(code)
    .all();
  if (!results.length) return null;
  if (results.length > 1) {
    return {
      ambiguous: true,
      candidates: results.map((u) => ({
        id: u.id,
        humanCode: u.human_code,
        product: u.product_name,
        variant: u.variant_label,
        batchNumber: u.batch_number,
        internalToken: u.internal_token,
      })),
    };
  }
  const unit = results[0];

  const { results: events } = await db
    .prepare('SELECT event_type, payload, actor, occurred_at, recorded_at, seq FROM unit_events WHERE unit_id = ? ORDER BY seq')
    .bind(unit.id)
    .all();

  const { results: shipments } = await db
    .prepare(
      `SELECT s.reference, s.status FROM shipment_units su
       JOIN shipments s ON s.id = su.shipment_id WHERE su.unit_id = ?`
    )
    .bind(unit.id)
    .all();

  return {
    id: unit.id,
    humanCode: unit.human_code,
    product: unit.product_name,
    variant: unit.variant_label,
    batchNumber: unit.batch_number,
    disposition: unit.current_disposition,
    condition: unit.current_condition,
    locationId: unit.current_location_id,
    locationName: unit.location_name,
    labelConfirmedAt: unit.label_confirmed_at,
    internalToken: unit.internal_token,
    orderReference: unit.order_reference,
    customerName: unit.customer_name,
    shipments,
    events,
  };
}

export async function recordUnitEvent(db, unitId, { eventType, payload, actor, disposition, condition, locationId, occurredAt }) {
  const unit = await db.prepare('SELECT * FROM units WHERE id = ?').bind(unitId).first();
  if (!unit) return { notFound: true };
  if (!eventType) throw new ValidationError('eventType is required.');

  const eventId = newInternalId();
  const statements = buildEventBatch(db, {
    eventId, unitId, eventType, payload, actor, occurredAt, disposition, condition, locationId,
  });
  const results = await db.batch(statements);
  const seq = results[0].results[0].seq;

  return { unitId, seq, eventType };
}
