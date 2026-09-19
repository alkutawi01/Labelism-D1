/**
 * End-to-end simulation of the factory workflow (see simulasi-labelism.md).
 * Same steps a person does in the browser, driven over real HTTP.
 *
 *   node tests/simulation.js            (LABELISM_TEST_BASE_URL to override)
 *
 * Needs a local dev server with auth bypassed (no secrets in .dev.vars).
 */
const BASE = process.env.LABELISM_TEST_BASE_URL || 'http://127.0.0.1:8788';
const cookie = '';
let step = 0;
let bad = 0;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
function check(label, ok, detail) {
  step++;
  if (!ok) bad++;
  console.log(`${ok ? '  OK  ' : ' GAGAL'}  ${label}${ok ? '' : `\n         ${detail}`}`);
}
const json = (x) => JSON.stringify(x);

// ---- Langkah 4: sahkan tempahan (data selepas pembetulan di Langkah 3) ----
const items = [
  { productName: 'Baju Kurung Sekolah', variantLabel: 'Saiz M', quantity: 4, unitNames: ['Aisyah', 'Balqis', 'Dania', 'Farah'], batches: null },
  { productName: 'Baju Kurung Sekolah', variantLabel: 'Saiz L', quantity: 6, unitNames: [], batches: [
    { quantity: 3, batchLabel: 'SK Sekolah A', unitNames: ['Hana', 'Iman', 'Julia'] },
    { quantity: 3, batchLabel: 'SK Sekolah B', unitNames: ['Kirana', 'Laila', 'Maya'] },
  ] },
  { productName: 'Tudung', variantLabel: 'Saiz S', quantity: 4, unitNames: [], batches: null },
];
console.log('\nLangkah 4: sahkan tempahan');
const created = await api('/api/orders/create-with-labels', {
  method: 'POST',
  body: { customerName: `UJI SIMULASI ${Date.now()}`, orderReference: '', orderDate: '2026-09-19', dueDate: '2026-10-10', items, actor: 'simulasi' },
});
check('tempahan dicipta', created.status === 201 || created.status === 200, json(created.body));
const orderId = created.body.orderId;
const generated = (created.body.lines || []).reduce((s, l) => s + l.batches.reduce((b, x) => b + x.createdUnits, 0), 0);
check('14 label dijana', generated === 14, `dapat ${generated}`);
check('no. rujukan auto TIADA-RUJUKAN-', /^TIADA-RUJUKAN-/.test(created.body.orderReference || ''), created.body.orderReference);

console.log('\nLangkah 5-6: cetak separa (Cetakan 1)');
let ov = (await api(`/api/orders/${orderId}/print-overview`)).body;
check('4 baris dalam jadual cetak (M, L-A, L-B, Tudung)', ov.rows.length === 4, json(ov.rows.map(r => r.variant_label)));
check('semua 14 belum dicetak', ov.rows.reduce((s, r) => s + r.unprinted, 0) === 14, '');
const rowM = ov.rows.find(r => r.variant_label === 'Saiz M');
const rowsL = ov.rows.filter(r => r.variant_label === 'Saiz L');
const rowT = ov.rows.find(r => r.variant_label === 'Saiz S');
const p1 = await api(`/api/orders/${orderId}/print-runs`, {
  method: 'POST',
  body: { selections: [{ batchId: rowM.batch_id, quantity: 2 }, ...rowsL.map(r => ({ batchId: r.batch_id, quantity: r.unprinted }))] },
});
check('Cetakan 1 dicipta', p1.status === 201 && p1.body.runNumber === 1, json(p1.body));
const run1 = (await api(`/api/print-runs/${p1.body.id}`)).body;
check('Cetakan 1 ada 8 label (M2 + L6, Tudung 0)', run1.units.length === 8, `dapat ${run1.units.length}`);
check('nama penerima Cetakan 1 mengikut turutan (Aisyah, Balqis)', run1.units.filter(u => u.variant_label === 'Saiz M').map(u => u.recipient_name).join() === 'Aisyah,Balqis', '');
check('kumpulan sekolah tertera pada label', run1.units.some(u => u.group_label === 'SK Sekolah A') && run1.units.some(u => u.group_label === 'SK Sekolah B'), '');

console.log('\nLangkah 7: cetak semula selamat');
const attach = async (u) => (await api(`/api/units/${u.id}/confirm-label`, { method: 'POST', body: { actor: 'simulasi' } })).status;
let okAttach = 0;
for (const u of run1.units.slice(0, 3)) if ((await attach(u)) < 300) okAttach++;
check('3 label disahkan ditampal', okAttach === 3, `${okAttach}`);
const run1b = (await api(`/api/print-runs/${run1.id}`)).body;
const pending = run1b.units.filter(u => !u.label_confirmed_at);
check('cetak semula hanya melibatkan 5 label belum ditampal', pending.length === 5, `${pending.length}`);

console.log('\nLangkah 8: Cetakan 2 (baki)');
ov = (await api(`/api/orders/${orderId}/print-overview`)).body;
const left = ov.rows.filter(r => r.unprinted > 0);
check('baki: M 2 + Tudung 4', left.length === 2 && left.reduce((s, r) => s + r.unprinted, 0) === 6, json(left.map(r => [r.variant_label, r.unprinted])));
const over = await api(`/api/orders/${orderId}/print-runs`, { method: 'POST', body: { selections: [{ batchId: rowM.batch_id, quantity: 3 }] } });
check('cetak melebihi baki ditolak', over.status >= 400, json(over.body));
const p2 = await api(`/api/orders/${orderId}/print-runs`, {
  method: 'POST', body: { selections: left.map(r => ({ batchId: r.batch_id, quantity: r.unprinted })) },
});
check('Cetakan 2 dicipta', p2.status === 201 && p2.body.runNumber === 2, json(p2.body));
const run2 = (await api(`/api/print-runs/${p2.body.id}`)).body;
check('Cetakan 2 ada 6 label, bermula dari Dania', run2.units.length === 6 && run2.units.find(u => u.variant_label === 'Saiz M').recipient_name === 'Dania', '');

console.log('\nLangkah 9: tampal dan sahkan semua');
for (const u of [...run1.units.slice(3), ...run2.units]) await attach(u);
ov = (await api(`/api/orders/${orderId}/print-overview`)).body;
check('semua label kedua-dua batch ditampal', ov.runs.every(r => r.attached_count === r.label_count), json(ov.runs));

console.log('\nLangkah 10: packing Cetakan 1');
const s1 = await api(`/api/print-runs/${run1.id}/packing/start`, { method: 'POST', body: {} });
check('Cetakan 1 menjangka 8 label sahaja', s1.body.planned === 8, json(s1.body));
const scan = (runId, u) => api(`/api/print-runs/${runId}/packing/scan`, { method: 'POST', body: { code: u.internal_token } });
const wrong = await scan(run1.id, run2.units[0]);
check('label Cetakan 2 ditolak dalam Cetakan 1 (sebut "Cetakan 2")', wrong.status >= 400 && /Cetakan 2/.test(wrong.body.error || ''), json(wrong.body));
let scanned = 0;
for (const u of run1.units.slice(0, 7)) if ((await scan(run1.id, u)).status === 201) scanned++;
check('7 daripada 8 label discan', scanned === 7, `${scanned}`);
const dup = await scan(run1.id, run1.units[0]);
check('scan label sama dua kali tidak dikira dua (kekal 7)', dup.body.alreadyScanned === true && dup.body.status.packed === 7, json(dup.body));
const c1 = await api(`/api/print-runs/${run1.id}/packing/close`, { method: 'POST', body: {} });
check('tutup dengan kurang: 1 label tertinggal disenaraikan', c1.body.missing === 1 && c1.body.missingUnits.length === 1, json(c1.body));

console.log('\nLangkah 11: packing Cetakan 2');
await api(`/api/print-runs/${run2.id}/packing/start`, { method: 'POST', body: {} });
let s2 = 0;
for (const u of run2.units) if ((await scan(run2.id, u)).status === 201) s2++;
check('6 label Cetakan 2 discan', s2 === 6, `${s2}`);
const c2 = await api(`/api/print-runs/${run2.id}/packing/close`, { method: 'POST', body: {} });
check('Cetakan 2 lengkap, tiada yang kurang', c2.body.missing === 0, json(c2.body));

console.log('\nLangkah 12: Butiran');
const rec = (await api(`/api/orders/${orderId}/reconciliation`)).body;
const t = rec.totals;
check(`jumlah: ditempah ${t.ordered}, dijana ${t.generated}, ditampal ${t.attached}, dipek ${t.packed}`, t.ordered === 14 && t.generated === 14 && t.attached === 14 && t.packed === 13, json(t));

console.log(`\n${step - bad}/${step} semakan lulus${bad ? `, ${bad} GAGAL` : ''}`);
process.exit(bad ? 1 : 0);
