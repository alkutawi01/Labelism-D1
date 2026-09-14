import * as catalog from '../services/catalog.js';
import * as receiving from '../services/receiving.js';
import * as units from '../services/units.js';
import * as stocktake from '../services/stocktake.js';
import * as importManifest from '../services/importManifest.js';
import * as orders from '../services/orders.js';
import * as shipments from '../services/shipments.js';
import * as returns from '../services/returns.js';
import { toErrorResponse } from '../domain/errors.js';
import { verifyPassword, setSessionCookieHeader, clearSessionCookieHeader } from '../auth/index.js';

function ok(body, status = 200) {
  return Response.json(body, { status });
}
function notFound(message) {
  return Response.json({ error: message }, { status: 404 });
}
async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

// Central dispatch -- returns a Response, or null if no route matched.
// Cloudflare-specific bits (URL parsing, Request/Response) stay here;
// everything called into is a plain function taking `db`/plain args.
export async function routeApi(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  let m;

  try {
    if (pathname === '/api/login' && method === 'POST') {
      const { password } = await body(request);
      if (!password || !(await verifyPassword(password, env))) {
        return Response.json({ error: 'Incorrect password.' }, { status: 401 });
      }
      const cookie = await setSessionCookieHeader(env);
      return Response.json(
        { ok: true, user: env.LABELISM_ADMIN_USER || 'izzat' },
        { headers: { 'Set-Cookie': cookie } }
      );
    }

    if (pathname === '/api/logout' && method === 'POST') {
      return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookieHeader() } });
    }

    if (pathname === '/api/health' && method === 'GET') {
      return ok({ ok: true, project: 'Labelism', phase: 'Phase 1 -- receiving & unit registration', dbMode: 'd1' });
    }

    if (pathname === '/api/products' && method === 'POST') {
      return ok(await catalog.createProduct(env.DB, await body(request)), 201);
    }
    if (pathname === '/api/products' && method === 'GET') {
      return ok(await catalog.listProducts(env.DB));
    }

    if (pathname === '/api/variants' && method === 'POST') {
      return ok(await catalog.createVariant(env.DB, await body(request)), 201);
    }

    if ((m = pathname.match(/^\/api\/products\/([^/]+)\/dimensions$/)) && method === 'POST') {
      const b = await body(request);
      const result = await catalog.addProductDimensions(env.DB, m[1], Array.isArray(b.names) ? b.names : []);
      if (result.notFound) return notFound('Product not found.');
      return ok(result, 201);
    }

    if (pathname === '/api/production-batches' && method === 'POST') {
      return ok(await catalog.createProductionBatch(env.DB, await body(request)), 201);
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
      const result = await receiving.createReceipt(env.DB, m[1], await body(request));
      if (result.notFound) return notFound('Production batch not found.');
      return ok(result, 201);
    }

    if ((m = pathname.match(/^\/api\/production-batches\/([^/]+)\/units$/)) && method === 'GET') {
      return ok(await catalog.listUnitsForBatch(env.DB, m[1]));
    }
    if ((m = pathname.match(/^\/api\/production-batches\/([^/]+)\/generate-units$/)) && method === 'POST') {
      const b = await body(request);
      const result = await receiving.generateUnitsForBatch(env.DB, m[1], b.actor);
      if (result.notFound) return notFound('Production batch not found.');
      return ok(result, result.created ? 201 : 200);
    }

    if ((m = pathname.match(/^\/api\/receipts\/([^/]+)\/register-units$/)) && method === 'POST') {
      const b = await body(request);
      const result = await receiving.registerUnits(env.DB, m[1], b.actor);
      if (result.notFound) return notFound('Receipt not found.');
      return ok(result, result.created ? 201 : 200);
    }

    if (pathname === '/api/import/preview' && method === 'POST') {
      const b = await body(request);
      const manifest = importManifest.normalizeManifest(b.manifest);
      return ok(await importManifest.previewManifest(env.DB, manifest));
    }
    if (pathname === '/api/import/apply' && method === 'POST') {
      const b = await body(request);
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
      return ok(await orders.createCustomer(env.DB, await body(request)), 201);
    }

    if (pathname === '/api/orders' && method === 'GET') {
      return ok(await orders.listOrders(env.DB));
    }
    if (pathname === '/api/orders' && method === 'POST') {
      return ok(await orders.createOrder(env.DB, await body(request)), 201);
    }

    if (pathname === '/api/order-lines' && method === 'POST') {
      return ok(await orders.createOrderLine(env.DB, await body(request)), 201);
    }
    if ((m = pathname.match(/^\/api\/order-lines\/([^/]+)$/)) && method === 'GET') {
      const result = await orders.getOrderLine(env.DB, m[1]);
      if (!result) return notFound('Order line not found.');
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/order-lines\/([^/]+)\/notes$/)) && method === 'POST') {
      const b = await body(request);
      const result = await orders.updateOrderLineNotes(env.DB, m[1], b.notes);
      if (result.notFound) return notFound('Order line not found.');
      return ok(result);
    }

    if (pathname === '/api/shipments' && method === 'POST') {
      const result = await shipments.createShipment(env.DB, await body(request));
      if (result.notFound) return notFound('Order line not found.');
      return ok(result, 201);
    }
    if ((m = pathname.match(/^\/api\/shipments\/([^/]+)$/)) && method === 'GET') {
      const result = await shipments.getShipment(env.DB, m[1]);
      if (!result) return notFound('Shipment not found.');
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/shipments\/([^/]+)\/scans$/)) && method === 'POST') {
      const result = await shipments.scanUnitIntoShipment(env.DB, m[1], await body(request));
      if (result.notFound && result.reason === 'unit') return notFound('Unit not found.');
      if (result.notFound) return notFound('Shipment not found.');
      return ok(result, result.alreadyScanned ? 200 : 201);
    }
    if ((m = pathname.match(/^\/api\/shipments\/([^/]+)\/close$/)) && method === 'POST') {
      const b = await body(request);
      const result = await shipments.closeShipment(env.DB, m[1], b.actor);
      if (result.notFound) return notFound('Shipment not found.');
      return ok(result);
    }

    if ((m = pathname.match(/^\/api\/shipments\/([^/]+)\/dispatch$/)) && method === 'POST') {
      const b = await body(request);
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
      return ok(await returns.createReturnIntake(env.DB, await body(request)), 201);
    }
    if ((m = pathname.match(/^\/api\/return-intakes\/([^/]+)$/)) && method === 'GET') {
      const result = await returns.getReturnIntake(env.DB, m[1]);
      if (!result) return notFound('Return intake not found.');
      return ok(result);
    }
    if ((m = pathname.match(/^\/api\/return-intakes\/([^/]+)\/scans$/)) && method === 'POST') {
      const b = await body(request);
      const result = await returns.scanUnitIntoReturnIntake(env.DB, m[1], b);
      if (result.notFound && result.reason === 'unit') return notFound('Unit not found.');
      if (result.notFound) return notFound('Return intake not found.');
      return ok(result, result.alreadyScanned ? 200 : 201);
    }
    if ((m = pathname.match(/^\/api\/return-intakes\/([^/]+)\/units\/([^/]+)\/qc$/)) && method === 'POST') {
      const b = await body(request);
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
      return ok(await catalog.createLocation(env.DB, await body(request)), 201);
    }

    if ((m = pathname.match(/^\/api\/units\/([^/]+)\/confirm-label$/)) && method === 'POST') {
      const b = await body(request);
      const result = await units.confirmLabel(env.DB, m[1], b.actor);
      if (result.notFound) return notFound('Unit not found.');
      return ok(result, 201);
    }

    if ((m = pathname.match(/^\/api\/units\/([^/]+)\/verify-label-scan$/)) && method === 'POST') {
      const b = await body(request);
      const result = await units.verifyLabelScan(env.DB, m[1], b.code, b.actor);
      if (result.notFound) return notFound('Unit not found.');
      return ok(result, result.verified ? 201 : 200);
    }

    if ((m = pathname.match(/^\/api\/units\/([^/]+)\/reissue-label$/)) && method === 'POST') {
      const b = await body(request);
      const result = await units.reissueLabel(env.DB, m[1], b.actor);
      if (result.notFound) return notFound('Unit not found.');
      return ok(result, 201);
    }

    if ((m = pathname.match(/^\/api\/units\/([^/]+)\/reissue-label-after-attachment$/)) && method === 'POST') {
      const b = await body(request);
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
      const result = await units.recordUnitEvent(env.DB, m[1], await body(request));
      if (result.notFound) return notFound('Unit not found.');
      return ok(result, 201);
    }

    if (pathname === '/api/stocktake-sessions' && method === 'GET') {
      return ok(await stocktake.listStocktakeSessions(env.DB));
    }
    if (pathname === '/api/stocktake-sessions' && method === 'POST') {
      const result = await stocktake.openStocktakeSession(env.DB, await body(request));
      if (result.notFound) return notFound('Production batch not found.');
      return ok(result, 201);
    }

    if ((m = pathname.match(/^\/api\/stocktake-sessions\/([^/]+)$/)) && method === 'GET') {
      const result = await stocktake.getStocktakeSession(env.DB, m[1]);
      if (!result) return notFound('Stocktake session not found.');
      return ok(result);
    }

    if ((m = pathname.match(/^\/api\/stocktake-sessions\/([^/]+)\/scans$/)) && method === 'POST') {
      const result = await stocktake.scanStocktakeUnit(env.DB, m[1], await body(request));
      if (result.notFound && result.reason === 'unit') return notFound('Unit not found.');
      if (result.notFound) return notFound('Stocktake session not found.');
      return ok(result, result.alreadyScanned ? 200 : 201);
    }

    if ((m = pathname.match(/^\/api\/stocktake-sessions\/([^/]+)\/close$/)) && method === 'POST') {
      const b = await body(request);
      const result = await stocktake.closeStocktakeSession(env.DB, m[1], b.actor);
      if (result.notFound) return notFound('Stocktake session not found.');
      return ok(result);
    }

    return null;
  } catch (err) {
    return toErrorResponse(err);
  }
}
