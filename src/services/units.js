// Unit lookup, label confirmation, and event recording -- the concurrency-
// critical path validated by the D1 spike (see PROGRESS.md). Every write
// here goes through db.batch() so the event insert and projection update
// commit or fail together, same guarantee as withTransaction() in the
// Postgres version.
import { newInternalId, buildEventBatch } from '../db/d1.js';
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

export async function lookupUnit(db, code) {
  const unit = await db
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
    .first();
  if (!unit) return null;

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
