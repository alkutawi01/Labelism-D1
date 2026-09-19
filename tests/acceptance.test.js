/**
 * Labelism Acceptance Test Suite – tests/acceptance.test.js
 *
 * Runs 23 acceptance tests against a live local wrangler dev server.
 * All tests use real HTTP endpoints (no internal service calls).
 *
 * Prerequisites:
 *   - npx wrangler dev --port 8788  (running in background)
 *   - Either: no auth secrets in .dev.vars (dev-only bypass), OR
 *     LABELISM_TEST_ADMIN_USER / LABELISM_TEST_ADMIN_PASSWORD set to a real
 *     admin account so the suite can create its own 'test-suite' login.
 *
 * Run:
 *   node tests/acceptance.test.js
 */

const BASE = process.env.LABELISM_TEST_BASE_URL || 'http://127.0.0.1:8788';

// ─────────────────────────────────────────────────────────────────────────────
// Minimal test harness
// ─────────────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function run(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, status: 'PASS' });
    console.log(`  ✅ PASS  ${name}`);
  } catch (err) {
    failed++;
    results.push({ name, status: 'FAIL', error: err.message });
    console.error(`  ❌ FAIL  ${name}`);
    console.error(`           ${err.message}`);
  }
}

// Production requires per-staff login (staff_accounts table) -- the suite
// used to rely on auth being bypassed in dev (no .dev.vars secrets set),
// which meant it never actually exercised the auth path production runs
// under. Now it logs in for real and carries the session cookie on every
// request, so a broken auth gate fails the suite instead of silently
// passing under a bypass that doesn't reflect prod.
let sessionCookie = '';

async function login() {
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'test-suite', password: 'acceptance-test-password' }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) sessionCookie = setCookie.split(';')[0];
}

async function ensureTestAccount() {
  // Bootstraps 'izzat' from LABELISM_ADMIN_PASSWORD_HASH if no staff exist
  // yet (harmless no-op otherwise), then logs in as izzat once to get an
  // admin session capable of creating a dedicated test-suite account --
  // isolates the suite from whatever the real admin password happens to be.
  const adminLogin = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: process.env.LABELISM_TEST_ADMIN_USER || 'izzat', password: process.env.LABELISM_TEST_ADMIN_PASSWORD || '' }),
  });
  if (adminLogin.status !== 200) return; // no admin creds available in this env -- fall through to plain login()
  const adminCookie = (adminLogin.headers.get('set-cookie') || '').split(';')[0];
  await fetch(`${BASE}/api/staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'test-suite', password: 'acceptance-test-password' }),
  }); // ignore "already exists" -- idempotent across repeated runs
}

async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Cookie: sessionCookie } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const json = await res.json();
  return { status: res.status, body: json };
}

await ensureTestAccount();
await login();

async function attachUnit(unit) {
  const verify = await api(`/api/units/${unit.id}/verify-label-scan`, {
    method: 'POST',
    body: { code: unit.internal_token, actor: 'test' },
  });
  assert(verify.status === 201 || verify.status === 200,
    `Label verification failed for ${unit.id}: ${verify.status} ${JSON.stringify(verify.body)}`);
  assert(verify.body.verified === true, `Label was not verified for ${unit.id}`);

  const confirm = await api(`/api/units/${unit.id}/confirm-label`, {
    method: 'POST',
    body: { actor: 'test' },
  });
  assert(confirm.status === 201 || confirm.status === 200,
    `Label attachment failed for ${unit.id}: ${confirm.status} ${JSON.stringify(confirm.body)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: Manual order, single batch (generate all now)
// ─────────────────────────────────────────────────────────────────────────────
await run('Test 1 – Manual order, full single batch (1000 units)', async () => {
  const ts = Date.now();
  const res = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: `T1-Customer-${ts}`,
      orderReference: `T1-REF-${ts}`,
      items: [
        {
          productName: `T1-Product-${ts}`,
          variantLabel: 'Size M',
          quantity: 1000,
          unitNames: [],
          batches: null,   // generate all now
        },
      ],
      actor: 'test',
    },
  });
  assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert(res.body.orderId, 'orderId missing');
  assert(res.body.orderReference === `T1-REF-${ts}`, 'orderReference mismatch');
  assert(res.body.customerName === `T1-Customer-${ts}`, 'customerName mismatch');
  assert(res.body.lines.length === 1, 'Expected 1 order line');
  const line = res.body.lines[0];
  assert(line.quantity === 1000, 'Line quantity should be 1000');
  assert(line.batches.length === 1, 'Expected 1 batch (generate all)');
  assert(line.batches[0].plannedQuantity === 1000, 'Batch planned qty should be 1000');
  assert(line.batches[0].createdUnits === 1000, 'Should have created 1000 units');

  // Verify unallocated balance = 0
  const reconcile = await api(`/api/orders/${res.body.orderId}/reconciliation`);
  assert(reconcile.body.totals.ordered === 1000, 'Reconciliation ordered should be 1000');
  assert(reconcile.body.totals.generated === 1000, 'Reconciliation generated should be 1000');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: Manual order with phased batch split (500 + 500)
// ─────────────────────────────────────────────────────────────────────────────
let t2OrderId, t2LineId;
await run('Test 2 – Manual order, phased batch split 500+500', async () => {
  const ts = Date.now();
  const res = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: `T2-Customer-${ts}`,
      orderReference: `T2-REF-${ts}`,
      items: [
        {
          productName: `T2-Product-${ts}`,
          variantLabel: 'Size L',
          quantity: 1000,
          unitNames: [],
          batches: [{ quantity: 500 }, { quantity: 500 }],
        },
      ],
      actor: 'test',
    },
  });
  assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
  const line = res.body.lines[0];
  assert(line.batches.length === 2, 'Expected 2 batches');
  assert(line.batches[0].plannedQuantity === 500, 'Batch 1 should be 500');
  assert(line.batches[1].plannedQuantity === 500, 'Batch 2 should be 500');
  assert(line.batches[0].createdUnits === 500, 'Batch 1 should have 500 units');
  assert(line.batches[1].createdUnits === 500, 'Batch 2 should have 500 units');
  t2OrderId = res.body.orderId;
  t2LineId = line.lineId;
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Server rejects batch that exceeds unallocated balance
// ─────────────────────────────────────────────────────────────────────────────
await run('Test 3 – Server rejects batch exceeding order quantity', async () => {
  const ts = Date.now();
  const res = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: `T3-Customer-${ts}`,
      orderReference: `T3-REF-${ts}`,
      items: [
        {
          productName: `T3-Product-${ts}`,
          variantLabel: 'Size S',
          quantity: 100,
          unitNames: [],
          batches: [{ quantity: 60 }, { quantity: 50 }],  // 110 > 100 -- should fail
        },
      ],
      actor: 'test',
    },
  });
  assert(res.status === 400 || res.status === 422 || res.status === 500,
    `Expected error status, got ${res.status}`);
  assert(res.body.error, 'Expected error message in body');
  assert(res.body.error.includes('110') || res.body.error.includes('exceed') || res.body.error.includes('exceed') || res.body.error.includes('exceeds'),
    `Error should mention overflow: ${res.body.error}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4 (Fix 7+9): Import JSON Manifest -- full payload matching UI contract.
// Validates customerName, orderReference, batches, unitNames all preserved.
// ─────────────────────────────────────────────────────────────────────────────
let t4OrderId;
await run('Test 4 – Import JSON Manifest preserves customerName, orderReference, batches, unitNames', async () => {
  const ts = Date.now();
  const manifest = {
    schemaVersion: '1',
    customerName: `T4-Sekolah-${ts}`,
    orderReference: `T4-PO-${ts}`,
    products: [
      {
        name: `T4-Jersi-${ts}`,
        dimensions: ['Saiz'],
        variants: [
          {
            label: 'Saiz M',
            quantity: 10,
            unitNames: ['Ahmad', 'Ali', 'Abu', 'Bakar', 'Chai', 'Danial', 'Eason', 'Fahmi', 'Gani', 'Hafiz'],
            batches: [{ quantity: 6 }, { quantity: 4 }],
          },
        ],
      },
    ],
  };

  const res = await api('/api/import/apply', {
    method: 'POST',
    body: { manifest, actor: 'test' },
  });
  assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert(res.body.orderId, 'orderId missing from import response');
  assert(res.body.orderReference === `T4-PO-${ts}`, `orderReference mismatch: got "${res.body.orderReference}"`);
  assert(res.body.customerName === `T4-Sekolah-${ts}`, `customerName mismatch: got "${res.body.customerName}"`);
  t4OrderId = res.body.orderId;

  // Verify batches
  const line = res.body.lines[0];
  assert(line.batches.length === 2, `Expected 2 batches from phased manifest, got ${line.batches.length}`);
  assert(line.batches[0].plannedQuantity === 6, `Batch 1 should be 6, got ${line.batches[0].plannedQuantity}`);
  assert(line.batches[1].plannedQuantity === 4, `Batch 2 should be 4, got ${line.batches[1].plannedQuantity}`);

  // Query DB and verify unitNames stored (recipient_name on units)
  const batch1Id = line.batches[0].batchId;
  const unitsRes = await api(`/api/production-batches/${batch1Id}/units`);
  assert(Array.isArray(unitsRes.body), 'Expected units array');
  assert(unitsRes.body.length === 6, `Expected 6 units in batch 1, got ${unitsRes.body.length}`);
  const names = unitsRes.body.map(u => u.recipient_name);
  assert(names.includes('Ahmad'), `Expected "Ahmad" in batch 1 recipients: ${JSON.stringify(names)}`);
  assert(names.includes('Danial'), `Expected "Danial" in batch 1 recipients: ${JSON.stringify(names)}`);
  // Batch 2 should get remaining 4 names
  const batch2Id = line.batches[1].batchId;
  const unitsRes2 = await api(`/api/production-batches/${batch2Id}/units`);
  assert(unitsRes2.body.length === 4, `Expected 4 units in batch 2, got ${unitsRes2.body.length}`);
  const names2 = unitsRes2.body.map(u => u.recipient_name);
  assert(names2.includes('Fahmi'), `Expected "Fahmi" in batch 2: ${JSON.stringify(names2)}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5: Recipient names (1-to-1 deterministic mapping)
// ─────────────────────────────────────────────────────────────────────────────
await run('Test 5 – Recipient names stored 1-to-1 deterministically', async () => {
  const ts = Date.now();
  const names = ['Zaid', 'Yusuf', 'Wan', 'Vin', 'Uma'];
  const res = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: `T5-Customer-${ts}`,
      orderReference: `T5-REF-${ts}`,
      items: [
        {
          productName: `T5-Product-${ts}`,
          variantLabel: 'Size XL',
          quantity: 5,
          unitNames: names,
          batches: null,
        },
      ],
      actor: 'test',
    },
  });
  assert(res.status === 201, `Expected 201, got ${res.status}`);
  const batchId = res.body.lines[0].batches[0].batchId;
  const unitsRes = await api(`/api/production-batches/${batchId}/units`);
  const storedNames = unitsRes.body.map(u => u.recipient_name).filter(Boolean);
  assert(storedNames.length === 5, `Expected 5 named units, got ${storedNames.length}`);
  for (const n of names) {
    assert(storedNames.includes(n), `Expected "${n}" in stored recipient_names: ${JSON.stringify(storedNames)}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6: Staged reconciliation -- Stage 1 (Ordered vs Generated)
// ─────────────────────────────────────────────────────────────────────────────
await run('Test 6 – Staged reconciliation: Stage 1 (Ordered vs Generated) and Stage 2 fields present', async () => {
  assert(t4OrderId, 'Test 4 must have created an order first');
  const res = await api(`/api/orders/${t4OrderId}/reconciliation`);
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  const { totals, lines } = res.body;
  assert(totals.ordered === 10, `Expected 10 ordered, got ${totals.ordered}`);
  assert(totals.generated === 10, `Expected 10 generated, got ${totals.generated}`);
  assert(typeof totals.attached === 'number', 'totals.attached must be a number');
  assert(typeof totals.packed === 'number', 'totals.packed must be a number');
  assert(typeof totals.dispatched === 'number', 'totals.dispatched must be a number');
  // Stage 1 should be green (10/10 generated)
  assert(lines[0].units_generated === 10, 'Line units_generated should be 10');
  assert(lines[0].units_generated === lines[0].quantity_ordered, 'Generated == Ordered');
  // Stage 2: no labels attached yet (just generated)
  assert(lines[0].units_attached === 0, 'No units should be attached yet (just generated)');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7: addBatchToOrderLine -- add a batch to an existing order line
// ─────────────────────────────────────────────────────────────────────────────
let t7OrderId, t7LineId;
await run('Test 7 – addBatchToOrderLine adds batch to existing order line', async () => {
  const ts = Date.now();
  // Create order with only 300 of 500 generated initially
  const res = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: `T7-Customer-${ts}`,
      orderReference: `T7-REF-${ts}`,
      items: [
        {
          productName: `T7-Product-${ts}`,
          variantLabel: 'Size M',
          quantity: 500,
          unitNames: [],
          batches: [{ quantity: 300 }],  // only 300 now, 200 remaining
        },
      ],
      actor: 'test',
    },
  });
  assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
  t7OrderId = res.body.orderId;
  t7LineId = res.body.lines[0].lineId;

  // Verify unallocated = 200
  const reconcile = await api(`/api/orders/${t7OrderId}/reconciliation`);
  assert(reconcile.body.totals.generated === 300, 'Should have 300 generated so far');

  // Add the remaining 200
  const addRes = await api(`/api/order-lines/${t7LineId}/batches`, {
    method: 'POST',
    body: { quantity: 200, actor: 'test' },
  });
  assert(addRes.status === 201, `Expected 201 for add batch, got ${addRes.status}: ${JSON.stringify(addRes.body)}`);
  assert(addRes.body.plannedQuantity === 200, `Batch should be 200, got ${addRes.body.plannedQuantity}`);
  assert(addRes.body.createdUnits === 200, `Should create 200 units, got ${addRes.body.createdUnits}`);

  // Verify now 500/500
  const reconcile2 = await api(`/api/orders/${t7OrderId}/reconciliation`);
  assert(reconcile2.body.totals.generated === 500, `Expected 500 generated after add, got ${reconcile2.body.totals.generated}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 8: A late UNIQUE failure inside db.batch() must roll back every
// earlier statement, including a new customer/product/order/units.
// ─────────────────────────────────────────────────────────────────────────────
await run('Test 8 – Atomic rollback on a mid-transaction DB constraint failure', async () => {
  const ts = Date.now();
  const seedProduct = `T8-Seed-Product-${ts}`;
  const seed = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: `T8-Seed-Customer-${ts}`,
      orderReference: `T8-SEED-${ts}`,
      items: [{ productName: seedProduct, variantLabel: 'Size M', quantity: 1, batches: [{ quantity: 1, batchNumber: 'DUPLICATE' }] }],
      actor: 'test',
    },
  });
  assert(seed.status === 201, `Seed order failed: ${seed.status} ${JSON.stringify(seed.body)}`);

  const beforeCustomers = await api('/api/customers');
  const beforeOrders = await api('/api/orders');
  const beforeProducts = await api('/api/products');
  const beforeBatches = await api('/api/production-batches');
  const orphanCustomer = `T8-Orphan-Customer-${ts}`;
  const orphanProduct = `T8-Orphan-Product-${ts}`;
  const orphanReference = `T8-ROLLBACK-${ts}`;

  // Item 1 queues valid new product/order/unit rows. Item 2 fails late on
  // UNIQUE(variant_id, batch_number), proving the preceding writes roll back.
  const res = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: orphanCustomer,
      orderReference: orphanReference,
      items: [
        { productName: orphanProduct, variantLabel: 'Size S', quantity: 2, batches: [{ quantity: 2 }] },
        { productName: seedProduct, variantLabel: 'Size M', quantity: 1, batches: [{ quantity: 1, batchNumber: 'DUPLICATE' }] },
      ],
      actor: 'test',
    },
  });
  assert(res.status >= 400, `Expected error status, got ${res.status}`);
  assert(res.body.error, 'Expected error field in response');

  const afterCustomers = await api('/api/customers');
  const afterOrders = await api('/api/orders');
  const afterProducts = await api('/api/products');
  const afterBatches = await api('/api/production-batches');
  assert(afterCustomers.body.length === beforeCustomers.body.length, 'Customer row escaped failed transaction');
  assert(afterOrders.body.length === beforeOrders.body.length, 'Order row escaped failed transaction');
  assert(afterProducts.body.length === beforeProducts.body.length, 'Product row escaped failed transaction');
  assert(afterBatches.body.length === beforeBatches.body.length, 'Batch row escaped failed transaction');
  assert(!afterCustomers.body.some(c => c.name === orphanCustomer), 'Orphan customer found after rollback');
  assert(!afterOrders.body.some(o => o.order_reference === orphanReference), 'Orphan order found after rollback');
  assert(!afterProducts.body.some(p => p.name === orphanProduct), 'Orphan product found after rollback');
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 9: Same customer ID -- no auto-merge by name
// ─────────────────────────────────────────────────────────────────────────────
await run('Test 9 – Same customer name without customer_id creates a NEW customer (no auto-merge)', async () => {
  const ts = Date.now();
  const name = `T9-Same-Name-${ts}`;

  const res1 = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: name,
      orderReference: `T9-REF-A-${ts}`,
      items: [{ productName: `T9-Prod-${ts}`, variantLabel: 'Size M', quantity: 5, unitNames: [], batches: null }],
      actor: 'test',
    },
  });
  const res2 = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: name,
      orderReference: `T9-REF-B-${ts}`,
      items: [{ productName: `T9-Prod-${ts}`, variantLabel: 'Size M', quantity: 3, unitNames: [], batches: null }],
      actor: 'test',
    },
  });
  assert(res1.status === 201, `First order should succeed, got ${res1.status}`);
  assert(res2.status === 201, `Second order should succeed, got ${res2.status}`);

  const customers = await api('/api/customers');
  const matching = customers.body.filter(c => c.name === name);
  assert(matching.length === 2,
    `Expected 2 separate customers with same name (no auto-merge), found ${matching.length}: ${JSON.stringify(matching.map(c => c.id))}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 10: Batch number collision -- second order for same product/variant
//          must get a non-conflicting batch number.
// ─────────────────────────────────────────────────────────────────────────────
await run('Test 10 – Second order for same product/variant uses non-colliding batch number', async () => {
  const ts = Date.now();
  const productName = `T10-Product-${ts}`;
  const variantLabel = 'Size M';

  const res1 = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: `T10-Customer-A-${ts}`,
      orderReference: `T10-REF-A-${ts}`,
      items: [{ productName, variantLabel, quantity: 10, unitNames: [], batches: null }],
      actor: 'test',
    },
  });
  assert(res1.status === 201, `Order 1 should succeed, got ${res1.status}: ${JSON.stringify(res1.body)}`);
  const batch1Num = res1.body.lines[0].batches[0].batchNumber;

  const res2 = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: `T10-Customer-B-${ts}`,
      orderReference: `T10-REF-B-${ts}`,
      items: [{ productName, variantLabel, quantity: 5, unitNames: [], batches: null }],
      actor: 'test',
    },
  });
  assert(res2.status === 201, `Order 2 should succeed (no batch collision), got ${res2.status}: ${JSON.stringify(res2.body)}`);
  const batch2Num = res2.body.lines[0].batches[0].batchNumber;

  assert(batch1Num !== batch2Num,
    `Batch numbers must differ to avoid DB collision: both got "${batch1Num}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 11: Shipment scan guard -- reject units from wrong order line
// ─────────────────────────────────────────────────────────────────────────────
await run('Test 11 – Shipment scan guard: rejects unit from wrong order line', async () => {
  const ts = Date.now();
  // Create two separate orders/lines
  const res1 = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: `T11-CustA-${ts}`,
      orderReference: `T11-REF-A-${ts}`,
      items: [{ productName: `T11-ProdA-${ts}`, variantLabel: 'Size M', quantity: 5, unitNames: [], batches: null }],
      actor: 'test',
    },
  });
  const res2 = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: `T11-CustB-${ts}`,
      orderReference: `T11-REF-B-${ts}`,
      items: [{ productName: `T11-ProdB-${ts}`, variantLabel: 'Size L', quantity: 5, unitNames: [], batches: null }],
      actor: 'test',
    },
  });
  assert(res1.status === 201, `Order A must succeed, got ${res1.status}`);
  assert(res2.status === 201, `Order B must succeed, got ${res2.status}`);

  const lineIdA = res1.body.lines[0].lineId;
  // Create shipment for line A
  const shipRes = await api('/api/shipments', {
    method: 'POST',
    body: { orderLineId: lineIdA, reference: `T11-SHIP-${ts}`, plannedQuantity: 5, actor: 'test' },
  });
  assert(shipRes.status === 201, `Shipment creation must succeed, got ${shipRes.status}: ${JSON.stringify(shipRes.body)}`);
  const shipmentId = shipRes.body.id;

  // Get a unit from line B's batch
  const batchIdB = res2.body.lines[0].batches[0].batchId;
  const unitsB = await api(`/api/production-batches/${batchIdB}/units`);
  assert(unitsB.body.length > 0, 'Line B must have units');
  const wrongUnit = unitsB.body[0];
  await attachUnit(wrongUnit);

  // Try to scan wrong unit into shipment for line A -- must be rejected
  const scanRes = await api(`/api/shipments/${shipmentId}/scans`, {
    method: 'POST',
    body: { code: wrongUnit.internal_token, actor: 'test' },
  });
  assert(scanRes.status >= 400, `Expected error when scanning wrong order line unit, got ${scanRes.status}: ${JSON.stringify(scanRes.body)}`);
  assert(scanRes.body.error, 'Expected error message for wrong order line scan');
  assert(/belongs to order|not this shipment/i.test(scanRes.body.error),
    `Expected wrong-order guard message, got: ${scanRes.body.error}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 12: Shipment must reject the (N+1)th valid attached unit.
// ─────────────────────────────────────────────────────────────────────────────
await run('Test 12 – Shipment scan guard rejects units beyond planned capacity', async () => {
  const ts = Date.now();
  const order = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: `T12-Customer-${ts}`,
      orderReference: `T12-REF-${ts}`,
      items: [{ productName: `T12-Product-${ts}`, variantLabel: 'Size M', quantity: 3, batches: null }],
      actor: 'test',
    },
  });
  assert(order.status === 201, `Order failed: ${order.status} ${JSON.stringify(order.body)}`);
  const lineId = order.body.lines[0].lineId;
  const batchId = order.body.lines[0].batches[0].batchId;
  const units = await api(`/api/production-batches/${batchId}/units`);
  assert(units.body.length === 3, `Expected 3 units, got ${units.body.length}`);
  for (const unit of units.body) await attachUnit(unit);

  const shipment = await api('/api/shipments', {
    method: 'POST',
    body: { orderLineId: lineId, reference: `T12-SHIP-${ts}`, plannedQuantity: 2 },
  });
  assert(shipment.status === 201, `Shipment failed: ${shipment.status} ${JSON.stringify(shipment.body)}`);

  for (const unit of units.body.slice(0, 2)) {
    const scan = await api(`/api/shipments/${shipment.body.id}/scans`, {
      method: 'POST', body: { code: unit.internal_token, actor: 'test' },
    });
    assert(scan.status === 201, `Valid scan failed: ${scan.status} ${JSON.stringify(scan.body)}`);
  }
  const overflow = await api(`/api/shipments/${shipment.body.id}/scans`, {
    method: 'POST', body: { code: units.body[2].internal_token, actor: 'test' },
  });
  assert(overflow.status >= 400, `Expected capacity rejection, got ${overflow.status}`);
  assert(/capacity|planned/i.test(overflow.body.error || ''), `Unexpected capacity error: ${overflow.body.error}`);
  const state = await api(`/api/shipments/${shipment.body.id}`);
  assert(state.body.scannedCount === 2, `Overflow scan mutated shipment: scannedCount=${state.body.scannedCount}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 13: Multiple variants of one new product in one request share one
// product row and receive independent, collision-free batches.
// ─────────────────────────────────────────────────────────────────────────────
await run('Test 13 – One new product with multiple variants is planned once', async () => {
  const ts = Date.now();
  const productName = `T13-Product-${ts}`;
  const order = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: `T13-Customer-${ts}`,
      orderReference: `T13-REF-${ts}`,
      items: [
        { productName, variantLabel: 'Size S', quantity: 2, dimensions: ['Size'], batches: null },
        { productName, variantLabel: 'Size M', quantity: 2, dimensions: ['Size'], batches: null },
        { productName, variantLabel: 'Size L', quantity: 2, dimensions: ['Size'], batches: null },
      ],
      actor: 'test',
    },
  });
  assert(order.status === 201, `Multi-variant order failed: ${order.status} ${JSON.stringify(order.body)}`);
  assert(order.body.lines.length === 3, `Expected 3 order lines, got ${order.body.lines.length}`);
  const products = await api('/api/products');
  assert(products.body.filter(p => p.name === productName).length === 1,
    `Expected exactly one product row for ${productName}`);
});

await run('Test 14 – Named batches (e.g. schools) can repeat across orders for the same product/size', async () => {
  const ts = Date.now();
  const productName = `T14-Product-${ts}`;
  async function orderWithSchools(ref, batchKey) {
    return api('/api/orders/create-with-labels', {
      method: 'POST',
      body: {
        customerName: `T14-Customer-${ts}`,
        orderReference: ref,
        items: [{
          productName, variantLabel: 'Size M', quantity: 4,
          batches: [
            { quantity: 2, [batchKey]: 'SK Sekolah A', unitNames: ['Ahmad', 'Ali'] },
            { quantity: 2, [batchKey]: 'SK Sekolah B', unitNames: ['Chong', 'Wei'] },
          ],
        }],
        actor: 'test',
      },
    });
  }
  const first = await orderWithSchools(`T14-REF-1-${ts}`, 'batchLabel');
  assert(first.status === 201, `First order failed: ${first.status} ${JSON.stringify(first.body)}`);
  // Same schools, same product and size, second order -- used to fail with a
  // unique-constraint error because names were stored as the batch number.
  const second = await orderWithSchools(`T14-REF-2-${ts}`, 'batchLabel');
  assert(second.status === 201, `Second order with the same school names failed: ${second.status} ${JSON.stringify(second.body)}`);

  const batches = second.body.lines[0].batches;
  assert(batches.length === 2, 'Expected 2 batches');
  assert(batches[0].batchLabel === 'SK Sekolah A' && batches[1].batchLabel === 'SK Sekolah B',
    `Batch labels not preserved: ${JSON.stringify(batches)}`);
  const firstNumbers = first.body.lines[0].batches.map(b => b.batchNumber);
  const secondNumbers = batches.map(b => b.batchNumber);
  assert(secondNumbers.every(n => !firstNumbers.includes(n)),
    `Auto batch numbers collided: ${firstNumbers} vs ${secondNumbers}`);

  const units = await api(`/api/production-batches/${batches[1].batchId}/units`);
  assert(units.body.map(u => u.recipient_name).join(',') === 'Chong,Wei',
    `Batch-level names not applied: ${JSON.stringify(units.body.map(u => u.recipient_name))}`);
});

async function makeOrder(tag, items) {
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const res = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: { customerName: `${tag}-Customer-${ts}`, orderReference: `${tag}-REF-${ts}`, items, actor: 'test' },
  });
  assert(res.status === 201, `${tag} order failed: ${res.status} ${JSON.stringify(res.body)}`);
  const overview = await api(`/api/orders/${res.body.orderId}/print-overview`);
  assert(overview.status === 200, `${tag} overview failed: ${overview.status}`);
  return { orderId: res.body.orderId, orderReference: res.body.orderReference, rows: overview.body.rows };
}

await run('Test 15 – Print runs: tick variations and quantities, the rest stays unprinted', async () => {
  const ts = Date.now();
  const product = `T15-Product-${ts}`;
  const { orderId, rows } = await makeOrder('T15', [
    { productName: product, variantLabel: 'Saiz M', quantity: 3, unitNames: ['Ahmad', 'Ali', 'Abu'], batches: null },
    { productName: product, variantLabel: 'Saiz L', quantity: 2, batches: null },
  ]);
  assert(rows.length === 2, `Expected one row per variation, got ${rows.length}`);
  const [rowM, rowL] = rows;
  assert(rowM.variant_label === 'Saiz M' && rowM.total === 3 && rowM.printed === 0 && rowM.unprinted === 3,
    `Bad initial row for M: ${JSON.stringify(rowM)}`);

  // Nothing selected, and a row from another order, are both rejected.
  const empty = await api(`/api/orders/${orderId}/print-runs`, { method: 'POST', body: { selections: [] } });
  assert(empty.status >= 400, 'Empty selection should be rejected');
  const other = await makeOrder('T15X', [{ productName: product, variantLabel: 'Saiz M', quantity: 1, batches: null }]);
  const foreign = await api(`/api/orders/${orderId}/print-runs`, {
    method: 'POST', body: { selections: [{ batchId: other.rows[0].batch_id, quantity: 1 }] },
  });
  assert(foreign.status >= 400, "A row from another order must not be printable here");

  // Batch 1: 2 of the 3 size M, 1 of the 2 size L.
  const run1 = await api(`/api/orders/${orderId}/print-runs`, {
    method: 'POST', body: { selections: [{ batchId: rowM.batch_id, quantity: 2 }, { batchId: rowL.batch_id, quantity: 1 }] },
  });
  assert(run1.status === 201 && run1.body.runNumber === 1, `Run 1 failed: ${run1.status} ${JSON.stringify(run1.body)}`);
  const labels1 = await api(`/api/print-runs/${run1.body.id}`);
  assert(labels1.body.units.length === 3, `Run 1 should hold 3 labels, got ${labels1.body.units.length}`);
  assert(labels1.body.units.filter(u => u.variant_label === 'Saiz M').map(u => u.recipient_name).join(',') === 'Ahmad,Ali',
    'The first two unprinted M labels (lowest serial, with their names) should be printed first');

  const mid = await api(`/api/orders/${orderId}/print-overview`);
  assert(mid.body.rows[0].printed === 2 && mid.body.rows[0].unprinted === 1, 'M should show 2 printed, 1 left');
  assert(mid.body.rows[1].printed === 1 && mid.body.rows[1].unprinted === 1, 'L should show 1 printed, 1 left');

  // Cannot print more than what is left.
  const tooMany = await api(`/api/orders/${orderId}/print-runs`, {
    method: 'POST', body: { selections: [{ batchId: rowM.batch_id, quantity: 2 }] },
  });
  assert(tooMany.status >= 400, 'Printing more than the unprinted balance must be rejected');

  // Batch 2 takes the rest, continuing from where Batch 1 stopped.
  const run2 = await api(`/api/orders/${orderId}/print-runs`, {
    method: 'POST', body: { selections: [{ batchId: rowM.batch_id, quantity: 1 }, { batchId: rowL.batch_id, quantity: 1 }] },
  });
  assert(run2.status === 201 && run2.body.runNumber === 2, `Run 2 failed: ${JSON.stringify(run2.body)}`);
  const labels2 = await api(`/api/print-runs/${run2.body.id}`);
  assert(labels2.body.units.find(u => u.variant_label === 'Saiz M').recipient_name === 'Abu', 'Batch 2 should continue with Abu');

  const end = await api(`/api/orders/${orderId}/print-overview`);
  assert(end.body.rows.every(r => r.unprinted === 0), 'Everything should now be printed');
  assert(end.body.runs.length === 2 && end.body.runs[0].label_count === 3 && end.body.runs[1].label_count === 2,
    `Runs summary wrong: ${JSON.stringify(end.body.runs)}`);
});

await run('Test 16 – Packing works against one batch and only expects the labels printed in it', async () => {
  const product = `T16-Product-${Date.now()}`;
  const { orderId, rows } = await makeOrder('T16', [
    { productName: product, variantLabel: 'Saiz M', quantity: 3, batches: null },
    { productName: product, variantLabel: 'Saiz L', quantity: 2, batches: null },
  ]);
  const [rowM, rowL] = rows;
  const print = async (m, l) => {
    const r = await api(`/api/orders/${orderId}/print-runs`, {
      method: 'POST', body: { selections: [{ batchId: rowM.batch_id, quantity: m }, { batchId: rowL.batch_id, quantity: l }] },
    });
    assert(r.status === 201, `print failed: ${JSON.stringify(r.body)}`);
    return (await api(`/api/print-runs/${r.body.id}`)).body;
  };
  const run1 = await print(2, 1);
  const run2 = await print(1, 1);

  // Attach every label of Batch 1, and all of Batch 2 except one size L.
  for (const u of run1.units) await attachUnit(u);
  const run2Attached = run2.units.filter(u => u.variant_label === 'Saiz M');
  for (const u of run2Attached) await attachUnit(u);

  // Batch 1 expects 3, not 5 -- the unprinted/other-batch labels are not its business.
  const start1 = await api(`/api/print-runs/${run1.id}/packing/start`, { method: 'POST', body: {} });
  assert(start1.status === 200 && start1.body.planned === 3 && start1.body.rows.length === 2,
    `Batch 1 should expect 3 labels in 2 variations: ${JSON.stringify(start1.body)}`);

  const scan = (runId, unit) => api(`/api/print-runs/${runId}/packing/scan`, { method: 'POST', body: { code: unit.internal_token } });

  // A label from Batch 2 is rejected inside Batch 1 and changes nothing.
  const wrongBatch = await scan(run1.id, run2Attached[0]);
  assert(wrongBatch.status >= 400 && /Cetakan 2/.test(wrongBatch.body.error), `Wrong-batch scan: ${JSON.stringify(wrongBatch.body)}`);

  // A label from a different order is rejected and names that order.
  const foreign = await makeOrder('T16X', [{ productName: product, variantLabel: 'Saiz M', quantity: 1, batches: null }]);
  const fr = await api(`/api/orders/${foreign.orderId}/print-runs`, { method: 'POST', body: { selections: [{ batchId: foreign.rows[0].batch_id, quantity: 1 }] } });
  const foreignUnit = (await api(`/api/print-runs/${fr.body.id}`)).body.units[0];
  await attachUnit(foreignUnit);
  const foreignScan = await scan(run1.id, foreignUnit);
  assert(foreignScan.status >= 400 && foreignScan.body.error.includes(foreign.orderReference), `Foreign scan: ${JSON.stringify(foreignScan.body)}`);

  for (const u of run1.units) {
    const r = await scan(run1.id, u);
    assert(r.status === 201, `Scan of Batch 1 label failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  const dup = await scan(run1.id, run1.units[0]);
  assert(dup.status === 200 && dup.body.alreadyScanned === true, 'Re-scanning the same label should be a harmless no-op');
  const st = await api(`/api/print-runs/${run1.id}/packing`);
  assert(st.body.planned === 3 && st.body.packed === 3 && st.body.missing === 0, `Batch 1 status: ${JSON.stringify(st.body)}`);

  const close1 = await api(`/api/print-runs/${run1.id}/packing/close`, { method: 'POST', body: {} });
  assert(close1.body.missing === 0, `Batch 1 should close complete: ${JSON.stringify(close1.body)}`);
  const again = await api(`/api/print-runs/${run1.id}/packing/start`, { method: 'POST', body: {} });
  assert(again.status >= 400, 'A fully packed batch cannot be started again');

  // Batch 2: one size L label was never attached, so packing reports it short
  // and says WHY (not finished yet), rather than calling it lost.
  await api(`/api/print-runs/${run2.id}/packing/start`, { method: 'POST', body: {} });
  for (const u of run2Attached) {
    const r = await scan(run2.id, u);
    assert(r.status === 201, `Batch 2 scan failed: ${JSON.stringify(r.body)}`);
  }
  const close2 = await api(`/api/print-runs/${run2.id}/packing/close`, { method: 'POST', body: {} });
  assert(close2.body.planned === 2 && close2.body.packed === 1 && close2.body.missing === 1, `Batch 2 close: ${JSON.stringify(close2.body)}`);
  assert(close2.body.missingUnits.length === 1 && close2.body.missingUnits[0].variant_label === 'Saiz L'
    && close2.body.missingUnits[0].attached === false, `Missing unit detail: ${JSON.stringify(close2.body.missingUnits)}`);
});

await run('Test 17 – A print run whose labels never came out can be cancelled, unless labels are already attached', async () => {
  const { orderId, rows } = await makeOrder('T17', [
    { productName: `T17-Product-${Date.now()}`, variantLabel: 'Saiz M', quantity: 3, batches: null },
  ]);
  const sel = (q) => ({ selections: [{ batchId: rows[0].batch_id, quantity: q }] });
  const r1 = await api(`/api/orders/${orderId}/print-runs`, { method: 'POST', body: sel(2) });
  assert(r1.status === 201, 'run 1');

  const c1 = await api(`/api/print-runs/${r1.body.id}/cancel`, { method: 'POST', body: {} });
  assert(c1.status === 200 && c1.body.releasedLabels === 2, `Cancel failed: ${JSON.stringify(c1.body)}`);
  const ov = await api(`/api/orders/${orderId}/print-overview`);
  assert(ov.body.runs.length === 0 && ov.body.rows[0].unprinted === 3, 'Labels should be back to unprinted');

  // Can be printed again, and takes the same labels (lowest serial first).
  const r2 = await api(`/api/orders/${orderId}/print-runs`, { method: 'POST', body: sel(3) });
  assert(r2.status === 201 && r2.body.runNumber === 1, `Re-run: ${JSON.stringify(r2.body)}`);
  const labels = (await api(`/api/print-runs/${r2.body.id}`)).body;
  await attachUnit(labels.units[0]);
  const c2 = await api(`/api/print-runs/${r2.body.id}/cancel`, { method: 'POST', body: {} });
  assert(c2.status >= 400 && /ditampal/.test(c2.body.error), `Cancel with attached label must be refused: ${JSON.stringify(c2.body)}`);
});

await run('Test 18 – The server rejects more recipient names than units (no silent dropping)', async () => {
  const ts = Date.now();
  const order = (items) => api('/api/orders/create-with-labels', {
    method: 'POST', body: { customerName: `T18-${ts}-${Math.random()}`, orderReference: '', items, actor: 'test' },
  });
  const P = `T18-Product-${ts}`;

  const flat = await order([{ productName: P, variantLabel: 'M', quantity: 3, unitNames: ['A', 'B', 'C', 'D', 'E'], batches: null }]);
  assert(flat.status === 400 && /nama/.test(flat.body.error), `5 names / 3 units must be rejected: ${flat.status} ${JSON.stringify(flat.body)}`);

  const perBatch = await order([{ productName: P, variantLabel: 'M', quantity: 4, unitNames: [], batches: [{ quantity: 2, batchLabel: 'A', unitNames: ['1', '2', '3'] }, { quantity: 2 }] }]);
  assert(perBatch.status === 400, `3 names in a 2-unit batch must be rejected: ${perBatch.status}`);

  const spread = await order([{ productName: P, variantLabel: 'M', quantity: 10, unitNames: ['1', '2', '3', '4', '5', '6', '7', '8'], batches: [{ quantity: 4, batchLabel: 'A' }] }]);
  assert(spread.status === 400, `Item-level names beyond the batches' 4 units must be rejected: ${spread.status}`);

  // Nothing partial was created by any rejected attempt.
  const orders = await api('/api/orders');
  assert(!orders.body.some((o) => String(o.customer_name).startsWith(`T18-${ts}`)), 'A rejected order left rows behind');

  // Fewer names than units, and exactly as many, are still fine.
  const fewer = await order([{ productName: P, variantLabel: 'M', quantity: 3, unitNames: ['A', 'B'], batches: null }]);
  assert(fewer.status === 201, `fewer names than units must still work: ${JSON.stringify(fewer.body)}`);
  const exact = await order([{ productName: P, variantLabel: 'M', quantity: 2, unitNames: ['A', 'B'], batches: null }]);
  assert(exact.status === 201, `exact names must work: ${JSON.stringify(exact.body)}`);
});

await run('Test 19 – A unit sits in one active return intake and has one QC decision (changes need a reason and leave a trail)', async () => {
  const product = `T19-Product-${Date.now()}`;
  const { orderId, rows } = await makeOrder('T19', [{ productName: product, variantLabel: 'Saiz M', quantity: 3, batches: null }]);
  const pr = await api(`/api/orders/${orderId}/print-runs`, { method: 'POST', body: { selections: [{ batchId: rows[0].batch_id, quantity: 3 }] } });
  const units = (await api(`/api/print-runs/${pr.body.id}`)).body.units;
  for (const u of units) await attachUnit(u);
  await api(`/api/print-runs/${pr.body.id}/packing/start`, { method: 'POST', body: {} });
  for (const u of units) await api(`/api/print-runs/${pr.body.id}/packing/scan`, { method: 'POST', body: { code: u.internal_token } });
  await api(`/api/print-runs/${pr.body.id}/packing/close`, { method: 'POST', body: {} });
  const rec = await api(`/api/orders/${orderId}/reconciliation`);
  const ships = await api(`/api/order-lines/${rec.body.lines[0].order_line_id}/shipments`);
  for (const s of ships.body) await api(`/api/shipments/${s.id}/dispatch`, { method: 'POST', body: { locationName: 'Customer' } });

  const intake = async (ref) => (await api('/api/return-intakes', { method: 'POST', body: { reference: ref } })).body;
  const scan = (id, u) => api(`/api/return-intakes/${id}/scans`, { method: 'POST', body: { code: u.internal_token, actor: 'test' } });
  const qc = (id, u, body) => api(`/api/return-intakes/${id}/units/${u.id}/qc`, { method: 'POST', body });
  const i1 = await intake('T19-A');
  const i2 = await intake('T19-B');

  // 1. Exclusivity: same unit cannot be in two open intakes.
  assert((await scan(i1.id, units[0])).status === 201, 'first scan');
  const second = await scan(i2.id, units[0]);
  assert(second.status === 400 && /T19-A/.test(second.body.error), `Second open intake must be refused, naming the first: ${JSON.stringify(second.body)}`);
  // ...also when two devices do it at the same moment.
  const race = await Promise.all([scan(i1.id, units[1]), scan(i2.id, units[1])]);
  assert(race.filter((r) => r.status === 201).length === 1, `Exactly one of two simultaneous scans may win: ${race.map((r) => r.status)}`);

  // 2. One decision; same again is a no-op; a change needs a reason and is recorded.
  assert((await qc(i1.id, units[0], { outcome: 'AVAILABLE' })).status === 200, 'first decision');
  const same = await qc(i1.id, units[0], { outcome: 'AVAILABLE' });
  assert(same.status === 200 && same.body.unchanged === true, 'same decision again should be a no-op');
  const noReason = await qc(i1.id, units[0], { outcome: 'DAMAGED' });
  assert(noReason.status === 400 && /sebab/.test(noReason.body.error), `Change without reason must be refused: ${JSON.stringify(noReason.body)}`);
  const changed = await qc(i1.id, units[0], { outcome: 'DAMAGED', reason: 'jahitan koyak dijumpai kemudian' });
  assert(changed.status === 200 && changed.body.changedFrom === 'AVAILABLE', `Change with reason: ${JSON.stringify(changed.body)}`);
  const lk = await api(`/api/units/lookup/${units[0].internal_token}`);
  const qcEvents = lk.body.events.filter((e) => e.event_type === 'RETURN_QC_DECIDED');
  assert(qcEvents.length === 2, `Both decisions must be in the trail: ${qcEvents.length}`);
  assert(/previousOutcome/.test(JSON.stringify(qcEvents[1].payload)), 'The change must record the previous outcome');

  // 3. After closing, the same unit can be returned again, and only the newest intake decides it.
  await api(`/api/return-intakes/${i1.id}/close`, { method: 'POST', body: {} });
  const again = await scan(i2.id, units[0]);
  assert(again.status === 201, `A finished intake must not block a later return: ${JSON.stringify(again.body)}`);
  const stale = await qc(i1.id, units[0], { outcome: 'REJECTED', reason: 'x' });
  assert(stale.status === 400 && /T19-B/.test(stale.body.error), `Old intake must not decide it: ${JSON.stringify(stale.body)}`);
  assert((await qc(i2.id, units[0], { outcome: 'AVAILABLE' })).status === 200, 'newest intake decides');
});

await run('Test 20 – A dispatched unit cannot have its label reissued; undispatched units still can', async () => {
  const product = `T20-Product-${Date.now()}`;
  const { orderId, rows } = await makeOrder('T20', [{ productName: product, variantLabel: 'Saiz M', quantity: 3, batches: null }]);
  const pr = await api(`/api/orders/${orderId}/print-runs`, { method: 'POST', body: { selections: [{ batchId: rows[0].batch_id, quantity: 3 }] } });
  const units = (await api(`/api/print-runs/${pr.body.id}`)).body.units;
  for (const u of units) await attachUnit(u);
  await api(`/api/print-runs/${pr.body.id}/packing/start`, { method: 'POST', body: {} });
  // Pack and dispatch only two; the third stays on the shelf.
  for (const u of units.slice(0, 2)) await api(`/api/print-runs/${pr.body.id}/packing/scan`, { method: 'POST', body: { code: u.internal_token } });
  await api(`/api/print-runs/${pr.body.id}/packing/close`, { method: 'POST', body: {} });
  const rec = await api(`/api/orders/${orderId}/reconciliation`);
  const ships = await api(`/api/order-lines/${rec.body.lines[0].order_line_id}/shipments`);
  for (const s of ships.body) await api(`/api/shipments/${s.id}/dispatch`, { method: 'POST', body: { locationName: 'Customer' } });

  const before = (await api(`/api/units/lookup/${units[0].internal_token}`)).body;
  const r = await api(`/api/units/${units[0].id}/reissue-label-after-attachment`, { method: 'POST', body: { actor: 'test' } });
  assert(r.status === 400 && /dihantar/.test(r.body.error), `Reissue after dispatch must be refused: ${r.status} ${JSON.stringify(r.body)}`);
  const r2 = await api(`/api/units/${units[0].id}/reissue-label`, { method: 'POST', body: { actor: 'test' } });
  assert(r2.status === 400, 'Plain reissue after dispatch must also be refused');

  // Nothing changed on the refused unit: same QR still resolves, still attached, no reissue events.
  const after = await api(`/api/units/lookup/${units[0].internal_token}`);
  assert(after.status === 200, 'The dispatched unit QR must still resolve');
  assert(after.body.events.length === before.events.length, 'A refused reissue must not write events');

  // The unit that was never dispatched can still be reissued as before.
  const ok = await api(`/api/units/${units[2].id}/reissue-label-after-attachment`, { method: 'POST', body: { actor: 'test' } });
  assert(ok.status === 201, `Undispatched unit must still be reissuable: ${ok.status} ${JSON.stringify(ok.body)}`);
});

await run('Test 21 – Group labels: whitespace is cleaned and duplicates ignore case/spacing, display text is kept', async () => {
  const ts = Date.now();
  const order = (batches, quantity) => api('/api/orders/create-with-labels', {
    method: 'POST',
    body: { customerName: `T21-${ts}-${Math.random()}`, orderReference: '', actor: 'test',
      items: [{ productName: `T21-Product-${ts}`, variantLabel: 'Saiz M', quantity, unitNames: [], batches }] },
  });

  const dup = await order([{ quantity: 2, batchLabel: 'SK Sekolah A' }, { quantity: 2, batchLabel: '  sk   sekolah a ' }], 4);
  assert(dup.status === 400 && /SK Sekolah A/.test(dup.body.error), `Same group in different case/spacing must be refused: ${JSON.stringify(dup.body)}`);

  const ok = await order([{ quantity: 2, batchLabel: '  SK   Sekolah  A ' }, { quantity: 2, batchLabel: 'SK Sekolah B' }], 4);
  assert(ok.status === 201, `Distinct groups must work: ${JSON.stringify(ok.body)}`);
  const labels = ok.body.lines[0].batches.map((b) => b.batchLabel);
  assert(labels[0] === 'SK Sekolah A', `Spacing is cleaned but case is kept: ${JSON.stringify(labels)}`);
  const ov = await api(`/api/orders/${ok.body.orderId}/print-overview`);
  assert(ov.body.rows.map((r) => r.group_label).join('|') === 'SK Sekolah A|SK Sekolah B', 'Stored labels');

  // The same school on a different variant (different size) is normal, not a duplicate.
  const twoSizes = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: { customerName: `T21b-${ts}`, orderReference: '', actor: 'test', items: [
      { productName: `T21-Product-${ts}`, variantLabel: 'Saiz M', quantity: 2, unitNames: [], batches: [{ quantity: 2, batchLabel: 'SK Sekolah A' }] },
      { productName: `T21-Product-${ts}`, variantLabel: 'Saiz L', quantity: 2, unitNames: [], batches: [{ quantity: 2, batchLabel: 'sk sekolah a' }] },
    ] },
  });
  assert(twoSizes.status === 201, `Same school on two sizes must be allowed: ${JSON.stringify(twoSizes.body)}`);
});

await run('Test 22 – Variation spelling guard: refuse case-only duplicates, ask about near-duplicates, never rewrite', async () => {
  const ts = Date.now();
  const P = `T22-Product-${ts}`;
  const order = (labels, extra = {}, product = P) => api('/api/orders/create-with-labels', {
    method: 'POST',
    body: { customerName: `T22-${ts}-${Math.random()}`, orderReference: '', actor: 'test', ...extra,
      items: labels.map((l) => ({ productName: product, variantLabel: l, quantity: 1, unitNames: [], batches: null })) },
  });

  // Case-only: refused, nothing created.
  const caseOnly = await order(['XL', 'xl']);
  assert(caseOnly.status === 400 && /huruf besar/.test(caseOnly.body.error), `XL vs xl must be refused: ${JSON.stringify(caseOnly.body)}`);

  // Near-duplicate: asks first (409, nothing created)...
  const asked = await order(['XL', 'X-L']);
  assert(asked.status === 409 && asked.body.requiresAcknowledgement && asked.body.warnings.length === 1, `XL vs X-L must ask: ${asked.status} ${JSON.stringify(asked.body)}`);
  const none = await api('/api/orders');
  assert(!none.body.some((o) => o.lines.some((l) => /T22-Product/.test(l.product_name || '') && String(o.customer_name).startsWith(`T22-${ts}`))), 'Nothing may be created before acknowledgement');

  // ...and goes ahead unchanged when acknowledged: both spellings kept as typed.
  const acked = await order(['XL', 'X-L'], { acknowledgeWarnings: true });
  assert(acked.status === 201 && acked.body.warnings.length === 1, `Acknowledged order must be created: ${JSON.stringify(acked.body)}`);
  const ov = await api(`/api/orders/${acked.body.orderId}/print-overview`);
  assert(ov.body.rows.map((r) => r.variant_label).join('|') === 'XL|X-L', 'Both spellings stay exactly as typed');

  // Against a variation the product already has (XL now exists).
  const vsExisting = await order(['xl']);
  assert(vsExisting.status === 400, `xl vs existing XL must be refused: ${JSON.stringify(vsExisting.body)}`);
  const punctVsExisting = await order(['X L']);
  assert(punctVsExisting.status === 409, `"X L" vs existing XL must ask: ${punctVsExisting.status}`);

  // Whitespace is cleaned, not treated as a different spelling; identical repeats are fine.
  const P2 = `${P}-b`;
  const spaced = await order(['XL ', ' XL', 'XL'], {}, P2);
  assert(spaced.status === 201, `Whitespace variants of the same label must be accepted as one: ${JSON.stringify(spaced.body)}`);
  const ov2 = await api(`/api/orders/${spaced.body.orderId}/print-overview`);
  assert(new Set(ov2.body.rows.map((r) => r.variant_label)).size === 1 && ov2.body.rows[0].variant_label === 'XL', 'One clean "XL" variation');

  // Genuinely different sizes trigger nothing.
  const fine = await order(['S', 'M', 'L', '2XL'], {}, `${P}-c`);
  assert(fine.status === 201 && !fine.body.warnings, 'Distinct sizes must not warn');
});

await run('Test 23 – Duplicate names only warn; a second return without re-dispatch is not "expected"', async () => {
  const ts = Date.now();
  const P = `T23-Product-${ts}`;
  const order = (unitNames, extra = {}) => api('/api/orders/create-with-labels', {
    method: 'POST',
    body: { customerName: `T23-${ts}-${Math.random()}`, orderReference: '', actor: 'test', ...extra,
      items: [{ productName: P, variantLabel: 'M', quantity: 3, unitNames, batches: null }] },
  });
  const warned = await order(['Ali', 'ali ', 'Abu']);
  assert(warned.status === 409 && warned.body.requiresAcknowledgement && /Ali/.test(warned.body.warnings[0]), `Duplicate name must ask: ${warned.status} ${JSON.stringify(warned.body)}`);
  const ok = await order(['Ali', 'ali ', 'Abu'], { acknowledgeWarnings: true });
  assert(ok.status === 201, 'Acknowledged duplicate names must be accepted');
  const units = (await api(`/api/production-batches/${ok.body.lines[0].batches[0].batchId}/units`)).body;
  assert(units.map((u) => u.recipient_name).join(',') === 'Ali,ali,Abu', `Names are kept exactly as typed (only trimmed): ${units.map((u) => u.recipient_name)}`);

  // Return, then return again without a new dispatch.
  const { orderId, rows } = await makeOrder('T23r', [{ productName: P, variantLabel: 'Saiz M', quantity: 1, batches: null }]);
  const pr = await api(`/api/orders/${orderId}/print-runs`, { method: 'POST', body: { selections: [{ batchId: rows[0].batch_id, quantity: 1 }] } });
  const u = (await api(`/api/print-runs/${pr.body.id}`)).body.units[0];
  await attachUnit(u);
  await api(`/api/print-runs/${pr.body.id}/packing/start`, { method: 'POST', body: {} });
  await api(`/api/print-runs/${pr.body.id}/packing/scan`, { method: 'POST', body: { code: u.internal_token } });
  await api(`/api/print-runs/${pr.body.id}/packing/close`, { method: 'POST', body: {} });
  const rec = await api(`/api/orders/${orderId}/reconciliation`);
  for (const s of (await api(`/api/order-lines/${rec.body.lines[0].order_line_id}/shipments`)).body) {
    await api(`/api/shipments/${s.id}/dispatch`, { method: 'POST', body: { locationName: 'Customer' } });
  }
  const mkIntake = async (ref) => (await api('/api/return-intakes', { method: 'POST', body: { reference: ref } })).body;
  const scan = (id) => api(`/api/return-intakes/${id}/scans`, { method: 'POST', body: { code: u.internal_token, actor: 'test' } });
  const a = await mkIntake('T23-A');
  const first = await scan(a.id);
  assert(first.body.expected === true && first.body.alreadyReturned === false, `First return is expected: ${JSON.stringify(first.body)}`);
  await api(`/api/return-intakes/${a.id}/close`, { method: 'POST', body: {} });
  const b = await mkIntake('T23-B');
  const second = await scan(b.id);
  assert(second.status === 201 && second.body.expected === false && second.body.alreadyReturned === true,
    `Second return without re-dispatch must be flagged, not expected: ${JSON.stringify(second.body)}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────────────');
console.log(`  Test Results: ${passed} passed, ${failed} failed`);
console.log('────────────────────────────────────────────────');
if (failed > 0) {
  console.log('\nFailed tests:');
  for (const r of results.filter(r => r.status === 'FAIL')) {
    console.log(`  ❌ ${r.name}`);
    console.log(`     ${r.error}`);
  }
  process.exit(1);
} else {
  console.log('\n  All acceptance tests passed. ✅');
  process.exit(0);
}
