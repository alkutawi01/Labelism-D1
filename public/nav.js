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

  // Every write's actor is now the AUTHENTICATED session's name, resolved
  // server-side (see routes/index.js's body() helper) -- this used to be a
  // free-text field anyone could type any name into (or skip), which meant
  // "who did this" was a permanent lie whenever a second shift shared a
  // device. window.LabelismActor.get() still exists so page scripts don't
  // need to change, but it now just mirrors the real logged-in identity;
  // there is nothing left for the client to spoof.
  let sessionName = '';
  window.LabelismActor = { get: () => sessionName };

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
      <a id="nav-staff-link" href="/staff.html" hidden style="width:72px;text-align:center;font-size:10.5px;font-weight:600;color:var(--navy-muted);padding:4px 2px;line-height:1.3;text-decoration:none">Urus Staf</a>
      <div id="nav-actor-display" style="width:72px;text-align:center;font-size:10.5px;font-weight:600;color:var(--navy-muted);padding:4px 2px;line-height:1.3"></div>
      <button id="nav-logout-btn" type="button">${icon('logout')}Log Out</button>
    </div>
  `;
  document.body.insertBefore(nav, document.body.firstChild);

  const actorDisplay = document.getElementById('nav-actor-display');
  fetch('/api/session').then((r) => r.json()).then((session) => {
    sessionName = session.name || '';
    actorDisplay.textContent = sessionName || '—';
    document.getElementById('nav-staff-link').hidden = !session.isAdmin;
  });

  document.getElementById('nav-logout-btn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/login.html';
  });
})();
