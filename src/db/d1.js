// D1-specific plumbing only. Nothing here knows about products/units/etc --
// domain logic lives in src/domain and src/services, which take `db` as a
// plain argument rather than importing Cloudflare globals.

export function newInternalId() {
  return crypto.randomUUID();
}

export function newOpaqueToken() {
  // 16 random bytes, base64url -- same shape as the Postgres version's
  // newOpaqueToken (unguessable unit tokens for QR codes).
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Builds the two-statement batch that both the concurrency spike and the
// production port depend on: reserve the next seq for a unit (via
// SELECT MAX(seq)+1, safe here because D1 serializes all writes to one
// database through a single Durable Object -- verified in the spike, see
// PROGRESS.md) and record the event, then optionally update the unit's
// projection fields in the same atomic batch.
export function buildEventBatch(db, { eventId, unitId, eventType, payload, actor, occurredAt, disposition, condition, locationId }) {
  const statements = [
    db.prepare(
      `INSERT INTO unit_events (id, unit_id, seq, event_type, payload, actor, occurred_at)
       SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?
       FROM unit_events WHERE unit_id = ?
       RETURNING seq`
    ).bind(eventId, unitId, eventType, payload ? JSON.stringify(payload) : null, actor ?? null, occurredAt ?? null, unitId),
  ];

  const sets = [];
  const params = [];
  if (disposition !== undefined) { sets.push('current_disposition = ?'); params.push(disposition); }
  if (condition !== undefined) { sets.push('current_condition = ?'); params.push(condition); }
  if (locationId !== undefined) { sets.push('current_location_id = ?'); params.push(locationId); }
  sets.push('last_event_seq = last_event_seq + 1');

  params.push(unitId);
  statements.push(db.prepare(`UPDATE units SET ${sets.join(', ')} WHERE id = ?`).bind(...params));

  return statements;
}
