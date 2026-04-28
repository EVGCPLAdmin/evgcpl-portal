/* ═══════════════════════════════════════════════════════════════════
   EVGCPL Portal — Shell Renderer
   /assets/js/shell.js
   Renders header, top nav, command palette on every page.
   Each module page calls Shell.mount('current-route') in its <script>.
   ═══════════════════════════════════════════════════════════════════ */

window.Shell = (function() {
  'use strict';

  /* ── ICONS — small inline SVG library ───────────────────────── */
  const ICONS = {
    grid:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    users:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    building:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    cart:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
    rupee:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12M6 8h12M9 13h2c2 0 4-1.5 4-4M6 13h6l8 7"/></svg>',
    chart:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/></svg>',
    apps:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    search:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
    bell:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    moon:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    sun:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
    chevR:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  };


  /* ── auth check + redirect to login if needed ───────────────── */
  function requireAuth() {
    if (!STATE.isLoggedIn()) {
      window.location.href = 'index.html';
      return false;
    }
    return true;
  }


  /* ── Mount shell on a page ──────────────────────────────────── */
  function mount(currentRoute) {
    if (!requireAuth()) return;

    const root = document.querySelector('[data-shell-root]') || document.body;
    if (document.getElementById('shell-header')) return; // already mounted

    // Apply dark mode
    if (STATE.get('darkMode')) document.body.classList.add('dark');

    // Build chrome
    const chrome = document.createElement('div');
    chrome.innerHTML = renderChrome(currentRoute);
    document.body.insertBefore(chrome, document.body.firstChild);

    // Wire dropdowns
    document.querySelectorAll('.nav-group[data-has-items]').forEach(group => {
      const btn = group.querySelector('.nav-btn');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = group.classList.contains('open');
        document.querySelectorAll('.nav-group.open').forEach(g => g.classList.remove('open'));
        if (!wasOpen) group.classList.add('open');
      });
    });
    document.addEventListener('click', () => {
      document.querySelectorAll('.nav-group.open').forEach(g => g.classList.remove('open'));
    });

    // ⌘K listener
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openCmdK(); }
      if (e.key === 'Escape') closeCmdK();
    });

    // Track recent
    const navEntry = NAV_INDEX.find(n =>
      (n.page || '').replace(/#.*$/, '') === currentRoute + '.html' ||
      n.page === currentRoute);
    if (navEntry) STATE.pushRecent(currentRoute, navEntry.title);
  }


  /* ── Renderer ─────────────────────────────────────────────── */
  function renderChrome(currentRoute) {
    const u = STATE.get('user') || {};
    const role = STATE.get('role') || 'employee';
    const initials = (u.name || u.email || '?').split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
    const navHtml = NAV_CONFIG.map(group => renderNavGroup(group, currentRoute, role)).filter(Boolean).join('');
    const isDark = STATE.get('darkMode');
    return `
      <header class="shell-header" id="shell-header">
        <a href="dashboard.html" class="shell-brand" aria-label="Evergreen Portal home">
          <img src="assets/img/EG.jpg" alt="EVGCPL" class="shell-brand-logo">
          <span class="shell-brand-mark">Evergreen Portal</span>
        </a>
        <button class="shell-cmdk" onclick="Shell.openCmdK()" aria-label="Open command palette">
          ${ICONS.search}
          <span class="shell-cmdk-text">Search modules, sites, employees…</span>
          <span class="shell-cmdk-kbd">⌘K</span>
        </button>
        <div class="shell-actions">
          <button class="shell-icon-btn" aria-label="Toggle dark mode" onclick="Shell.toggleDark()" title="Toggle theme">
            ${isDark ? ICONS.sun : ICONS.moon}
          </button>
          <button class="shell-icon-btn" aria-label="Notifications" title="Notifications">
            ${ICONS.bell}
            <span class="dot" id="shellNotifDot" style="display:none"></span>
          </button>
          <button class="shell-user" onclick="Shell.toggleUserMenu()" id="shellUserBtn" aria-label="User menu">
            <div class="shell-avatar">${initials}</div>
            <div>
              <div class="shell-user-name">${escapeHtml(u.name || u.email || 'Guest')}</div>
              <div class="shell-user-role">${escapeHtml(roleLabel(role))}</div>
            </div>
          </button>
        </div>
      </header>
      <nav class="shell-nav" id="shell-nav" aria-label="Primary">${navHtml}</nav>
      <div id="shellUserMenu" class="card" style="position:fixed;top:calc(var(--header-h) + var(--topnav-h) + 6px);right:1rem;width:240px;display:none;z-index:600;padding:.4rem 0">
        <div style="padding:.6rem 1rem;border-bottom:1px solid var(--border)">
          <div style="font-weight:600;font-size:.84rem">${escapeHtml(u.name || u.email)}</div>
          <div style="font-size:.7rem;color:var(--txt3);margin-top:1px">${escapeHtml(u.email || '')}</div>
        </div>
        <a class="cmdk-item" href="hr.html#my-profile">My Profile</a>
        <a class="cmdk-item" href="config.html">Settings</a>
        <button class="cmdk-item" onclick="Shell.logout()" style="width:100%;text-align:left;color:#dc2626">Sign out</button>
      </div>
      ${renderCmdK()}
    `;
  }

  function renderNavGroup(group, currentRoute, role) {
    if (group.roles && !group.roles.includes(role)) return '';
    if (group.rolesHide && group.rolesHide.includes(role)) return '';
    const icon = ICONS[group.icon] || '';
    if (group.route) {
      const isActive = currentRoute === group.route;
      return `<div class="nav-group">
        <a class="nav-btn ${isActive ? 'active':''}" href="${group.page}">${icon}${escapeHtml(group.label)}</a>
      </div>`;
    }
    const items = (group.items || []).filter(it => !it.rolesHide || !it.rolesHide.includes(role));
    if (!items.length) return '';
    const isActiveSection = items.some(it => currentRoute === it.route || (it.page||'').startsWith(currentRoute + '.html'));
    const itemsHtml = items.map(it => {
      const itActive = currentRoute === it.route;
      const target   = it.external ? ` target="_blank" rel="noopener"` : '';
      const badge    = it.status === 'live' ? '<span class="nav-item-badge live">Live</span>'
                     : it.status === 'dev' ? '<span class="nav-item-badge dev">Dev</span>'
                     : it.status === 'new' ? '<span class="nav-item-badge new">New</span>'
                     : '';
      return `<a class="nav-item ${itActive?'active':''}" href="${it.page || it.url}"${target}>${escapeHtml(it.label)}${badge}</a>`;
    }).join('');
    return `<div class="nav-group" data-has-items>
      <button class="nav-btn ${isActiveSection?'active':''}" type="button">${icon}${escapeHtml(group.label)}<span class="nav-chev">${ICONS.chevron}</span></button>
      <div class="nav-dropdown">${itemsHtml}</div>
    </div>`;
  }

  function renderCmdK() {
    return `
      <div class="cmdk-overlay" id="cmdkOverlay" onclick="if(event.target===this)Shell.closeCmdK()" role="dialog" aria-label="Command palette">
        <div class="cmdk-modal">
          <div class="cmdk-input-wrap">
            ${ICONS.search}
            <input class="cmdk-input" id="cmdkInput" placeholder="Search modules, recent pages, quick actions…" oninput="Shell.cmdkFilter()" autocomplete="off">
          </div>
          <div class="cmdk-list" id="cmdkList"></div>
          <div class="cmdk-footer">
            <span><span class="cmdk-kbd">↑↓</span> Navigate</span>
            <span><span class="cmdk-kbd">↵</span> Open</span>
            <span><span class="cmdk-kbd">esc</span> Close</span>
          </div>
        </div>
      </div>
    `;
  }


  /* ── Command palette logic ──────────────────────────────────── */
  let _cmdkSelected = 0;
  let _cmdkResults = [];

  function openCmdK() {
    const o = document.getElementById('cmdkOverlay');
    if (!o) return;
    o.classList.add('show');
    document.getElementById('cmdkInput').value = '';
    document.getElementById('cmdkInput').focus();
    cmdkFilter();
  }

  function closeCmdK() {
    document.getElementById('cmdkOverlay')?.classList.remove('show');
  }

  function cmdkFilter() {
    const q   = (document.getElementById('cmdkInput')?.value || '').toLowerCase().trim();
    const list = document.getElementById('cmdkList');
    if (!list) return;

    const recent = (STATE.get('recent') || []).map(r => ({
      title: r.label, section: 'Recent', page: r.route + '.html', external: false, recent: true,
    }));
    const items = q
      ? NAV_INDEX.filter(n => n.keywords.includes(q))
      : [...recent, ...NAV_INDEX.slice(0, 12)];

    _cmdkResults = items;
    _cmdkSelected = 0;

    if (!items.length) {
      list.innerHTML = `<div class="cmdk-empty">No results for "${escapeHtml(q)}"</div>`;
      return;
    }

    // Group by section
    const groups = {};
    items.forEach((it, i) => {
      const sec = it.section || 'Other';
      if (!groups[sec]) groups[sec] = [];
      groups[sec].push({ ...it, _idx: i });
    });

    list.innerHTML = Object.entries(groups).map(([sec, arr]) => {
      const head = `<div class="cmdk-section-label">${escapeHtml(sec)}</div>`;
      const rows = arr.map(it => `
        <div class="cmdk-item ${it._idx === _cmdkSelected ? 'selected':''}" data-idx="${it._idx}"
             onmouseenter="Shell.cmdkSelect(${it._idx})" onclick="Shell.cmdkOpen(${it._idx})">
          <div class="cmdk-item-icon">→</div>
          <div class="cmdk-item-text">
            <div class="cmdk-item-title">${escapeHtml(it.title)}</div>
          </div>
          ${it.external ? '<div class="cmdk-item-section">External ↗</div>' : ''}
        </div>
      `).join('');
      return head + rows;
    }).join('');
  }

  function cmdkSelect(idx) {
    _cmdkSelected = idx;
    document.querySelectorAll('.cmdk-item').forEach(el => {
      el.classList.toggle('selected', +el.dataset.idx === idx);
    });
  }

  function cmdkOpen(idx) {
    const it = _cmdkResults[idx];
    if (!it) return;
    closeCmdK();
    if (it.external) window.open(it.page, '_blank');
    else window.location.href = it.page;
  }

  // Arrow key handling
  document.addEventListener('keydown', (e) => {
    const o = document.getElementById('cmdkOverlay');
    if (!o || !o.classList.contains('show')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdkSelect(Math.min(_cmdkSelected + 1, _cmdkResults.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); cmdkSelect(Math.max(_cmdkSelected - 1, 0)); }
    if (e.key === 'Enter')     { e.preventDefault(); cmdkOpen(_cmdkSelected); }
  });


  /* ── Theme + user menu ──────────────────────────────────────── */
  function toggleDark() {
    const next = !STATE.get('darkMode');
    STATE.set({ darkMode: next });
    document.body.classList.toggle('dark', next);
    const btn = document.querySelector('.shell-icon-btn[aria-label="Toggle dark mode"]');
    if (btn) btn.innerHTML = next ? ICONS.sun : ICONS.moon;
  }

  function toggleUserMenu() {
    const m = document.getElementById('shellUserMenu');
    if (m) m.style.display = m.style.display === 'block' ? 'none' : 'block';
    setTimeout(() => {
      document.addEventListener('click', closeUserMenuOnce, { once: true });
    }, 0);
  }
  function closeUserMenuOnce(e) {
    const m = document.getElementById('shellUserMenu');
    const btn = document.getElementById('shellUserBtn');
    if (m && !m.contains(e.target) && !btn.contains(e.target)) m.style.display = 'none';
  }

  function logout() {
    STATE.clear();
    window.location.href = 'index.html';
  }


  /* ── Page header helper — used by all module pages ──────────── */
  function pageHead({ crumbs = [], title, sub, actions = '' }) {
    const crumbsHtml = crumbs.length ? `<div class="breadcrumb">
      ${crumbs.map((c, i) => i === crumbs.length - 1
        ? `<b>${escapeHtml(c.label)}</b>`
        : `<a href="${c.href || '#'}">${escapeHtml(c.label)}</a><span aria-hidden="true">›</span>`
      ).join('')}
    </div>` : '';
    return `<section class="page-head">
      ${crumbsHtml}
      <div class="page-head-row">
        <div class="page-head-titleblock">
          <h1>${escapeHtml(title)}</h1>
          ${sub ? `<p class="page-sub">${escapeHtml(sub)}</p>` : ''}
        </div>
        ${actions ? `<div class="page-head-actions">${actions}</div>` : ''}
      </div>
    </section>`;
  }


  /* ── Toast helper ───────────────────────────────────────────── */
  function toast(msg, kind) {
    let stack = document.getElementById('toastStack');
    if (!stack) { stack = document.createElement('div'); stack.id = 'toastStack'; stack.className = 'toast-stack'; document.body.appendChild(stack); }
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; }, 3500);
    setTimeout(() => el.remove(), 3900);
  }


  /* ── Helpers ────────────────────────────────────────────────── */
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function roleLabel(r) {
    return ({ md:'MD / Admin', hr:'HR', site:'Site Manager', purchase:'Purchase', accounts:'Accounts', employee:'Employee', dept_head:'Department Head', vendor:'Vendor', sc:'Subcontractor' })[r] || r;
  }


  /* ── Public API ─────────────────────────────────────────────── */
  return {
    mount, requireAuth,
    openCmdK, closeCmdK, cmdkFilter, cmdkSelect, cmdkOpen,
    toggleDark, toggleUserMenu, logout,
    pageHead, toast,
    escapeHtml,
  };
})();
