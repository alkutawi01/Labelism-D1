/**
 * Label fit check (invariant I9: the name on the garment must fit and be readable
 * on every supported label size). Not part of `npm test` because it needs a
 * browser layout engine.
 *
 * How to run: on /label.html?orderId=<an order whose run has units with names of
 * different lengths, e.g. 3, 27, 40, 60 and 92 characters>, open a print run,
 * then paste this whole file into the browser console. It prints one line per
 * label per size; every line must say "face ok", "name inside", "qr inside",
 * "text ok". Anything in CAPITALS is a failure.
 */
(async () => {
  const out = {};
  for (const key of ['40x30', '50x30', '60x40', 'a4']) {
    const sel = document.getElementById('size-select');
    sel.value = key;
    sel.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 1200));
    out[key] = [...document.querySelectorAll('#grid .lbl-face')].map((f) => {
      const fr = f.getBoundingClientRect();
      const n = f.querySelector('.lbl-name');
      const q = f.querySelector('.qr').getBoundingClientRect();
      const t = f.querySelector('.lbl-text');
      const inside = (r) => r.top >= fr.top - 0.5 && r.bottom <= fr.bottom + 0.5 && r.left >= fr.left - 0.5 && r.right <= fr.right + 0.5;
      const mm = n ? (parseFloat(getComputedStyle(n).fontSize) / 3.78).toFixed(1) + 'mm' : '';
      return [
        n ? `${n.innerText.length} chars ${mm}` : 'no name',
        f.scrollHeight > f.clientHeight + 1 ? 'face OVERFLOW' : 'face ok',
        n ? (inside(n.getBoundingClientRect()) ? 'name inside' : 'name OUTSIDE') : '',
        inside(q) ? 'qr inside' : 'qr OUTSIDE',
        t.scrollHeight > t.clientHeight + 1 ? 'text CUT' : 'text ok',
      ].join(' | ');
    });
  }
  console.log(JSON.stringify(out, null, 1));
  return out;
})();
