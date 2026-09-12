// Thin Worker entrypoint, per Director instruction: fetch() handles request/
// response routing only, D1 binding is passed inward, business rules
// (src/services, src/domain) never import Cloudflare globals directly.
import { authGate, assertAuthSafeToBoot } from './auth/index.js';
import { routeApi } from './routes/index.js';

let bootChecked = false;

export default {
  async fetch(request, env, ctx) {
    if (!bootChecked) {
      // Fail-closed check, same rule as the Postgres/Express version: refuse
      // to serve in production if auth env vars are missing. Workers have no
      // real "boot" hook, so this runs once per isolate on first request.
      assertAuthSafeToBoot(env);
      bootChecked = true;
    }

    const gateResponse = await authGate(request, env);
    if (gateResponse) return gateResponse;

    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      const apiResponse = await routeApi(request, env);
      if (apiResponse) return apiResponse;
      return Response.json({ error: 'Not found.' }, { status: 404 });
    }

    // html_handling="none" + not_found_handling="none" (deliberately set to
    // keep exact original paths and avoid the .html->clean-URL redirect loop
    // hit earlier) means the assets binding does NOT auto-map "/" -> index.html
    // the way a default static host would -- do that rewrite explicitly here.
    if (url.pathname === '/') {
      return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
    }

    return env.ASSETS.fetch(request);
  },
};
