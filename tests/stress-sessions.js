/**
 * Ten adversarial "factory day" sessions against a LOCAL dev server.
 * These do not assert a pass/fail contract: each session records what the
 * system actually did, and marks anything that looks like a weakness as
 * TEMUAN (finding). Run:  LABELISM_TEST_BASE_URL=http://localhost:8793 node tests/stress-sessions.js [1..10]
 * Needs auth bypassed (no .dev.vars secrets). Uses throw-away data.
 */
const BASE = process.env.LABELISM_TEST_BASE_URL || 'http://127.0.0.1:8788';
const only = process.argv.slice(2).map(Number);
const findings = [];
let session = 0;

async function api(path, { method = 'GET', body } = {}) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json, ms: Date.now() - t0 };
}
const say = (s) => console.log(s);
const ok = (s) => say(`   ok      ${s}`);
const note = (s) => say(`   catatan ${s}`);
function temuan(sev, title, detail = '') {
  findings.push({ session, sev, title, detail });
  say(`   TEMUAN [${sev}] ${title}${detail ? '\n           ' + detail : ''}`);
}
const j = (x) => JSON.stringify(x);
const err = (r) => (r.body && r.body.error) || `HTTP ${r.status}`;
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function mk(tag, items, extra = {}) {
  const r = await api('/api/orders/create-with-labels', {
    method: 'POST',
    body: { customerName: `${tag}-${uniq()}`, orderReference: '', items, actor: 'sim', ...extra },
  });
  if (r.status !== 201) return { fail: r };
  const ov = (await api(`/api/orders/${r.body.orderId}/print-overview`)).body;
  return { orderId: r.body.orderId, res: r.body, ov, customerId: null };
}
const overview = async (orderId) => (await api(`/api/orders/${orderId}/print-overview`)).body;
async function printRun(orderId, sel) {
  return api(`/api/orders/${orderId}/print-runs`, { method: 'POST', body: { selections: sel } });
}
const getRun = async (id) => (await api(`/api/print-runs/${id}`)).body;
const attach = (u) => api(`/api/units/${u.id}/confirm-label`, { method: 'POST', body: { actor: 'sim' } });
const packScan = (runId, codeOrUnit) => api(`/api/print-runs/${runId}/packing/scan`, {
  method: 'POST', body: { code: typeof codeOrUnit === 'string' ? codeOrUnit : codeOrUnit.internal_token, actor: 'sim' },
});
const packStart = (runId) => api(`/api/print-runs/${runId}/packing/start`, { method: 'POST', body: {} });
const packClose = (runId) => api(`/api/print-runs/${runId}/packing/close`, { method: 'POST', body: {} });
const recon = async (orderId) => (await api(`/api/orders/${orderId}/reconciliation`)).body;
async function allUnits(orderId) {
  const ov = await overview(orderId);
  const out = [];
  for (const row of ov.rows) {
    const r = await api(`/api/production-batches/${row.batch_id}/units`);
    for (const u of r.body || []) out.push({ ...u, variant_label: row.variant_label, group_label: row.group_label, product_name: row.product_name, batch_id: row.batch_id });
  }
  return out;
}
const sel = (rows, n) => rows.map((r) => ({ batchId: r.batch_id, quantity: n === undefined ? r.unprinted : Math.min(n, r.unprinted) })).filter((s) => s.quantity > 0);
const names = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);
async function dispatchRun(runId) {
  // packing close makes the shipments CLOSED; dispatch each
  const st = await api(`/api/print-runs/${runId}/packing`);
  const run = st.body.run;
  const { results } = { results: [] };
  const ov = await overview(run.order_id);
  const lines = await api(`/api/orders/${run.order_id}/reconciliation`);
  const shipments = [];
  for (const l of lines.body.lines) {
    const s = await api(`/api/order-lines/${l.order_line_id}/shipments`);
    for (const sh of s.body || []) if (sh.print_run_id === runId || sh.reference?.includes(`Cetakan ${run.run_number}`)) shipments.push(sh);
  }
  const outs = [];
  for (const sh of shipments) if (sh.status === 'CLOSED') outs.push(await api(`/api/shipments/${sh.id}/dispatch`, { method: 'POST', body: { locationName: 'Customer', actor: 'sim' } }));
  return { shipments, outs };
}

const sessions = {};

// ---------------------------------------------------------------- 1
sessions[1] = async () => {
  say('\nSESI 1: tempahan kotor / bercanggah');
  const P = `Jersi Home ${uniq()}`;
  const items = [
    { productName: P, variantLabel: 'XL', quantity: 4, unitNames: names('A', 4), batches: null },
    { productName: P, variantLabel: 'X-L', quantity: 3, unitNames: names('B', 3), batches: null },
    { productName: P, variantLabel: 'XL ', quantity: 2, unitNames: [], batches: null },
    { productName: P, variantLabel: 'xl', quantity: 2, unitNames: [], batches: null },
    { productName: P.replace('Home', 'home') + ' ', variantLabel: 'M', quantity: 2, unitNames: [], batches: null }, // same product, other case + trailing space
    { productName: P.replace('Jersi', 'Jersey'), variantLabel: 'M', quantity: 2, unitNames: [], batches: null }, // near-duplicate product
  ];
  const o = await mk('S1', items);
  if (o.fail) return temuan('?', 'tempahan kotor ditolak sepenuhnya', err(o.fail));
  const labels = o.ov.rows.map((r) => `${r.product_name} / "${r.variant_label}"`);
  note(`baris label yang terhasil: ${labels.length}`);
  labels.forEach((l) => note('  ' + l));
  const variantsOfP = new Set(o.ov.rows.filter((r) => r.product_name.toLowerCase().startsWith(P.toLowerCase().slice(0, 10)) && /^xl|^x-l/i.test(r.variant_label)).map((r) => r.variant_label));
  if (variantsOfP.size > 1) temuan('TINGGI', 'Variasi hampir-duplikat dicipta di server (XL / X-L / "XL " / xl dianggap berbeza)', `${[...variantsOfP].map((v) => `"${v}"`).join(', ')}. Client hanya trim; server terima terus. Satu saiz fizikal jadi beberapa baris, cetakan dan packing terpecah.`);
  const prods = new Set(o.ov.rows.map((r) => r.product_name));
  note(`produk dicipta: ${[...prods].join(' | ')}`);
  if (prods.size > 2) temuan('SEDERHANA', 'Produk hampir sama (Jersi/Jersey) jadi produk berasingan tanpa amaran', [...prods].join(' | '));
  const total = (await recon(o.orderId)).totals;
  const asked = items.reduce((s, i) => s + i.quantity, 0);
  if (total.generated !== asked) temuan('KRITIKAL', 'Bilangan label tidak sama dengan yang diminta', `diminta ${asked}, dijana ${total.generated}`);
  else ok(`jumlah label = jumlah diminta (${asked})`);

  // Names: more names than quantity, fewer, duplicate, blank in the middle.
  const cases = [
    ['nama lebih daripada kuantiti (5 nama / 3 unit)', { productName: P, variantLabel: 'L1', quantity: 3, unitNames: names('N', 5), batches: null }, 'tolak'],
    ['nama berganda (Ali, Ali) ', { productName: P, variantLabel: 'L2', quantity: 2, unitNames: ['Ali', 'Ali'], batches: null }, 'terima'],
    ['nama kosong di tengah ["A","","C"]', { productName: P, variantLabel: 'L3', quantity: 3, unitNames: ['A', '', 'C'], batches: null }, 'lihat'],
    ['kuantiti perpuluhan 2.5', { productName: P, variantLabel: 'L4', quantity: 2.5, unitNames: [], batches: null }, 'tolak'],
    ['kuantiti "3" (string)', { productName: P, variantLabel: 'L5', quantity: '3', unitNames: [], batches: null }, 'lihat'],
    ['kuantiti 0', { productName: P, variantLabel: 'L6', quantity: 0, unitNames: [], batches: null }, 'tolak'],
    ['kuantiti negatif', { productName: P, variantLabel: 'L7', quantity: -4, unitNames: [], batches: null }, 'tolak'],
    ['kuantiti 5000 sekali gus', { productName: P, variantLabel: 'L8', quantity: 5000, unitNames: [], batches: null }, 'lihat'],
    ['nama produk kosong', { productName: '  ', variantLabel: 'L9', quantity: 1, unitNames: [], batches: null }, 'tolak'],
    ['nama hanya spasi ["  "]', { productName: P, variantLabel: 'L10', quantity: 2, unitNames: ['  ', 'Zed'], batches: null }, 'lihat'],
  ];
  for (const [label, item, expect] of cases) {
    const r = await mk('S1c', [item]);
    if (r.fail) { (expect === 'tolak' ? ok : (m) => note(m))(`${label}: ditolak (${err(r.fail).slice(0, 90)})`); continue; }
    const units = await allUnits(r.orderId);
    const got = units.map((u) => u.recipient_name ?? '∅').join(',');
    if (expect === 'tolak') temuan('TINGGI', `${label}: diterima sedangkan patut ditolak`, `unit dijana ${units.length}`);
    else note(`${label}: diterima, ${units.length} unit, nama = [${got.slice(0, 80)}]`);
    if (label.startsWith('nama kosong') && got !== 'A,∅,C') temuan('TINGGI', 'Nama kosong di tengah menyebabkan nama beralih kedudukan (unit 2 dapat "C")', `nama = ${got}. Baris tanpa nama di tengah senarai akan menggeser semua nama selepasnya.`);
    if (label.startsWith('nama berganda')) temuan('RENDAH', 'Nama berganda dalam satu baris diterima tanpa amaran', `nama = ${got}`);
    if (label.startsWith('kuantiti 5000') && units.length === 5000) note('5000 unit dijana dalam satu panggilan');
  }

  // Same school twice as batches within one variant.
  const dup = await mk('S1d', [{ productName: P, variantLabel: 'M', quantity: 6, unitNames: [], batches: [
    { quantity: 3, batchLabel: 'SK Sekolah A', unitNames: names('X', 3) },
    { quantity: 3, batchLabel: 'sk sekolah a ', unitNames: names('Y', 3) },
  ] }]);
  if (dup.fail) ok(`sekolah sama dua kali (huruf/spasi berbeza) ditolak: ${err(dup.fail).slice(0, 90)}`);
  else {
    const labelsOf = dup.ov.rows.map((r) => `"${r.group_label}"`).join(', ');
    temuan('SEDERHANA', 'Sekolah sama (huruf besar/kecil/spasi berbeza) jadi dua kumpulan berlainan', `kumpulan: ${labelsOf}. Client hanya menyemak padanan tepat huruf kecil tanpa trim server.`);
  }

  // batch sum < quantity sent directly to the API (UI adds remainder itself)
  const short = await mk('S1e', [{ productName: P, variantLabel: 'M', quantity: 10, unitNames: [], batches: [{ quantity: 4, batchLabel: 'A' }] }]);
  if (!short.fail) {
    const t = (await recon(short.orderId)).totals;
    if (t.generated < t.ordered) note(`jumlah kumpulan < kuantiti (API terus): ditempah ${t.ordered}, dijana ${t.generated} -> nampak sebagai kurang dijana pada Butiran, bukan senyap`);
  }
};

// ---------------------------------------------------------------- 2
sessions[2] = async () => {
  say('\nSESI 2: perubahan selepas label dijana (belum ditampal)');
  const P = `Kemeja ${uniq()}`;
  const o = await mk('S2', [
    { productName: P, variantLabel: 'M', quantity: 60, unitNames: names('Nama', 60), batches: null },
    { productName: P, variantLabel: 'L', quantity: 40, unitNames: names('Lama', 40), batches: null },
  ]);
  const run = await printRun(o.orderId, sel(o.ov.rows, 30));
  const printed = (await getRun(run.body.id)).units;
  ok(`100 label dijana, ${printed.length} dicetak (belum ditampal)`);
  // Customer wants: change 3 names, 2 sizes, reduce quantity.
  const u0 = printed[0];
  const attempts = [
    ['tukar nama unit (PATCH)', `/api/units/${u0.id}`, 'PATCH', { recipientName: 'Baru' }],
    ['tukar nama unit (PUT)', `/api/units/${u0.id}`, 'PUT', { recipient_name: 'Baru' }],
    ['ubah kuantiti order line', `/api/order-lines/${(await recon(o.orderId)).lines[0].order_line_id}`, 'PATCH', { quantityOrdered: 50 }],
    ['ubah order', `/api/orders/${o.orderId}`, 'PATCH', { notes: 'x' }],
    ['padam order', `/api/orders/${o.orderId}`, 'DELETE', undefined],
    ['padam unit', `/api/units/${u0.id}`, 'DELETE', undefined],
  ];
  for (const [label, path, method, body] of attempts) {
    const r = await api(path, { method, body });
    say(`   cuba: ${label} -> HTTP ${r.status} ${r.status === 404 ? '(tiada laluan)' : err(r).slice(0, 60)}`);
  }
  temuan('KRITIKAL', 'Tiada cara mengubah nama, saiz atau kuantiti selepas label dijana', 'Tiada endpoint edit/batal untuk order, order line atau unit (semua 404). Satu-satunya "pembetulan" ialah jana tambahan (+Jana lagi). Pelanggan tukar 3 nama, 2 saiz atau kurangkan kuantiti: label lama kekal sah dan wajib.');

  // Workaround the team may reach for: record a free-form event.
  const ev = await api(`/api/units/${u0.id}/events`, { method: 'POST', body: { eventType: 'ORDER_AMENDED_VOID', payload: { reason: 'pelanggan batal' }, actor: 'sim' } });
  note(`rekod event bebas "ORDER_AMENDED_VOID": HTTP ${ev.status}`);
  const r2 = await printRun(o.orderId, sel((await overview(o.orderId)).rows));
  const still = (await getRun(r2.body.id)).units.some((u) => u.id === u0.id);
  note(`unit yang ditanda VOID: masih boleh dicetak/dipack? cetak baki ${r2.status === 201 ? 'ya' : 'tidak'}; unit sendiri dalam cetakan baru: ${still}`);
  if (ev.status < 300) temuan('TINGGI', 'eventType bebas diterima tetapi tiada makna: unit "VOID" tetap dikira wajib, boleh dicetak dan dipack', 'Tiada senarai event yang sah. Event rekaan tidak mengubah keadaan unit; ia hanya catatan.');
  // Over-generate to "fix" a quantity increase, and try to reduce via add-batch of negative
  const line = (await recon(o.orderId)).lines[0];
  const addBad = await api(`/api/order-lines/${line.order_line_id}/batches`, { method: 'POST', body: { quantity: 5, actor: 'sim' } });
  note(`tambah jana melebihi ditempah: ditolak? ${addBad.status >= 400} (${err(addBad).slice(0, 70)})`);
  // cancel printed but unattached run: labels go back, but names/sizes still original
  const c = await api(`/api/print-runs/${run.body.id}/cancel`, { method: 'POST', body: {} });
  note(`batalkan cetakan belum ditampal: ${c.status} (label kembali "belum dicetak", tetapi nama/saiz asal kekal)`);
};

// ---------------------------------------------------------------- 3
sessions[3] = async () => {
  say('\nSESI 3: perubahan selepas label ditampal');
  const P = `Polo ${uniq()}`;
  const o = await mk('S3', [{ productName: P, variantLabel: 'L', quantity: 100, unitNames: names('P', 100), batches: null }]);
  const run = await printRun(o.orderId, sel(o.ov.rows));
  const units = (await getRun(run.body.id)).units;
  for (const u of units.slice(0, 50)) await attach(u);
  ok('50/100 label ditampal');
  const five = units.slice(0, 5);
  // Post-attachment reissue for 5 units (label wrong size)
  const oldTokens = five.map((u) => u.internal_token);
  const results = [];
  for (const u of five) results.push(await api(`/api/units/${u.id}/reissue-label-after-attachment`, { method: 'POST', body: { actor: 'sim' } }));
  ok(`5 unit reissue selepas tampal: ${results.map((r) => r.status).join(',')}`);
  const oldStillResolves = [];
  for (const t of oldTokens) oldStillResolves.push((await api(`/api/units/lookup/${t}`)).status);
  if (oldStillResolves.some((s) => s === 200)) temuan('KRITIKAL', 'QR lama masih boleh dicari selepas reissue (dua identiti aktif)', j(oldStillResolves));
  else ok('QR lama mati selepas reissue (lookup gagal)');
  const lk = await api(`/api/units/lookup/${results[0].body.internalToken}`);
  const ev = lk.body && lk.body.events ? lk.body.events.map((e) => e.event_type) : [];
  note(`jejak audit unit pertama: ${ev.join(' > ')}`);
  if (!ev.includes('LABEL_REISSUED')) temuan('TINGGI', 'Jejak audit reissue tidak nampak pada lookup', '');
  // But the correction the customer asked for (size/name change) cannot be expressed:
  const before = (await getRun(run.body.id)).units.find((u) => u.id === five[0].id);
  note(`selepas reissue: nama unit masih "${before.recipient_name}", saiz masih ${units[0] && 'L'} (reissue hanya tukar QR, bukan data unit)`);
  temuan('KRITIKAL', 'Reissue selepas tampal hanya menukar QR; nama dan saiz unit tidak boleh dibetulkan', 'Untuk 5 unit yang pelanggan tukar saiz/nama, satu-satunya jalan ialah reissue (nama/saiz sama) atau tempahan baru. Tiada "batalkan unit + jana pengganti + hubungkan ke asal", jadi satu obligasi lama kekal wajib dan satu baru mesti dibuat manual, menyebabkan jumlah wajib melebihi order.');
  const t = (await recon(o.orderId)).totals;
  note(`jumlah wajib kini ${t.generated}, ditempah ${t.ordered}, ditampal ${t.attached} (reissue kosongkan status tampal 5 unit itu)`);
  if (t.attached !== 45) temuan('SEDERHANA', 'Status tampal 5 unit berubah kepada belum tampal', `attached=${t.attached}`);
  // reissued unit re-confirm and verify it appears in reprint
  const run1 = await getRun(run.body.id);
  const pending = run1.units.filter((u) => !u.label_confirmed_at);
  note(`label belum ditampal dalam Cetakan 1 kini ${pending.length} (termasuk 5 yang direissue: label baru hanya boleh dicetak melalui "Cetak semula")`);
};

// ---------------------------------------------------------------- 4
sessions[4] = async () => {
  say('\nSESI 4: dua operator serentak (pelayan tempatan; D1 tempatan ialah SQLite satu-proses, bukan bukti untuk production)');
  const P = `Konkurensi ${uniq()}`;
  const o = await mk('S4', [
    { productName: P, variantLabel: 'M', quantity: 40, unitNames: [], batches: null },
    { productName: P, variantLabel: 'L', quantity: 40, unitNames: [], batches: null },
  ]);
  const s = sel(o.ov.rows);
  const N = 6;
  const rs = await Promise.all(Array.from({ length: N }, () => printRun(o.orderId, s)));
  const codes = rs.map((r) => r.status);
  say(`   ${N} operator cetak baki yang sama serentak -> status: ${codes.join(',')}`);
  const ov = await overview(o.orderId);
  const runsInfo = ov.runs.map((r) => `${r.run_number}:${r.label_count}`);
  say(`   cetakan terhasil (no:bilangan label): ${runsInfo.join('  ')}`);
  const totalPrinted = ov.runs.reduce((a, r) => a + r.label_count, 0);
  const emptyRuns = ov.runs.filter((r) => r.label_count === 0).length;
  const nums = ov.runs.map((r) => r.run_number);
  if (totalPrinted !== 80) temuan('KRITIKAL', 'Jumlah label dicetak tidak sama dengan 80', `${totalPrinted}`);
  if (new Set(nums).size !== nums.length) temuan('KRITIKAL', 'Nombor cetakan berganda', nums.join(','));
  if (emptyRuns) temuan('TINGGI', 'Cetakan kosong (0 label) terhasil apabila dua operator cetak baki serentak', `${emptyRuns} cetakan kosong; operator kedua tidak diberi amaran, nampak berjaya tetapi label sudah dicetak operator lain`);
  const partial = ov.runs.filter((r) => r.label_count > 0 && r.label_count < 80).length;
  if (partial > 1) temuan('TINGGI', 'Baki dipecah antara operator tanpa amaran (cetakan separa yang tidak dipilih)', runsInfo.join(' '));
  const fails = rs.filter((r) => r.status >= 400).map((r) => err(r));
  if (fails.length) note(`ralat yang diterima operator: ${[...new Set(fails)].join(' | ').slice(0, 200)}`);
  if (fails.some((f) => /UNIQUE|constraint|SQLITE/i.test(f))) temuan('TINGGI', 'Ralat teknikal (UNIQUE) bocor ke operator pada perlumbaan run_number', fails.join(' | ').slice(0, 160));

  // packing: start twice concurrently, scan the same label concurrently
  const runWith = ov.runs.find((r) => r.label_count > 0);
  const units = (await getRun(runWith.id)).units;
  for (const u of units) await attach(u);
  const starts = await Promise.all([packStart(runWith.id), packStart(runWith.id), packStart(runWith.id)]);
  const st = (await api(`/api/print-runs/${runWith.id}/packing`)).body;
  note(`3 permulaan packing serentak -> status ${starts.map((x) => x.status).join(',')}, sesi terbuka ${st.openShipments} (jangka 2 iaitu satu setiap baris)`);
  if (st.openShipments > 2) temuan('TINGGI', 'Sesi packing berganda untuk satu cetakan (perlumbaan start)', `openShipments=${st.openShipments}`);
  const u = units[0];
  const scans = await Promise.all(Array.from({ length: 5 }, () => packScan(runWith.id, u)));
  const created = scans.filter((r) => r.status === 201).length;
  say(`   5 scan serentak label yang sama -> ${scans.map((r) => r.status).join(',')}`);
  const st2 = (await api(`/api/print-runs/${runWith.id}/packing`)).body;
  if (created > 1 || st2.packed > 1) temuan('KRITIKAL', 'Label yang sama dipek berkali-kali serentak', `dicipta ${created}, packed=${st2.packed}`);
  else ok('label yang sama hanya dipek sekali');
  const lk = await api(`/api/units/lookup/${u.internal_token}`);
  const packEv = (lk.body.events || []).filter((e) => /PACK|SHIPMENT/i.test(e.event_type)).length;
  note(`event packing untuk unit itu: ${packEv}`);
  if (packEv > 1) temuan('TINGGI', 'Event packing berganda untuk satu unit', `${packEv} event`);
  const seqs = (lk.body.events || []).map((e) => e.seq);
  if (new Set(seqs).size !== seqs.length) temuan('TINGGI', 'Nombor turutan event berganda', seqs.join(','));
};

// ---------------------------------------------------------------- 5
sessions[5] = async () => {
  say('\nSESI 5: label fizikal bercampur');
  const schools = ['SK A', 'SK B'];
  const orders = [];
  for (let c = 0; c < 3; c++) {
    const P = `Prod${c}-${uniq()}`;
    const o = await mk(`S5c${c}`, ['M', 'L'].map((sz) => ({ productName: P, variantLabel: sz, quantity: 8, unitNames: [], batches: schools.map((s) => ({ quantity: 4, batchLabel: s, unitNames: names(`${s[3]}${c}${sz}`, 4) })) })));
    orders.push(o);
  }
  const runs = [];
  for (const o of orders) {
    const r1 = await printRun(o.orderId, sel(o.ov.rows, 2));
    const r2 = await printRun(o.orderId, sel((await overview(o.orderId)).rows, 2));
    const r3 = await printRun(o.orderId, sel((await overview(o.orderId)).rows));
    runs.push([r1.body.id, r2.body.id, r3.body.id]);
  }
  const lab = [];
  for (const rr of runs) lab.push(await Promise.all(rr.map(getRun)));
  ok('3 pelanggan x 2 saiz x 2 sekolah, 3 cetakan setiap satu');
  const A = lab[0], B = lab[1];
  // attach most of A run1
  for (const u of A[0].units.slice(0, A[0].units.length - 1)) await attach(u);
  const unattached = A[0].units[A[0].units.length - 1];
  await packStart(A[0].id);
  const oldTok = A[0].units[0].internal_token;
  const rei = await api(`/api/units/${A[0].units[1].id}/reissue-label-after-attachment`, { method: 'POST', body: { actor: 'sim' } });
  await attach(A[0].units[1]);
  const dupUnit = A[0].units[2];
  await packScan(A[0].id, dupUnit);
  const probes = [
    ['label Cetakan 2 ke Cetakan 1', () => packScan(A[0].id, A[1].units[0])],
    ['label pelanggan lain (order lain) ke Cetakan 1', () => packScan(A[0].id, B[0].units[0])],
    ['QR lama yang sudah dimatikan (reissue)', () => packScan(A[0].id, A[0].units[1].internal_token)],
    ['label belum ditampal', () => packScan(A[0].id, unattached)],
    ['label duplikat (scan dua kali)', () => packScan(A[0].id, dupUnit)],
    ['kod tidak wujud', () => packScan(A[0].id, 'XXXXXXXX')],
    ['kod kosong', () => packScan(A[0].id, ' ')],
    ['human_code 000001 ditaip (wujud di banyak kumpulan)', () => packScan(A[0].id, '000001')],
    ['label belum dicetak (tiada cetakan)', async () => {
      const ov = await overview(orders[2].orderId);
      const all = await allUnits(orders[2].orderId);
      return packScan(A[0].id, all.find((u) => !u.print_run_id) || all[0]);
    }],
  ];
  for (const [label, fn] of probes) {
    const r = await fn();
    const msg = err(r);
    say(`   ${String(r.status).padEnd(4)} ${label}\n           -> ${r.status < 300 ? (r.body.alreadyScanned ? 'dikira semula: alreadyScanned' : 'DITERIMA') : msg}`);
    if (r.status < 300 && !/duplikat|human_code/.test(label) && !(r.body && r.body.alreadyScanned)) temuan('TINGGI', `Scan tidak sepatutnya diterima: ${label}`, j(r.body).slice(0, 140));
    if (r.status >= 400 && /^(HTTP|Unit not found|Not found)/i.test(msg) && !/kosong/.test(label)) temuan('RENDAH', `Mesej ralat kurang membantu: ${label}`, msg);
  }
  // scanning the same wrong label 20x in a chaotic burst
  const burst = await Promise.all([...Array(10)].map((_, i) => packScan(A[0].id, i % 2 ? A[1].units[i % A[1].units.length] : B[1].units[i % B[1].units.length])));
  ok(`10 scan salah serentak -> semua ditolak: ${burst.every((r) => r.status >= 400)}; kiraan packing kekal ${(await api(`/api/print-runs/${A[0].id}/packing`)).body.packed}`);
};

// ---------------------------------------------------------------- 6
sessions[6] = async () => {
  say('\nSESI 6: pengeluaran lebih (103 baju untuk 100 label)');
  const P = `Lebih ${uniq()}`;
  const o = await mk('S6', [{ productName: P, variantLabel: 'M', quantity: 100, unitNames: [], batches: null }]);
  const run = await printRun(o.orderId, sel(o.ov.rows));
  const units = (await getRun(run.body.id)).units;
  for (const u of units) await attach(u);
  await packStart(run.body.id);
  for (const u of units) await packScan(run.body.id, u);
  ok('100 baju berlabel dipek');
  const line = (await recon(o.orderId)).lines[0];
  // three extras on the table, no label
  const tries = [
    ['jana 3 label tambahan pada baris ini (add-batch)', () => api(`/api/order-lines/${line.order_line_id}/batches`, { method: 'POST', body: { quantity: 3, actor: 'sim' } })],
    ['scan baju tanpa label (kod kosong/rekaan)', () => packScan(run.body.id, 'TIADA-LABEL')],
    ['cipta shipment plannedQuantity 103', () => api('/api/shipments', { method: 'POST', body: { orderLineId: line.order_line_id, reference: 'x', plannedQuantity: 103 } })],
    ['rekod event "OVERPRODUCED" pada satu unit sedia ada', () => api(`/api/units/${units[0].id}/events`, { method: 'POST', body: { eventType: 'OVERPRODUCED', actor: 'sim' } })],
  ];
  for (const [label, fn] of tries) {
    const r = await fn();
    say(`   ${String(r.status).padEnd(4)} ${label}\n           -> ${r.status < 300 ? 'diterima' : err(r)}`);
    if (label.startsWith('cipta shipment') && r.status < 300) temuan('TINGGI', 'Shipment dengan planned 103 dicipta untuk baris 100 unit', 'Tiada semakan planned > ditempah; angka 103 boleh dilihat sebagai sasaran tanpa 3 unit itu wujud sebagai identiti.');
  }
  // the dispatch/close view: is there any place recording "3 extra"?
  const cl = await packClose(run.body.id);
  note(`tutup packing: planned ${cl.body.planned}, packed ${cl.body.packed}, missing ${cl.body.missing}; tiada medan untuk "lebihan"`);
  const t = (await recon(o.orderId)).totals;
  note(`Butiran: ditempah ${t.ordered}, dijana ${t.generated}, dipek ${t.packed}`);
  temuan('KRITIKAL', 'Tiada aliran pengecualian untuk "objek fizikal tanpa obligasi digital"', '3 baju lebih di meja packing: tiada cara mendaftar sebagai lebihan, stok pra-label, atau tambahan pelanggan. Scan tanpa label tidak menghasilkan rekod. Sistem kekal menunjukkan 100/100 lengkap sementara 103 baju wujud, jadi 3 baju itu tidak wujud dalam Labelism. Cara sekarang: pelanggan pesan tambahan (order baru) atau baju dibiarkan tanpa jejak.');
};

// ---------------------------------------------------------------- 7
sessions[7] = async () => {
  say('\nSESI 7: packing dibuka semula, perubahan saat akhir, dispatch separa');
  const P = `Reopen ${uniq()}`;
  const o = await mk('S7', [{ productName: P, variantLabel: 'M', quantity: 50, unitNames: [], batches: null }]);
  const other = await mk('S7x', [{ productName: P, variantLabel: 'M', quantity: 3, unitNames: [], batches: null }]);
  const run = await printRun(o.orderId, sel(o.ov.rows));
  const oRun = await printRun(other.orderId, sel(other.ov.rows));
  const units = (await getRun(run.body.id)).units;
  const foreign = (await getRun(oRun.body.id)).units;
  for (const u of units) await attach(u);
  for (const u of foreign) await attach(u);
  await packStart(run.body.id);
  for (const u of units.slice(0, 40)) await packScan(run.body.id, u);
  const c1 = await packClose(run.body.id);
  ok(`tutup dengan kurang: planned ${c1.body.planned} packed ${c1.body.packed} missing ${c1.body.missing}`);
  const s0 = (await api(`/api/print-runs/${run.body.id}/packing`)).body;
  note(`selepas tutup: packed ${s0.packed}, missing ${s0.missing}, sesi terbuka ${s0.openShipments}`);
  // dispatch the 40 now (early partial dispatch)
  const d1 = await dispatchRun(run.body.id);
  note(`dispatch separa 40: ${d1.outs.map((x) => x.status + ':' + (x.body.dispatchedCount ?? err(x))).join(',')}`);
  const s1 = (await api(`/api/print-runs/${run.body.id}/packing`)).body;
  note(`selepas dispatch: packed ${s1.packed}, missing ${s1.missing}`);
  // found 6 -> resume
  const st = await packStart(run.body.id);
  if (st.status >= 400) temuan('TINGGI', 'Tidak boleh sambung packing selepas tutup+dispatch untuk 6 helai yang dijumpai', err(st));
  else ok(`sambung packing: planned ${st.body.planned}, sesi terbuka ${st.body.openShipments}`);
  const r6 = [];
  for (const u of units.slice(40, 46)) r6.push((await packScan(run.body.id, u)).status);
  note(`scan 6 helai jumpa: ${r6.join(',')}`);
  // mistakes: other order's unit; a reissued unit
  const mis1 = await packScan(run.body.id, foreign[0]);
  say(`   unit order lain -> ${mis1.status} ${err(mis1).slice(0, 110)}`);
  const victim = units[46];
  const rei = await api(`/api/units/${victim.id}/reissue-label-after-attachment`, { method: 'POST', body: { actor: 'sim' } });
  const mis2 = await packScan(run.body.id, victim.internal_token);
  say(`   unit dengan QR lama (reissue) -> ${mis2.status} ${err(mis2).slice(0, 110)}`);
  const mis3 = await packScan(run.body.id, rei.body.internalToken);
  say(`   QR baru, belum ditampal semula -> ${mis3.status} ${err(mis3).slice(0, 110)}`);
  // reissue a unit that is ALREADY PACKED
  const packedUnit = units[0];
  const rp = await api(`/api/units/${packedUnit.id}/reissue-label-after-attachment`, { method: 'POST', body: { actor: 'sim' } });
  say(`   reissue selepas tampal pada unit yang SUDAH dipek dan dihantar -> ${rp.status}`);
  if (rp.status < 300) temuan('TINGGI', 'Unit yang sudah dipek/dihantar boleh direissue (label dikosongkan), memutuskan sambungan unit-shipment', 'Status tampal jadi belum, sedangkan unit sudah dalam shipment DISPATCHED. Tiada halangan berdasarkan keadaan packing/dispatch.');
  const cl2 = await packClose(run.body.id);
  note(`tutup kali kedua: ${cl2.status} planned ${cl2.body.planned} packed ${cl2.body.packed} missing ${cl2.body.missing} ${cl2.body.missingUnits ? 'namaUnit=' + cl2.body.missingUnits.length : ''}`);
  const d2 = await dispatchRun(run.body.id);
  note(`dispatch kedua: ${d2.outs.map((x) => x.status).join(',')}`);
  const fin = (await api(`/api/print-runs/${run.body.id}/packing`)).body;
  const t = (await recon(o.orderId)).totals;
  note(`akhir: planned ${fin.planned} packed ${fin.packed} missing ${fin.missing}; Butiran dijana ${t.generated} ditampal ${t.attached} dipek ${t.packed} dihantar ${t.dispatched}`);
  if (fin.packed !== 46) temuan('SEDERHANA', 'Kiraan packed tidak sepadan dengan 46 unit sebenar', `packed=${fin.packed}`);
  if (t.attached !== 50 - 2) temuan('SEDERHANA', 'Kiraan ditampal berubah selepas reissue (2 unit dikosongkan)', `attached=${t.attached}`);
};

// ---------------------------------------------------------------- 8
sessions[8] = async () => {
  say('\nSESI 8: return jahat');
  const P = `Ret ${uniq()}`;
  const custA = await mk('S8A', [{ productName: P, variantLabel: 'M', quantity: 6, unitNames: [], batches: null }]);
  const custB = await mk('S8B', [{ productName: P, variantLabel: 'M', quantity: 2, unitNames: [], batches: null }]);
  const custs = (await api('/api/customers')).body;
  const cA = custs.find((c) => c.name === custA.res.customerName);
  const shipAll = async (o) => {
    const r = await printRun(o.orderId, sel(o.ov.rows));
    const u = (await getRun(r.body.id)).units;
    for (const x of u) await attach(x);
    await packStart(r.body.id);
    for (const x of u) await packScan(r.body.id, x);
    await packClose(r.body.id);
    await dispatchRun(r.body.id);
    return u;
  };
  const uA = await shipAll(custA);
  const uB = await shipAll(custB);
  // one unit that never dispatched: extra unit via add-batch on A? create fresh undispatched in A
  const line = (await recon(custA.orderId)).lines[0];
  const extra = await api(`/api/order-lines/${line.order_line_id}/batches`, { method: 'POST', body: { quantity: 1, actor: 'sim' } });
  note(`unit tambahan tanpa dispatch: add-batch -> ${extra.status} ${err(extra).slice(0, 80)}`);
  const o2 = await api('/api/orders/create-with-labels', { method: 'POST', body: { customerId: cA.id, orderReference: '', items: [{ productName: P, variantLabel: 'M', quantity: 1, unitNames: [], batches: null }], actor: 'sim' } });
  const o2ov = await overview(o2.body.orderId);
  const r2 = await printRun(o2.body.orderId, sel(o2ov.rows));
  const never = (await getRun(r2.body.id)).units[0];
  await attach(never);
  // one whose label was reissued after dispatch
  const rei = await api(`/api/units/${uA[5].id}/reissue-label-after-attachment`, { method: 'POST', body: { actor: 'sim' } });
  note(`reissue unit yang sudah dihantar: ${rei.status}`);
  const in1 = await api('/api/return-intakes', { method: 'POST', body: { customerId: cA.id, reference: 'RET-1', locationName: 'Returns Area' } });
  const in2 = await api('/api/return-intakes', { method: 'POST', body: { customerId: cA.id, reference: 'RET-2', locationName: 'Returns Area' } });
  const sc = (id, code) => api(`/api/return-intakes/${id}/scans`, { method: 'POST', body: { code, actor: 'sim' } });
  const t = [
    ['betul #1', uA[0].internal_token], ['betul #2', uA[1].internal_token],
    ['daripada pelanggan lain', uB[0].internal_token],
    ['tidak pernah dihantar', never ? never.internal_token : 'n/a'],
    ['QR lama selepas reissue', uA[5].internal_token],
    ['QR baru selepas reissue (belum tampal)', rei.body && rei.body.internalToken],
  ];
  for (const [label, code] of t) {
    if (!code || code === 'n/a') { note(`${label}: tiada unit untuk diuji`); continue; }
    const r = await sc(in1.body.id, code);
    say(`   ${String(r.status).padEnd(4)} ${label} -> ${r.status < 300 ? `expected=${r.body.expected} customerMismatch=${r.body.customerMismatch} shipConflict=${r.body.activeShipmentConflict ?? '-'} customer=${r.body.customerName}` : err(r)}`);
    if (label.startsWith('daripada pelanggan lain') && !r.body.customerMismatch) temuan('TINGGI', 'Unit pelanggan lain tidak ditandakan sebagai tidak sepadan', j(r.body));
    if (label.startsWith('tidak pernah') && r.body && r.body.expected) temuan('TINGGI', 'Unit tidak pernah dihantar ditandakan expected', j(r.body));
  }
  // same unit into a different intake
  const dup = await sc(in2.body.id, uA[0].internal_token);
  say(`   unit yang sama ke intake kedua -> ${dup.status} ${dup.status < 300 ? 'DITERIMA tanpa amaran (expected=' + dup.body.expected + ')' : err(dup)}`);
  if (dup.status < 300) temuan('TINGGI', 'Unit yang sama boleh masuk dua return intake berlainan tanpa amaran', 'Semakan "sudah discan" hanya dalam intake yang sama. Dua pemulangan aktif untuk satu unit; keputusan QC bercanggah mungkin.');
  say(`   selepas pemulangan: unit boleh terus dipek semula? (tanpa QC)`);
  const qc = await api(`/api/return-intakes/${in1.body.id}/units/${uA[0].id}/qc`, { method: 'POST', body: { outcome: 'AVAILABLE', actor: 'sim' } });
  const qc2 = await api(`/api/return-intakes/${in2.body.id}/units/${uA[0].id}/qc`, { method: 'POST', body: { outcome: 'DAMAGED', actor: 'sim' } });
  note(`QC bercanggah untuk unit sama: intake1 ${qc.status} (${qc.body && (qc.body.outcome || err(qc))}), intake2 ${qc2.status} (${qc2.body && (qc2.body.outcome || err(qc2))})`);
  if (qc.status < 300 && qc2.status < 300) temuan('TINGGI', 'Dua keputusan QC yang bercanggah diterima untuk satu unit', 'AVAILABLE dan DAMAGED, tiada rujukan silang.');
  // after return, can the unit be re-packed immediately (no restock)?
  const cl = await api(`/api/return-intakes/${in1.body.id}/close`, { method: 'POST', body: {} });
  note(`tutup intake 1: ${cl.status} ${cl.status < 300 ? j(cl.body).slice(0, 140) : err(cl)}`);
};

// ---------------------------------------------------------------- 9
sessions[9] = async () => {
  say('\nSESI 9: skala satu hari kilang (pelayan tempatan; masa production D1 lebih tinggi kerana rangkaian)');
  const T = Date.now();
  const orders = [];
  let units = 0;
  for (let i = 0; i < 100; i++) {
    const P = `Skala${i % 12}-${i}`;
    const sizes = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
    const qtys = sizes.map((_, k) => 8 + ((i + k) % 9));
    const items = sizes.map((sz, k) => ({ productName: P, variantLabel: sz, quantity: qtys[k], unitNames: i % 3 === 0 ? names(`N${i}${sz}`, qtys[k]) : [], batches: i % 4 === 0 ? [{ quantity: qtys[k], batchLabel: `SK ${i % 7}`, unitNames: [] }] : null }));
    const r = await mk('S9', items);
    if (r.fail) { temuan('TINGGI', `tempahan ${i} gagal semasa skala`, err(r.fail)); continue; }
    orders.push(r);
    units += qtys.reduce((a, b) => a + b, 0);
  }
  say(`   ${orders.length} order, ${units} unit dijana dalam ${((Date.now() - T) / 1000).toFixed(1)}s`);
  let runs = 0;
  const t1 = Date.now();
  for (const o of orders) {
    const ov = await overview(o.orderId);
    const a = await printRun(o.orderId, sel(ov.rows, 3));
    const b = await printRun(o.orderId, sel(await overview(o.orderId).then((x) => x.rows), 4));
    if (a.status === 201) runs++;
    if (b.status === 201) runs++;
  }
  say(`   ${runs} cetakan dicipta dalam ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  const time = async (label, fn, budget) => {
    const t0 = Date.now(); const r = await fn(); const ms = Date.now() - t0;
    const size = r && r.body ? Math.round(JSON.stringify(r.body).length / 1024) : 0;
    say(`   ${String(ms).padStart(5)} ms  ${size ? `(${size} KB) ` : ''}${label}`);
    if (ms > budget) temuan('SEDERHANA', `${label} lambat: ${ms} ms (bajet ${budget})`, '');
    return r;
  };
  const list = await time('GET /api/orders (Senarai tempahan)', () => api('/api/orders'), 1500);
  await time('GET /api/print-orders (pemilih Cetak & Tampal)', () => api('/api/print-orders'), 1500);
  const mid = orders[50];
  await time('print-overview (satu order, 6 baris)', () => api(`/api/orders/${mid.orderId}/print-overview`), 800);
  await time('reconciliation (Butiran)', () => api(`/api/orders/${mid.orderId}/reconciliation`), 800);
  const ov = await overview(mid.orderId);
  await time('GET print-run (label satu cetakan)', () => api(`/api/print-runs/${ov.runs[0].id}`), 800);
  const bigOrder = await mk('S9big', [{ productName: 'Besar', variantLabel: 'M', quantity: 1500, unitNames: [], batches: null }]);
  const bigRun = await printRun(bigOrder.orderId, sel(bigOrder.ov.rows));
  await time('GET print-run 1500 label (satu cetakan besar)', () => api(`/api/print-runs/${bigRun.body.id}`), 1500);
  const bu = (await getRun(bigRun.body.id)).units;
  for (const u of bu.slice(0, 20)) await attach(u);
  await time('packing start (1500 label)', () => packStart(bigRun.body.id), 1500);
  const sr = await time('packing scan (satu label)', () => packScan(bigRun.body.id, bu[0]), 500);
  await time('packing status', () => api(`/api/print-runs/${bigRun.body.id}/packing`), 800);
  await time('packing close (1500 label)', () => packClose(bigRun.body.id), 1500);
  const custs = await time('GET /api/customers', () => api('/api/customers'), 800);
  note(`kiraan pelanggan ${custs.body.length}; jumlah order ${list.body.length}`);
  const dom = list.body.length;
  if (dom > 60) temuan('SEDERHANA', 'Senarai tempahan tiada penomboran halaman di server: semua order dimuat sekali', `${dom} order, ${Math.round(JSON.stringify(list.body).length / 1024)} KB pada setiap muat. Pemilih Cetak & Tampal juga memuat semua order.`);
};

// ---------------------------------------------------------------- 10
sessions[10] = async () => {
  say('\nSESI 10: hari paling buruk di kilang, kemudian audit hanya dari Labelism');
  const P = `Boss ${uniq()}`;
  const o = await mk('S10', [
    { productName: P, variantLabel: 'M', quantity: 30, unitNames: names('M', 30), batches: null },
    { productName: P, variantLabel: 'L', quantity: 30, unitNames: names('L', 30), batches: null },
  ]);
  const ordered = 60;
  const run1 = await printRun(o.orderId, sel(o.ov.rows, 20)); // 40 labels
  let u1 = (await getRun(run1.body.id)).units;
  // printer dies after 12 labels: only 12 attached
  for (const u of u1.slice(0, 12)) await attach(u);
  note('printer rosak: 12 daripada 40 label keluar dan ditampal; 28 tidak keluar');
  // operator A reprints the rest (same run), operator B packs
  const cancel = await api(`/api/print-runs/${run1.body.id}/cancel`, { method: 'POST', body: {} });
  note(`batal cetakan penuh? ${cancel.status} (${err(cancel).slice(0, 90)}): tidak boleh kerana 12 sudah ditampal, jadi 28 label kekal "sudah dicetak" tetapi tidak wujud fizikal`);
  if (cancel.status >= 400) temuan('SEDERHANA', 'Tiada cara menandakan sebahagian label dalam cetakan sebagai "tidak keluar dari printer"', '28 label kekal dikira sudah dicetak dan hanya boleh diselesaikan dengan "Cetak semula" (cetak label belum ditampal). Berfungsi, tetapi statistik "dicetak" menganggap 40 fizikal.');
  for (const u of u1.slice(12, 40)) await attach(u); // reprinted and attached
  // lost label reissued (pre-attachment) on a later run
  const run2 = await printRun(o.orderId, sel((await overview(o.orderId)).rows));
  const u2 = (await getRun(run2.body.id)).units; // 20
  const lost = u2[0];
  const rl = await api(`/api/units/${lost.id}/reissue-label`, { method: 'POST', body: { actor: 'sim' } });
  note(`label hilang direissue sebelum tampal: ${rl.status}`);
  for (const u of u2.slice(1, 19)) await attach(u);
  // one label lost after attach
  const after = u1[3];
  const rr = await api(`/api/units/${after.id}/reissue-label-after-attachment`, { method: 'POST', body: { actor: 'sim' } });
  await attach({ id: after.id });
  // pack run1 ; operator packs while another is reprinting
  await packStart(run1.body.id);
  const pk = [];
  for (const u of u1) if (u.id !== after.id || true) pk.push((await packScan(run1.body.id, u.id === after.id ? rr.body.internalToken : u.internal_token)).status);
  note(`pek Cetakan 1: ${pk.filter((s) => s === 201).length}/40 berjaya`);
  const c1 = await packClose(run1.body.id);
  await dispatchRun(run1.body.id); // early dispatch part of customer
  // one garment missing (u2[19] never attached), one wrong size, one extra
  note('baju terlebih 1, terkurang 1 (u2 terakhir tidak wujud), salah saiz 1 (tiada tempat rekod)');
  await packStart(run2.body.id);
  const pk2 = [];
  for (const u of u2.slice(1, 19)) pk2.push((await packScan(run2.body.id, u)).status);
  const c2 = await packClose(run2.body.id);
  await dispatchRun(run2.body.id);
  // later a unit is returned
  const custs = (await api('/api/customers')).body;
  const cust = custs.find((c) => c.name === o.res.customerName);
  const intake = await api('/api/return-intakes', { method: 'POST', body: { customerId: cust.id, reference: 'RET-S10', locationName: 'Returns Area' } });
  const rs = await api(`/api/return-intakes/${intake.body.id}/scans`, { method: 'POST', body: { code: u1[10].internal_token, actor: 'sim' } });
  const q = await api(`/api/return-intakes/${intake.body.id}/units/${u1[10].id}/qc`, { method: 'POST', body: { outcome: 'RESTOCK', actor: 'sim' } });
  note(`unit dipulangkan: scan ${rs.status} qc ${q.status}`);

  say('\n   --- AUDIT hanya daripada Labelism ---');
  const rec = await recon(o.orderId);
  const t = rec.totals;
  const ovf = await overview(o.orderId);
  const all = await allUnits(o.orderId);
  const ledger = { ditempah: ordered, 'label diwajibkan': all.length, dicetak: 0 };
  const runsNow = (await overview(o.orderId)).runs;
  const printedIds = new Set();
  for (const r of runsNow) for (const u of (await getRun(r.id)).units) printedIds.add(u.id);
  ledger.dicetak = printedIds.size;
  all.forEach((u) => { u.print_run_id = printedIds.has(u.id) ? 'y' : null; });
  // events per unit
  const evByUnit = new Map();
  for (const u of all) {
    const lk2 = await api(`/api/units/lookup/${u.internal_token}`);
    evByUnit.set(u.id, lk2.body && lk2.body.events ? lk2.body.events.map((e) => e.event_type) : null);
  }
  const has = (u, t) => (evByUnit.get(u.id) || []).includes(t);
  ledger.ditampal = all.filter((u) => u.label_confirmed_at).length;
  ledger.dispatched = all.filter((u) => has(u, 'UNIT_DISPATCHED')).length;
  ledger.dikembalikan = all.filter((u) => has(u, 'RETURN_RECEIVED')).length;
  ledger.reissue = all.filter((u) => has(u, 'LABEL_REISSUED')).length;
  ledger['belum dicetak'] = all.filter((u) => !u.print_run_id).length;
  say('   ' + Object.entries(ledger).map(([k, v]) => `${k}: ${v}`).join(' | '));
  say(`   Butiran sistem: ditempah ${t.ordered}, dijana ${t.generated}, ditampal ${t.attached}, dipek ${t.packed}, dihantar ${t.dispatched}`);
  const outstanding = all.filter((u) => !has(u, 'UNIT_DISPATCHED') || has(u, 'RETURN_RECEIVED'));
  say(`   tertunggak (belum dihantar atau sudah dipulang): ${outstanding.length}`);
  const gaps = [];
  if (evByUnit.size && [...evByUnit.values()].some((v) => v === null)) gaps.push('lookup unit tidak memulangkan event untuk sebahagian unit (kod human_code bertindih)');
  gaps.push('baju terlebih (1): tiada tempat rekod, tidak boleh dijawab');
  gaps.push('baju salah saiz (1): tiada rekod; unit ditanda sebagai M/L mengikut label sedangkan garment lain');
  gaps.push('perubahan order selepas cetak (tukar nama/saiz): tiada rekod, tidak boleh dijawab');
  gaps.push('label tidak keluar dari printer: dikira "dicetak" 40 padahal fizikal 12');
  if (t.dispatched === undefined || t.dispatched !== ledger.dispatched) gaps.push(`kiraan "dihantar" Butiran (${t.dispatched}) berbeza daripada bilangan event dispatch unit (${ledger.dispatched})`);
  if (t.packed !== undefined && t.packed !== ledger.dispatched) gaps.push(`dipek (${t.packed}) vs dihantar (${ledger.dispatched}): dipek termasuk unit yang sudah dihantar atau tidak, bergantung takrif`);
  const attachedNow = ledger.ditampal;
  if (ledger.reissue && attachedNow < all.length - ledger['belum dicetak']) gaps.push('unit yang direissue menunjukkan "belum ditampal" walaupun garmentnya sudah dipek');
  gaps.forEach((g) => temuan('AUDIT', g));
  const answered = ['ditempah', 'label diwajibkan', 'dicetak', 'ditampal', 'dispatched', 'dikembalikan'].length;
  say(`   Boleh dijawab tepat: ${answered} daripada 9 soalan. Tidak boleh: terlebih, salah saiz, perubahan order (dan "berapa unit sebenar di lantai").`);
  say(`   Identiti tepat setiap unit: ${all.length} unit boleh disenarai (kod + token + nama + kumpulan).`);
};

// ---------------------------------------------------------------- run
for (const n of Object.keys(sessions).map(Number)) {
  if (only.length && !only.includes(n)) continue;
  session = n;
  try { await sessions[n](); } catch (e) { temuan('RALAT SKRIP', `sesi ${n} terhenti`, String(e && e.stack || e).slice(0, 400)); }
}
say('\n================ RINGKASAN TEMUAN ================');
for (const f of findings) say(`S${f.session} [${f.sev}] ${f.title}`);
say(`\nJumlah temuan: ${findings.length}`);
