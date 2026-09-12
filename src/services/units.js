// Unit lookup, label confirmation, and event recording -- the concurrency-
// critical path validated by the D1 spike (see PROGRESS.md). Every write
// here goes through db.batch() so the event insert and projection update
// commit or fail together, same guarantee as withTransaction() in the
// Postgres version.
import { newInternalId, newOpaqueToken, buildEventBatch } from '../db/d1.js';
import { ValidationError } from '../domain/validation.js';

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
export async function lookupUnit(db, code) {
  const { results } = await db
    .prepare(
      `SELECT u.*, pb.batch_number, v.variant_label, p.name AS product_name, l.name AS location_name
       FROM units u
       JOIN production_batches pb ON pb.id = u.batch_id
       JOIN variants v ON v.id = pb.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN locations l ON l.id = u.current_location_id
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
