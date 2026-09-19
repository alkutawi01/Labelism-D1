// Shared navigation, injected on every authenticated page (no build step or
// framework here, so this is the lightest way to keep one nav in sync).
// Desktop: a left rail. Phone: a bottom tab bar (see style.css, section 5).
// The active link comes from the current path, not from per-page markup.
//
// Icons are Feather Icons (MIT, https://feathericons.com), vendored inline as
// SVG path data so the app has no external runtime dependency.
(function () {
  const ICON = {
    home: '<polyline points="3 9 12 2 21 9"></polyline><path d="M5 10v10a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V10"></path>',
    package: '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>',
    tag: '<path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line>',
    clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><polyline points="9 14 11 16 15 12"></polyline>',
    bag: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path>',
    rotate: '<polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>',
    search: '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>',
  };
  function icon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
  }
  window.LabelismIcon = icon;

  // Primary = the daily workflow (order, print and attach, pack). Secondary =
  // tools used now and then. `short` is the phone tab label; `mobile: false`
  // hides an item from the phone bar (it stays on the desktop rail).
  const PRIMARY = [
    { href: '/orders.html', label: 'Orders', icon: 'bag' },
    { href: '/label.html', label: 'Print & Attach', short: 'Print', icon: 'tag' },
    { href: '/pack.html', label: 'Packing', icon: 'package' },
  ];
  const SECONDARY = [
    { href: '/scan.html', label: 'Unit Lookup', short: 'Lookup', icon: 'search' },
    { href: '/returns.html', label: 'Returns', icon: 'rotate' },
    { href: '/stocktake.html', label: 'Stocktake', icon: 'clipboard', mobile: false },
  ];
  const HOME = { href: '/', label: 'Home', icon: 'home', mobile: false };

  const path = location.pathname === '/index.html' ? '/' : location.pathname;
  const link = (l) => `<a href="${l.href}" class="${l.href === path ? 'active' : ''}${l.mobile === false ? ' hide-mobile' : ''}" ${l.href === path ? 'aria-current="page"' : ''}>${icon(l.icon)}<span>${l.short ? `<span class="lbl-full">${l.label}</span><span class="lbl-short">${l.short}</span>` : l.label}</span></a>`;

  document.body.classList.add('has-sidebar');

  // Every write's actor is the AUTHENTICATED session's name, resolved on the
  // server (see routes/index.js body()). window.LabelismActor.get() mirrors that
  // identity for page scripts; there is nothing left for the client to spoof.
  let sessionName = '';
  window.LabelismActor = { get: () => sessionName };

  const nav = document.createElement('div');
  nav.className = 'sidebar no-print';
  nav.innerHTML = `
    <a class="sidebar-mark" href="/" aria-label="Labelism home">L</a>
    <nav class="sidebar-nav" aria-label="Main">
      ${link(HOME)}
      <div class="sidebar-divider"></div>
      ${PRIMARY.map(link).join('')}
      <div class="sidebar-divider"></div>
      ${SECONDARY.map(link).join('')}
    </nav>
    <div class="sidebar-bottom">
      <a id="nav-staff-link" href="/staff.html" class="${path === '/staff.html' ? 'active' : ''}" hidden>${icon('users')}<span>Staff</span></a>
      <div id="nav-actor-display" class="sidebar-user" title="Signed in as"></div>
      <button id="nav-logout-btn" type="button" aria-label="Sign out">${icon('logout')}<span>Sign out</span></button>
    </div>
  `;
  document.body.insertBefore(nav, document.body.firstChild);

  const style = document.createElement('style');
  style.textContent = '.sidebar .lbl-short{display:none}@media (max-width:760px){.sidebar .lbl-full{display:none}.sidebar .lbl-short{display:inline}}';
  document.head.appendChild(style);

  const actorDisplay = document.getElementById('nav-actor-display');
  fetch('/api/session').then((r) => r.json()).then((session) => {
    sessionName = session.name || '';
    actorDisplay.textContent = sessionName || '';
    document.getElementById('nav-staff-link').hidden = !session.isAdmin;
  }).catch(() => {});

  document.getElementById('nav-logout-btn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/login.html';
  });
})();
