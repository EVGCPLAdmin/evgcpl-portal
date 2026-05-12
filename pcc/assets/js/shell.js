/* ════════════════════════════════════════════════════════════════
   SHELL · Header · Left Sidebar Nav · Footer · Project Switcher
═══════════════════════════════════════════════════════════════ */

window.Shell = (function () {

  const C = window.CONFIG;

  // ── Header ────────────────────────────────────────────────────
  function buildHeader(currentPageId) {
    const ap       = window.STATE.activeProject;
    const code     = ap ? (ap['Project Code'] || '—') : '—';
    const name     = ap ? (ap['Project Name'] || '(no name)') : 'No project';
    const pageMeta = (C.PAGES || []).find(p => p.id === currentPageId);
    const pageTitle = pageMeta ? pageMeta.title : 'PCC';

    return `
    <header class="app-header">
      <div class="ah-l">
        <a href="index.html" style="display:flex;align-items:center;gap:12px;text-decoration:none">
          <img src="assets/img/EG.jpg" class="ah-logo" alt="EG"
               onerror="this.style.display='none'" />
        </a>
        <div class="ah-divider"></div>
        <div class="ah-brand">
          <span class="b1">Project Cost Control</span>
          <span class="b2">${Utils.esc(pageTitle)}</span>
        </div>
      </div>
      <div class="ah-r">
        <div class="proj-pill" onclick="Shell.openProjectSwitcher()" title="Switch project">
          <div class="pp-dot"></div>
          <span class="pp-code">${Utils.esc(code)}</span>
          <span class="pp-name">${Utils.esc(name)}</span>
          <span class="pp-arr">▾</span>
        </div>
        <button class="btn-icon" onclick="Shell.refresh()" title="Refresh data">↻</button>
        <a class="btn-icon"
           href="https://docs.google.com/spreadsheets/d/${C.SHEET_ID}/edit"
           target="_blank" rel="noopener" title="Open backing sheet">📊</a>
      </div>
    </header>`;
  }

  // ── Left Sidebar Nav ──────────────────────────────────────────
  function buildSidebar(currentPageId) {
    // Steps only (exclude home, project-tree, project-dashboard — handled separately)
    const stepItems = (C.PAGES || []).filter(p =>
      p.id !== 'home' && p.id !== 'project-tree' && p.id !== 'project-dashboard'
    );
    const currentIdx = stepItems.findIndex(p => p.id === currentPageId);

    const stepLinks = stepItems.map((p, i) => {
      const isActive = p.id === currentPageId;
      const isDone   = currentIdx > i;
      const cls      = isActive ? 'active' : (isDone ? 'done' : '');
      const stepNum  = (p.step === '·' || !p.step) ? '' : p.step;
      return `
      <a class="snav-link ${cls}" href="${p.file}" title="${Utils.esc(p.desc)}">
        <span class="snav-step">${stepNum ? stepNum : p.icon}</span>
        <span class="snav-title">${Utils.esc(p.title)}</span>
        ${isActive ? '<span class="snav-active-bar"></span>' : ''}
      </a>`;
    }).join('');

    const dashActive = currentPageId === 'project-dashboard';
    const treeActive = currentPageId === 'project-tree';

    return `
    <aside class="pcc-sidebar">
      <!-- Dashboard — prominent, not a step -->
      <div style="padding:6px 10px 2px">
        <a class="snav-link ${dashActive ? 'active' : ''}" href="project-dashboard.html" title="Project Progress Dashboard">
          <span class="snav-step" style="${dashActive ? '' : 'background:rgba(30,128,56,.08);border-color:transparent;color:var(--green)'}">📊</span>
          <span class="snav-title" style="font-weight:700">Dashboard</span>
          ${dashActive ? '<span class="snav-active-bar"></span>' : ''}
        </a>
      </div>
      <div class="snav-divider"></div>
      <div class="snav-section-label">Steps</div>
      <nav class="snav">${stepLinks}</nav>
      <div class="snav-divider"></div>
      <!-- Project Tree -->
      <a class="snav-link ${treeActive ? 'active' : ''}" href="project-tree.html" title="Full project hierarchy">
        <span class="snav-step">🌲</span>
        <span class="snav-title">Project Tree</span>
        ${treeActive ? '<span class="snav-active-bar"></span>' : ''}
      </a>
      <!-- Last loaded timestamp -->
      <div class="snav-footer">
        <div class="snav-updated" id="snavLastUpdated" title="Last data load time">
          <span class="snav-upd-label">Last loaded</span>
          <span class="snav-upd-time" id="snavUpdTime">—</span>
        </div>
      </div>
    </aside>`;
  }

  // ── Portal-style footer — reads local build constants injected at build time ──
  function buildFooter() {
    // PCC_VERSION / PCC_BUILD / PCC_BUILD_AT are injected into config.js by build-portal.js
    // This is reliable regardless of iframe/standalone context.
    let ver   = (typeof PCC_VERSION  !== 'undefined') ? PCC_VERSION  : '—';
    let build = (typeof PCC_BUILD    !== 'undefined') ? String(PCC_BUILD) : '—';
    let at    = (typeof PCC_BUILD_AT !== 'undefined') ? PCC_BUILD_AT : '';

    // Fallback: try reading from parent portal window (same-origin iframe)
    if (ver === '—') {
      try {
        const pw = window.parent;
        if (pw && pw !== window && pw.PORTAL_VERSION) {
          ver   = pw.PORTAL_VERSION;
          build = String(pw.PORTAL_BUILD || '—');
          at    = pw.PORTAL_BUILD_AT || '';
        }
      } catch (_) { /* cross-origin — skip */ }
    }

    let dateLabel = '';
    if (at) {
      try {
        const d = new Date(at);
        if (!isNaN(d.getTime())) dateLabel = d.toISOString().slice(0, 10);
      } catch (_) {}
    }

    return `
    <footer id="portalVersionFooter" style="
      position:fixed;bottom:0;left:0;right:0;z-index:900;
      height:28px;background:rgba(255,255,255,.96);backdrop-filter:blur(8px);
      border-top:1px solid var(--border);
    ">
      <div class="pvf-inner">
        <span class="pvf-brand">EVGCPL Portal</span>
        <span class="pvf-sep">·</span>
        <span class="pvf-ver">PCC</span>
        ${ver !== '—' ? `<span class="pvf-sep">·</span><span class="pvf-ver">v${ver}</span>` : ''}
        ${build !== '—' ? `<span class="pvf-sep">·</span><span class="pvf-build">build ${build}</span>` : ''}
        ${dateLabel ? `<span class="pvf-sep">·</span><span class="pvf-date">${dateLabel}</span>` : ''}
        <span class="pvf-fill"></span>
        <span class="pvf-tail">© ${new Date().getFullYear()} Evergreen Enterprises</span>
      </div>
    </footer>`;
  }

  // ── Project switcher modal ────────────────────────────────────
  function buildProjectSwitcher() {
    return `
    <div class="modal-bg" id="projectSwitcher"
         onclick="if(event.target===this)Shell.closeProjectSwitcher()">
      <div class="modal">
        <div class="modal-head">
          <h3>Select Project</h3>
          <button class="btn-icon" onclick="Shell.closeProjectSwitcher()">✕</button>
        </div>
        <div class="modal-body">
          <div class="modal-search">
            <input type="text" id="projectSearch"
                   placeholder="Search by code or name…"
                   oninput="Shell.filterProjects(this.value)" />
          </div>
          <div id="projectList">
            <div class="empty">
              <div class="empty-icon">📁</div>
              <div class="empty-title">Loading projects…</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="toast"></div>`;
  }

  // ── Init ──────────────────────────────────────────────────────
  async function init(opts) {
    const pageId = (opts && opts.pageId) || '';

    // 1. Inject header at top of body
    const headerEl = document.createElement('div');
    headerEl.innerHTML = buildHeader(pageId);
    document.body.insertBefore(headerEl, document.body.firstChild);

    // 2. Wrap the existing <main class="app-main"> in the sidebar layout
    const mainEl = document.querySelector('main.app-main');
    if (mainEl) {
      const layout = document.createElement('div');
      layout.className = 'pcc-layout';
      mainEl.parentNode.insertBefore(layout, mainEl);
      layout.innerHTML = buildSidebar(pageId);
      layout.appendChild(mainEl);
    }

    // 3. Inject footer + project switcher at end of body
    const tail = document.createElement('div');
    tail.innerHTML = buildFooter() + buildProjectSwitcher();
    document.body.appendChild(tail);

    // 4. Load projects + restore active project
    await loadProjects();

    // 5. Stamp "last loaded" time
    _stampUpdated();

    return { activeProject: window.STATE.activeProject };
  }

  // ── Last updated timestamp ────────────────────────────────────
  function _stampUpdated(label) {
    const el = document.getElementById('snavUpdTime');
    if (!el) return;
    const now = new Date();
    const hhmm = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    el.textContent = label || hhmm;
    el.title = now.toLocaleString('en-GB');
  }

  // Public — pages can call this after a save to update the timestamp
  function stampSaved() { _stampUpdated('Saved ' + new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12: false })); }

  // ── Project loaders ───────────────────────────────────────────
  async function loadProjects() {
    try {
      const projects = await API.gviz(C.TABS.PROJECT);
      window.STATE.projects = (projects || []).filter(p => p['Project Code']);
    } catch (e) {
      window.STATE.projects = window.STATE.projects || [];
    }
    if (window.STATE.activeProject && window.STATE.projects.length) {
      const code  = window.STATE.activeProject['Project Code'];
      const fresh = window.STATE.projects.find(p => p['Project Code'] === code);
      if (fresh) window.STATE.activeProject = fresh;
    }
    refreshHeaderProjectPill();
  }

  function refreshHeaderProjectPill() {
    const ap = window.STATE.activeProject;
    const codeEl = document.querySelector('.proj-pill .pp-code');
    const nameEl = document.querySelector('.proj-pill .pp-name');
    if (codeEl) codeEl.textContent = ap ? (ap['Project Code'] || '—') : '—';
    if (nameEl) nameEl.textContent = ap ? (ap['Project Name'] || '(no name)') : 'No project';
  }

  function openProjectSwitcher() {
    document.getElementById('projectSwitcher').classList.add('show');
    renderProjectList(window.STATE.projects);
  }
  function closeProjectSwitcher() {
    document.getElementById('projectSwitcher').classList.remove('show');
  }
  function filterProjects(q) {
    const ql = String(q).toLowerCase();
    renderProjectList(window.STATE.projects.filter(p =>
      String(p['Project Code'] || '').toLowerCase().includes(ql) ||
      String(p['Project Name'] || '').toLowerCase().includes(ql)
    ));
  }
  function renderProjectList(list) {
    const cont = document.getElementById('projectList');
    if (!cont) return;
    if (!list || !list.length) {
      cont.innerHTML = `<div class="empty">
        <div class="empty-icon">∅</div>
        <div class="empty-title">No projects found</div>
        <div class="empty-sub">Add one in Project Setup first.</div>
      </div>`;
      return;
    }
    const cur = window.STATE.activeProject;
    cont.innerHTML = list.map(p => {
      const code = p['Project Code'] || '—';
      const name = p['Project Name'] || '(no name)';
      const isActive = cur && cur['Project Code'] === code;
      return `<div class="proj-row ${isActive ? 'active' : ''}"
                   onclick="Shell.selectProject('${Utils.esc(code)}')">
        <span class="pr-code">${Utils.esc(code)}</span>
        <span class="pr-name">${Utils.esc(name)}</span>
      </div>`;
    }).join('');
  }
  function selectProject(code) {
    const p = window.STATE.projects.find(x => x['Project Code'] === code);
    if (!p) return;
    window.STATE.activeProject = p;
    window.STATE.months = Utils.genMonths(p['Start Date'], p['End Date']);
    if (!window.STATE.months || !window.STATE.months.length) {
      const cur = new Date(); cur.setDate(1);
      for (let i = 0; i < 12; i++) {
        window.STATE.months.push(cur.toISOString().slice(0, 7));
        cur.setMonth(cur.getMonth() + 1);
      }
    }
    window.persistState();
    closeProjectSwitcher();
    refreshHeaderProjectPill();
    Utils.toast(`Loaded: ${p['Project Code']}`, 'ok');
    if (window.PAGE && typeof window.PAGE.onProjectChange === 'function') {
      window.PAGE.onProjectChange();
    }
  }
  async function refresh() {
    await loadProjects();
    _stampUpdated();
    Utils.toast(`Loaded ${(window.STATE.projects || []).length} projects`, 'ok');
    if (window.PAGE && typeof window.PAGE.onProjectChange === 'function') {
      window.PAGE.onProjectChange();
    }
  }

  return {
    init, refresh, stampSaved,
    openProjectSwitcher, closeProjectSwitcher,
    filterProjects, selectProject,
  };
})();
