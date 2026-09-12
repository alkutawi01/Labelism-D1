// Single-user session auth, ported from src/auth.js (Postgres/Express version).
// Same design decisions carried over unchanged (Director-approved 2026-09-08):
// fail-closed boot check, HMAC-signed stateless cookie, bcrypt password hash,
// generic failed-login message. Only the runtime primitives changed --
// Web Crypto (async) instead of node:crypto, since Workers have no Node APIs.
import bcrypt from 'bcryptjs';

const COOKIE_NAME = 'labelism_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

const PUBLIC_PATHS = new Set(['/login.html', '/style.css', '/favicon.ico']);
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
  return Boolean(env.LABELISM_ADMIN_PASSWORD_HASH && env.LABELISM_SESSION_SECRET);
}

export function assertAuthSafeToBoot(env) {
  if (env.NODE_ENV === 'production' && !authConfigured(env)) {
    throw new Error(
      'REFUSE TO BOOT: NODE_ENV=production but LABELISM_ADMIN_PASSWORD_HASH / ' +
      'LABELISM_SESSION_SECRET is not set.'
    );
  }
}

export async function verifyPassword(password, env) {
  if (!env.LABELISM_ADMIN_PASSWORD_HASH) return false;
  return bcrypt.compare(password, env.LABELISM_ADMIN_PASSWORD_HASH);
}

async function makeSessionCookieValue(env) {
  const adminUser = env.LABELISM_ADMIN_USER || 'izzat';
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `${adminUser}.${expires}`;
  const signature = await sign(payload, env.LABELISM_SESSION_SECRET);
  return `${payload}.${signature}`;
}

async function verifySessionCookieValue(value, env) {
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [user, expiresStr, signature] = parts;
  const payload = `${user}.${expiresStr}`;
  const expected = await sign(payload, env.LABELISM_SESSION_SECRET);
  if (!timingSafeEqual(signature, expected)) return false;
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;
  const adminUser = env.LABELISM_ADMIN_USER || 'izzat';
  return user === adminUser;
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

export async function setSessionCookieHeader(env) {
  const isSecureEnv = env.NODE_ENV === 'production';
  const value = await makeSessionCookieValue(env);
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
    const cookies = parseCookies(request);
    if (await verifySessionCookieValue(cookies[COOKIE_NAME], env)) return null;
    return Response.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  if (PUBLIC_PATHS.has(url.pathname)) return null;
  const cookies = parseCookies(request);
  if (await verifySessionCookieValue(cookies[COOKIE_NAME], env)) return null;
  return Response.redirect(new URL('/login.html', request.url), 302);
}

export { COOKIE_NAME };
