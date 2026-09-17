/**
 * Labelism Acceptance Test Suite – tests/acceptance.test.js
 *
 * Runs 11 acceptance tests against a live local wrangler dev server.
 * All tests use real HTTP endpoints (no internal service calls).
 *
 * Prerequisites:
 *   - npx wrangler dev --port 8788  (running in background)
 *   - NODE_ENV=development in .dev.vars (skips auth)
 *
 * Run:
 *   node tests/acceptance.test.js
 */

const BASE = 'http://127.0.0.1:8788';

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

async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const json = await res.json();
  return { status: res.status, body: json };
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
// TEST 8 (Fix 8): Atomic failure – bad batch data causes DB constraint;
// verify NO orphan rows remain after the failed request.
// ─────────────────────────────────────────────────────────────────────────────
await run('Test 8 – Atomic failure: invalid batch rejects entire order, no orphan rows', async () => {
  const ts = Date.now();
  // Count rows before
  const beforeOrders = await api('/api/orders');
  const beforeCount = Array.isArray(beforeOrders.body) ? beforeOrders.body.length : 0;

  // Send a payload where batch sum EXCEEDS quantity -- server must reject before writing
  const res = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: {
      customerName: `T8-Orphan-${ts}`,
      orderReference: `T8-FAIL-REF-${ts}`,
      items: [
        {
          productName: `T8-Product-${ts}`,
          variantLabel: 'Size XS',
          quantity: 50,
          unitNames: [],
          batches: [{ quantity: 30 }, { quantity: 30 }],  // 60 > 50, must fail
        },
      ],
      actor: 'test',
    },
  });
  assert(res.status >= 400, `Expected error status, got ${res.status}`);
  assert(res.body.error, 'Expected error field in response');

  // Count rows after -- must be same
  const afterOrders = await api('/api/orders');
  const afterCount = Array.isArray(afterOrders.body) ? afterOrders.body.length : 0;
  assert(afterCount === beforeCount,
    `Order count changed after failed request: before=${beforeCount}, after=${afterCount}. Orphan row(s) detected!`);
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
  const lineIdB = res2.body.lines[0].lineId;
  const batchIdA = res1.body.lines[0].batches[0].batchId;

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

  // Try to scan wrong unit into shipment for line A -- must be rejected
  const scanRes = await api(`/api/shipments/${shipmentId}/scans`, {
    method: 'POST',
    body: { token: wrongUnit.internal_token, actor: 'test' },
  });
  assert(scanRes.status >= 400, `Expected error when scanning wrong order line unit, got ${scanRes.status}: ${JSON.stringify(scanRes.body)}`);
  assert(scanRes.body.error, 'Expected error message for wrong order line scan');
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
