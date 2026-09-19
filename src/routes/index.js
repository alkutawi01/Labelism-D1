import * as catalog from '../services/catalog.js';
import * as receiving from '../services/receiving.js';
import * as units from '../services/units.js';
import * as stocktake from '../services/stocktake.js';
import * as importManifest from '../services/importManifest.js';
import * as orders from '../services/orders.js';
import * as shipments from '../services/shipments.js';
import * as returns from '../services/returns.js';
import * as printRuns from '../services/printRuns.js';
import { toErrorResponse } from '../domain/errors.js';
import {
  bootstrapAdminIfEmpty,
  verifyStaffLogin,
  hashPassword,
  setSessionCookieHeader,
  clearSessionCookieHeader,
  getSession,
} from '../auth/index.js';

function ok(responseBody, status = 200) {
  return Response.json(responseBody, { status });
}
function notFound(message) {
  return Response.json({ error: message }, { status: 404 });
}
function forbidden(message) {
  return Response.json({ error: message }, { status: 403 });
}
// Every write's `actor` is the AUTHENTICATED session's name, not whatever
// the client sent -- overwritten here, the single place every route parses
// its body, so no individual handler can be bypassed into trusting a
// client-supplied actor string. `session` is undefined only for the
// pre-auth /api/login handler, which doesn't need an actor.
async function body(request, session) {
  let parsed;
  try { parsed = await request.json(); } catch { parsed = {}; }
  if (parsed && typeof parsed === 'object' && session?.name) {
    parsed.actor = session.name;
  }
  return parsed;
}

// Central dispatch -- returns a Response, or null if no route matched.
// Cloudflare-specific bits (URL parsing, Request/Response) stay here;
// everything called into is a plain function taking `db`/plain args.
export async function routeApi(request, env, session) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  let m;

  try {
    if (pathname === '/api/login' && method === 'POST') {
      const { name, password } = await body(request, session);
      await bootstrapAdminIfEmpty(env.DB, env);
      const staff = await verifyStaffLogin(env.DB, name, password);
      if (!staff) {
        return Response.json({ error: 'Nama atau kata laluan salah.' }, { status: 401 });
      }
      const cookie = await setSessionCookieHeader(staff, env);
      return Response.json(
        { ok: true, user: staff.name, isAdmin: staff.isAdmin },
        { headers: { 'Set-Cookie': cookie } }
      );
    }

    if (pathname === '/api/logout' && method === 'POST') {
      return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookieHeader() } });
    }

    if (pathname === '/api/session' && method === 'GET') {
      return ok(session ? { name: session.name, isAdmin: session.isAdmin } : { name: null, isAdmin: false });
    }

    if (pathname === '/api/staff' && method === 'GET') {
      if (!session?.isAdmin) return forbidden('Admin sahaja.');
      const { results } = await env.DB
        .prepare('SELECT id, name, is_admin AS isAdmin, active FROM staff_accounts ORDER BY created_at')
        .all();
      return ok(results);
    }
    if (pathname === '/api/staff' && method === 'POST') {
      if (!session?.isAdmin) return forbidden('Admin sahaja.');
      const b = await body(request, session);
      const name = (b.name || '').trim();
      const password = b.password || '';
      if (!name) return Response.json({ error: 'Nama staf diperlukan.' }, { status: 400 });
      if (!password || password.length < 6) {
        return Response.json({ error: 'Kata laluan mesti sekurang-kurangnya 6 aksara.' }, { status: 400 });
      }
      const passwordHash = await hashPassword(password);
      try {
        await env.DB
          .prepare(
            `INSERT INTO staff_accounts (id, name, password_hash, is_admin, active) VALUES (?, ?, ?, ?, 1)`
          )
          .bind(crypto.randomUUID(), name, passwordHash, b.isAdmin ? 1 : 0)
          .run();
      } catch (err) {
        if (String(err.message || '').includes('UNIQUE')) {
          return Response.json({ error: `Nama staf "${name}" sudah wujud.` }, { status: 409 });
        }
        throw err;
      }
      return ok({ created: true, name }, 201);
    }

    if (pathname === '/api/health' && method === 'GET') {
      return ok({ ok: true, project: 'Labelism', phase: 'Phase 1 -- receiving & unit registration', dbMode: 'd1' });
    }

    if (pathname === '/api/products' && method === 'POST') {
      return ok(await catalog.createProduct(env.DB, await body(request, session)), 201);
    }
    if (pathname === '/api/products' && method === 'GET') {
      return ok(await catalog.listProducts(env.DB));
    }

    if (pathname === '/api/variants' && method === 'POST') {
      return ok(await catalog.createVariant(env.DB, await body(request, session)), 201);
    }

    if ((m = pathname.match(/^\/api\/products\/([^/]+)\/dimensions$/)) && method === 'POST') {
      const b = await body(request, session);
      const result = await catalog.addProductDimensions(env.DB, m[1], Array.isArray(b.names) ? b.names : []);
      if (result.notFound) return notFound('Product not found.');
      return ok(result, 201);
    }

    if (pathname === '/api/production-batches' && method === 'POST') {
      return ok(await catalog.createProductionBatch(env.DB, await body(request, session)), 201);
    }
    if (pathname === '/api/production-batches' && method === 'GET') {
      return ok(await catalog.listProductionBatches(env.DB));
    }

    if ((m = pathname.match(/^\/api\/production-batches\/([^/]+)$/)) && method === 'GET') {
      const batch = await catalog.getProductionBatch(env.DB, m[1]);
      if (!batch) return notFound('Production batch not found.');
      return ok(batch);
    }

    if ((m = pathname.match(/^\/api\/production-batches\/([^/]+)\/receipts$/)) && method === 'POST') {
      const result = await receiving.createReceipt(env.DB, m[1], await body(request, session));
      if (result.notFound) return notFound('Production batch not found.');
      return ok(result, 201);
    }

    if ((m = pathname.match(/^\/api\/production-batches\/([^/]+)\/units$/)) && method === 'GET') {
      return ok(await catalog.listUnitsForBatch(env.DB, m[1]));
    }
    if ((m = pathname.match(/^\/api\/production-batches\/([^/]+)\/generate-units$/)) && method === 'POST') {
      const b = await body(request, session);
      const result = await receiving.generateUnitsForBatch(env.DB, m[1], b.actor);
      if (result.notFound) return notFound('Production batch not found.');
      return ok(result, result.created ? 201 : 200);
    }

    if ((m = pathname.match(/^\/api\/receipts\/([^/]+)\/register-units$/)) && method === 'POST') {
      const b = await body(request, session);
      const result = await receiving.registerUnits(env.DB, m[1], b.actor);
      if (result.notFound) return notFound('Receipt not found.');
      return ok(result, result.created ? 201 : 200);
    }

    if (pathname === '/api/import/preview' && method === 'POST') {
      const b = await body(request, session);
      const manifest = importManifest.normalizeManifest(b.manifest);
      return ok(await importManifest.previewManifest(env.DB, manifest));
    }
    if (pathname === '/api/import/apply' && method === 'POST') {
      const b = await body(request, session);
      const manifest = importManifest.normalizeManifest(b.manifest);
      return ok(await importManifest.applyManifest(env.DB, manifest, b.actor), 201);
    }

    if (pathname === '/api/stats' && method === 'GET') {
      return ok(await catalog.getDashboardStats(env.DB));
    }

    if (pathname === '/api/customers' && method === 'GET') {
      return ok(await orders.listCustomers(env.DB));
    }
    if (pathname === '/api/customers' && method === 'POST') {
      return ok(await orders.createCustomer(env.DB, await body(request, session)), 201);
    }

    if (pathname === '/api/orders' && method === 'GET') {
      return ok(await orders.listOrders(env.DB));
    }
    if (pathname === '/api/orders' && method === 'POST') {
      return ok(await orders.createOrder(env.DB, await body(request, session)), 201);
    }
    if (pathname === '/api/orders/create-with-labels' && method === 'POST') {
      return ok(await orders.createOrderWithLabels(env.DB, await body(request, session)), 201);
    }

    if ((m = pathname.match(/^\/api\/orders\/([^/]+)\/reconciliation$/)) && method === 'GET') {
      const result = await orders.getOrderReconciliation(env.DB, m[1]);
      if (!result) return notFound('Order not found.');
      return ok(result);
    }

    if (pathname === '/api/print-orders' && method === 'GET') {
      return ok(await printRuns.listPrintOrders(env.DB));
    }
    if ((m = pathname.match(/^\/api\/orders\/([^/]+)\/print-overview$/)) && method === 'GET') {
      const result = await printRuns.getPrintOverview(env.DB, m[1]);
      if (!result) return notFound('Order not found.');
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/orders\/([^/]+)\/print-runs$/)) && method === 'POST') {
      const result = await printRuns.createPrintRun(env.DB, m[1], await body(request, session));
      if (result.notFound) return notFound('Order not found.');
      return ok(result, 201);
    }
    if ((m = pathname.match(/^\/api\/print-runs\/([^/]+)$/)) && method === 'GET') {
      const result = await printRuns.getPrintRun(env.DB, m[1]);
      if (!result) return notFound('Print run not found.');
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/print-runs\/([^/]+)\/packing$/)) && method === 'GET') {
      const result = await printRuns.getRunPacking(env.DB, m[1]);
      if (!result) return notFound('Print run not found.');
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/print-runs\/([^/]+)\/packing\/start$/)) && method === 'POST') {
      const result = await printRuns.startRunPacking(env.DB, m[1]);
      if (result.notFound) return notFound('Print run not found.');
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/print-runs\/([^/]+)\/packing\/scan$/)) && method === 'POST') {
      const result = await printRuns.scanRunPacking(env.DB, m[1], await body(request, session));
      if (result.notFound) return notFound('Print run not found.');
      return ok(result, result.alreadyScanned ? 200 : 201);
    }
    if ((m = pathname.match(/^\/api\/print-runs\/([^/]+)\/packing\/close$/)) && method === 'POST') {
      const result = await printRuns.closeRunPacking(env.DB, m[1]);
      if (result.notFound) return notFound('Print run not found.');
      return ok(result);
    }

    if (pathname === '/api/order-lines' && method === 'POST') {
      return ok(await orders.createOrderLine(env.DB, await body(request, session)), 201);
    }
    if ((m = pathname.match(/^\/api\/order-lines\/([^/]+)$/)) && method === 'GET') {
      const result = await orders.getOrderLine(env.DB, m[1]);
      if (!result) return notFound('Order line not found.');
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/order-lines\/([^/]+)\/batches$/)) && method === 'POST') {
      const result = await orders.addBatchToOrderLine(env.DB, m[1], await body(request, session));
      if (result.notFound) return notFound('Order line not found.');
      return ok(result, 201);
    }
    if ((m = pathname.match(/^\/api\/order-lines\/([^/]+)\/notes$/)) && method === 'POST') {
      const b = await body(request, session);
      const result = await orders.updateOrderLineNotes(env.DB, m[1], b.notes);
      if (result.notFound) return notFound('Order line not found.');
      return ok(result);
    }

    if (pathname === '/api/shipments' && method === 'POST') {
      const result = await shipments.createShipment(env.DB, await body(request, session));
      if (result.notFound) return notFound('Order line not found.');
      return ok(result, 201);
    }
    if ((m = pathname.match(/^\/api\/shipments\/([^/]+)$/)) && method === 'GET') {
      const result = await shipments.getShipment(env.DB, m[1]);
      if (!result) return notFound('Shipment not found.');
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/shipments\/([^/]+)\/scans$/)) && method === 'POST') {
      const result = await shipments.scanUnitIntoShipment(env.DB, m[1], await body(request, session));
      if (result.notFound && result.reason === 'unit') return notFound('Unit not found.');
      if (result.notFound) return notFound('Shipment not found.');
      return ok(result, result.alreadyScanned ? 200 : 201);
    }
    if ((m = pathname.match(/^\/api\/shipments\/([^/]+)\/close$/)) && method === 'POST') {
      const b = await body(request, session);
      const result = await shipments.closeShipment(env.DB, m[1], b.actor);
      if (result.notFound) return notFound('Shipment not found.');
      return ok(result);
    }

    if ((m = pathname.match(/^\/api\/shipments\/([^/]+)\/dispatch$/)) && method === 'POST') {
      const b = await body(request, session);
      const result = await shipments.dispatchShipment(env.DB, m[1], { locationName: b.locationName, actor: b.actor });
      if (result.notFound) return notFound('Shipment not found.');
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/order-lines\/([^/]+)\/shipments$/)) && method === 'GET') {
      return ok(await shipments.listShipmentsForOrderLine(env.DB, m[1]));
    }

    if (pathname === '/api/return-intakes' && method === 'GET') {
      return ok(await returns.listReturnIntakes(env.DB));
    }
    if (pathname === '/api/return-intakes' && method === 'POST') {
      return ok(await returns.createReturnIntake(env.DB, await body(request, session)), 201);
    }
    if ((m = pathname.match(/^\/api\/return-intakes\/([^/]+)$/)) && method === 'GET') {
      const result = await returns.getReturnIntake(env.DB, m[1]);
      if (!result) return notFound('Return intake not found.');
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/return-intakes\/([^/]+)\/scans$/)) && method === 'POST') {
      const b = await body(request, session);
      const result = await returns.scanUnitIntoReturnIntake(env.DB, m[1], b);
      if (result.notFound && result.reason === 'unit') return notFound('Unit not found.');
      if (result.notFound) return notFound('Return intake not found.');
      return ok(result, result.alreadyScanned ? 200 : 201);
    }
    if ((m = pathname.match(/^\/api\/return-intakes\/([^/]+)\/units\/([^/]+)\/qc$/)) && method === 'POST') {
      const b = await body(request, session);
      const result = await returns.decideReturnQc(env.DB, m[1], m[2], b);
      if (result.notFound) return notFound('That unit is not part of this return intake.');
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/return-intakes\/([^/]+)\/close$/)) && method === 'POST') {
      const result = await returns.closeReturnIntake(env.DB, m[1]);
      if (result.notFound) return notFound('Return intake not found.');
      return ok(result);
    }

    if (pathname === '/api/locations' && method === 'GET') {
      return ok(await catalog.listLocations(env.DB));
    }
    if (pathname === '/api/locations' && method === 'POST') {
      return ok(await catalog.createLocation(env.DB, await body(request, session)), 201);
    }

    if ((m = pathname.match(/^\/api\/units\/([^/]+)\/confirm-label$/)) && method === 'POST') {
      const b = await body(request, session);
      const result = await units.confirmLabel(env.DB, m[1], b.actor);
      if (result.notFound) return notFound('Unit not found.');
      return ok(result, 201);
    }

    if ((m = pathname.match(/^\/api\/units\/([^/]+)\/verify-label-scan$/)) && method === 'POST') {
      const b = await body(request, session);
      const result = await units.verifyLabelScan(env.DB, m[1], b.code, b.actor);
      if (result.notFound) return notFound('Unit not found.');
      return ok(result, result.verified ? 201 : 200);
    }

    if ((m = pathname.match(/^\/api\/units\/([^/]+)\/reissue-label$/)) && method === 'POST') {
      const b = await body(request, session);
      const result = await units.reissueLabel(env.DB, m[1], b.actor);
      if (result.notFound) return notFound('Unit not found.');
      return ok(result, 201);
    }

    if ((m = pathname.match(/^\/api\/units\/([^/]+)\/reissue-label-after-attachment$/)) && method === 'POST') {
      const b = await body(request, session);
      const result = await units.reissueLabelAfterAttachment(env.DB, m[1], b.actor);
      if (result.notFound) return notFound('Unit not found.');
      return ok(result, 201);
    }

    if ((m = pathname.match(/^\/api\/units\/lookup\/([^/]+)$/)) && method === 'GET') {
      const result = await units.lookupUnit(env.DB, m[1]);
      if (!result) return notFound('Unit not found.');
      return ok(result);
    }

    if ((m = pathname.match(/^\/api\/units\/([^/]+)\/events$/)) && method === 'POST') {
      const result = await units.recordUnitEvent(env.DB, m[1], await body(request, session));
      if (result.notFound) return notFound('Unit not found.');
      return ok(result, 201);
    }

    if (pathname === '/api/stocktake-sessions' && method === 'GET') {
      return ok(await stocktake.listStocktakeSessions(env.DB));
    }
    if (pathname === '/api/stocktake-sessions' && method === 'POST') {
      const result = await stocktake.openStocktakeSession(env.DB, await body(request, session));
      if (result.notFound) return notFound('Production batch not found.');
      return ok(result, 201);
    }

    if ((m = pathname.match(/^\/api\/stocktake-sessions\/([^/]+)$/)) && method === 'GET') {
      const result = await stocktake.getStocktakeSession(env.DB, m[1]);
      if (!result) return notFound('Stocktake session not found.');
      return ok(result);
    }

    if ((m = pathname.match(/^\/api\/stocktake-sessions\/([^/]+)\/scans$/)) && method === 'POST') {
      const result = await stocktake.scanStocktakeUnit(env.DB, m[1], await body(request, session));
      if (result.notFound && result.reason === 'unit') return notFound('Unit not found.');
      if (result.notFound) return notFound('Stocktake session not found.');
      return ok(result, result.alreadyScanned ? 200 : 201);
    }

    if ((m = pathname.match(/^\/api\/stocktake-sessions\/([^/]+)\/close$/)) && method === 'POST') {
      const b = await body(request, session);
      const result = await stocktake.closeStocktakeSession(env.DB, m[1], b.actor);
      if (result.notFound) return notFound('Stocktake session not found.');
      return ok(result);
    }

    return null;
  } catch (err) {
    return toErrorResponse(err);
  }
}
