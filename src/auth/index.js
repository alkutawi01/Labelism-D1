// Per-staff session auth. Originally a single shared admin password (ported
// from src/auth.js, Postgres/Express version) -- every write in the system
// was attributable only to whoever knew that one password, with a free-text
// "Working as" field staff had to remember to fill in honestly. Replaced
// with real per-staff accounts (staff_accounts table) so the session cookie
// itself carries a verified identity, and every write's `actor` comes from
// that session server-side instead of a client-supplied string (see
// routes/index.js's body() helper).
//
// The cookie is still a stateless HMAC-signed value, not a DB-backed
// session, so revoking a compromised account requires rotating
// LABELISM_SESSION_SECRET (logs everyone out) rather than a single DB
// delete -- same tradeoff the original design made, kept deliberately so
// authGate (run on every request, including static assets) never needs a
// DB round trip.
import bcrypt from 'bcryptjs';

const COOKIE_NAME = 'labelism_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

const PUBLIC_PATHS = new Set(['/login.html', '/style.css', '/ui.js', '/favicon.ico']);
const PUBLIC_API_PATHS = new Set(['/api/login', '/api/logout', '/api/health']);

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function sign(value, secret) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return toHex(sig);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function authConfigured(env) {
  return Boolean(env.LABELISM_SESSION_SECRET);
}

export function assertAuthSafeToBoot(env) {
  if (env.NODE_ENV === 'production' && !authConfigured(env)) {
    throw new Error(
      'REFUSE TO BOOT: NODE_ENV=production but LABELISM_SESSION_SECRET is not set.'
    );
  }
}

// One-time bootstrap: if no staff accounts exist yet, seed 'izzat' from the
// legacy LABELISM_ADMIN_PASSWORD_HASH secret (if still set) so the existing
// password keeps working without anyone needing to know the plaintext to
// re-hash it. No-ops once at least one staff account exists.
export async function bootstrapAdminIfEmpty(db, env) {
  if (!env.LABELISM_ADMIN_PASSWORD_HASH) return;
  const { count } = await db.prepare('SELECT COUNT(*) AS count FROM staff_accounts').first();
  if (count > 0) return;
  const adminName = env.LABELISM_ADMIN_USER || 'izzat';
  await db
    .prepare(
      `INSERT INTO staff_accounts (id, name, password_hash, is_admin, active)
       VALUES (?, ?, ?, 1, 1)
       ON CONFLICT (name) DO NOTHING`
    )
    .bind(crypto.randomUUID(), adminName, env.LABELISM_ADMIN_PASSWORD_HASH)
    .run();
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

// Verifies a staff login by name + password. Returns the staff row
// (without password_hash) on success, or null.
export async function verifyStaffLogin(db, name, password) {
  if (!name || !password) return null;
  const staff = await db
    .prepare('SELECT id, name, password_hash, is_admin, active FROM staff_accounts WHERE name = ?')
    .bind(name)
    .first();
  if (!staff || !staff.active) return null;
  const valid = await bcrypt.compare(password, staff.password_hash);
  if (!valid) return null;
  return { id: staff.id, name: staff.name, isAdmin: Boolean(staff.is_admin) };
}

async function makeSessionCookieValue(staff, env) {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `${staff.name}.${staff.isAdmin ? 1 : 0}.${expires}`;
  const signature = await sign(payload, env.LABELISM_SESSION_SECRET);
  return `${payload}.${signature}`;
}

// Returns { name, isAdmin } if the cookie is validly signed and unexpired,
// or null. Pure HMAC verification, no DB read (see file header).
async function verifySessionCookieValue(value, env) {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [name, isAdminStr, expiresStr, signature] = parts;
  const payload = `${name}.${isAdminStr}.${expiresStr}`;
  const expected = await sign(payload, env.LABELISM_SESSION_SECRET);
  if (!timingSafeEqual(signature, expected)) return null;
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return null;
  if (!name) return null;
  return { name, isAdmin: isAdminStr === '1' };
}

function parseCookies(req) {
  const header = req.headers.get('cookie');
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((pair) => {
      const idx = pair.indexOf('=');
      return [pair.slice(0, idx).trim(), decodeURIComponent(pair.slice(idx + 1).trim())];
    })
  );
}

// Decodes the current request's session, or null if absent/invalid. Used
// both by authGate (allow/deny) and by routeApi (to resolve the trusted
// actor for writes, and to gate admin-only endpoints).
export async function getSession(request, env) {
  if (!authConfigured(env)) return null;
  const cookies = parseCookies(request);
  return verifySessionCookieValue(cookies[COOKIE_NAME], env);
}

export async function setSessionCookieHeader(staff, env) {
  const isSecureEnv = env.NODE_ENV === 'production';
  const value = await makeSessionCookieValue(staff, env);
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isSecureEnv) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`;
}

// Returns null if the request is allowed through, or a Response to short-
// circuit with (401 JSON for /api/*, redirect to /login.html otherwise).
export async function authGate(request, env) {
  const url = new URL(request.url);

  if (!authConfigured(env)) {
    if (env.NODE_ENV === 'production') {
      // assertAuthSafeToBoot() should already have refused to boot -- this
      // is a defensive fallback, not the primary guard.
      return Response.json({ error: 'Auth not configured.' }, { status: 500 });
    }
    return null; // dev-only bypass, matches the Express version's warning-and-continue
  }

  if (url.pathname.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(url.pathname)) return null;
    if (await getSession(request, env)) return null;
    return Response.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  if (PUBLIC_PATHS.has(url.pathname)) return null;
  if (await getSession(request, env)) return null;
  return Response.redirect(new URL('/login.html', request.url), 302);
}

export { COOKIE_NAME };
