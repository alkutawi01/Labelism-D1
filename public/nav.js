// Shared left sidebar navigation, injected on every authenticated page --
// avoids duplicating the same markup across 7 static HTML files (no build
// step/framework in this project, so this is the lightest way to keep one
// nav in sync). Active link is derived from the current path, not
// hardcoded per page.
//
// Icons are Feather Icons (MIT licensed, https://feathericons.com) --
// vendored inline as raw SVG path data rather than loaded from a CDN, so
// the app has no external runtime dependency and keeps working offline.
(function () {
  const ICON = {
    home: '<polyline points="3 9 12 2 21 9"></polyline><path d="M5 10v10a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V10"></path>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
    package: '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>',
    tag: '<path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line>',
    scan: '<path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M21 8V5a2 2 0 0 0-2-2h-3"></path><path d="M3 16v3a2 2 0 0 0 2 2h3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>',
    clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><polyline points="9 14 11 16 15 12"></polyline>',
    bag: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path>',
    truck: '<rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle>',
    rotate: '<polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>',
  };
  function icon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;
  }
  window.LabelismIcon = icon;

  // The daily workflow is deliberately the whole navigation. Secondary
  // modules may remain in the codebase, but they are not part of the
  // operator journey: order -> attach labels -> scan every unit at packing.
  const LINKS = [
    { href: '/orders.html', label: 'Tempahan & Label', icon: 'bag' },
    { href: '/label.html', label: 'Cetak & Tampal', icon: 'tag' },
    { href: '/pack.html', label: 'Scan Packing', icon: 'scan' },
  ];

  const path = location.pathname === '/index.html' ? '/' : location.pathname;

  document.body.classList.add('has-sidebar');

  // Field Simulation Pass 3, Scenario B (multi-user handover): every write
  // across the entire app hardcoded actor: 'izzat' regardless of who was
  // physically at the keyboard -- confirmed by grepping every page. The
  // actor column has been free text since the original schema specifically
  // so it wouldn't need real accounts (a `users` table is reserved for
  // later, per Director's note in schema-add-orders.sql), but nothing ever
  // actually let the person using the device say who they are, so the one
  // field a second shift could use to see "who did this" was a permanent
  // lie. This is NOT a login/identity system (Director's explicit
  // instruction not to build that yet) -- just letting the existing free-
  // text field hold the truth. Persisted in localStorage (per-device, no
  // server round-trip) so it survives across pages and a shift only sets
  // it once at the start of their shift, not on every single action.
  function getActor() {
    return localStorage.getItem('labelism_actor') || '';
  }
  function setActor(name) {
    if (name) localStorage.setItem('labelism_actor', name);
    else localStorage.removeItem('labelism_actor');
  }
  window.LabelismActor = { get: getActor };

  const nav = document.createElement('div');
  // no-print: label.html hides everything with this class when printing a
  // physical label sheet -- harmless on pages without that print stylesheet.
  nav.className = 'sidebar no-print';
  nav.innerHTML = `
    <a class="sidebar-mark" href="/orders.html" aria-label="Labelism">L</a>
    <nav class="sidebar-nav">
      ${LINKS.map(l => `${l.newGroup ? '<div class="sidebar-divider"></div>' : ''}<a href="${l.href}" ${l.href === path ? 'class="active"' : ''}>${icon(l.icon)}${l.label}</a>`).join('')}
    </nav>
    <div class="sidebar-bottom">
      <div id="nav-actor-display" style="width:72px;text-align:center;font-size:10.5px;font-weight:600;color:var(--navy-muted);padding:4px 2px;line-height:1.3;cursor:pointer"></div>
      <div id="nav-actor-form" hidden style="width:72px;padding:5px 3px;background:#fff3d6;border:1px solid #e0ac3f;border-radius:4px">
        <div style="font-size:9.5px;font-weight:700;color:#7a5a12;margin-bottom:3px;line-height:1.2">NAMA STAF</div>
        <input id="nav-actor-input" type="text" placeholder="Nama" style="width:100%;font-size:10.5px;padding:3px;box-sizing:border-box">
        <button id="nav-actor-save" type="button" style="width:100%;font-size:10px;padding:2px;margin-top:3px">Simpan</button>
      </div>
      <button id="nav-logout-btn" type="button">${icon('logout')}Log Out</button>
    </div>
  `;
  document.body.insertBefore(nav, document.body.firstChild);

  const actorDisplay = document.getElementById('nav-actor-display');
  const actorForm = document.getElementById('nav-actor-form');
  const actorInput = document.getElementById('nav-actor-input');
  // Gate B readiness fix (2026-09-15): this used to be a passive, easy-to-
  // miss corner label ("Set your name") that a first-time user had no
  // reason to click -- every write everywhere then silently fell back to
  // the literal string 'izzat', so an untrained staff member's ENTIRE
  // session would be misattributed to the owner, destroying the actual
  // audit trail Gate B is meant to observe. Now the input auto-opens and
  // is auto-focused on any page load where no name is set yet, styled to
  // actually draw the eye -- still just one click away from being ignored
  // (not a login gate, per Director's explicit instruction not to build
  // real auth), but no longer invisible.
  function renderActor() {
    const name = getActor();
    if (name) {
      actorDisplay.hidden = false;
      actorForm.hidden = true;
      actorDisplay.textContent = `${name} · tukar`;
      actorDisplay.style.cssText = 'width:72px;text-align:center;font-size:10.5px;font-weight:600;color:var(--navy-muted);padding:4px 2px;line-height:1.3;cursor:pointer';
    } else {
      actorDisplay.hidden = true;
      actorForm.hidden = false;
      actorInput.value = '';
    }
  }
  renderActor();
  if (!getActor()) {
    actorInput.focus();
  }
  actorDisplay.addEventListener('click', () => {
    actorDisplay.hidden = true;
    actorForm.hidden = false;
    actorInput.value = getActor();
    actorInput.focus();
  });
  function saveActor() {
    setActor(actorInput.value.trim());
    renderActor();
  }
  document.getElementById('nav-actor-save').addEventListener('click', saveActor);
  actorInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveActor();
  });

  document.getElementById('nav-logout-btn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/login.html';
  });
})();
