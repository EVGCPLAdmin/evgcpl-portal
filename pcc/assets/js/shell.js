/* ════════════════════════════════════════════════════════════════
   SHELL · Header, navigation, project switcher
   Each page calls Shell.init({pageId: 'workplan'}) on load.
═══════════════════════════════════════════════════════════════ */

window.Shell = (function() {

  const C = window.CONFIG;

  function buildHeader(currentPageId) {
    const ap = window.STATE.activeProject;
    const code = ap ? (ap['Project Code'] || '—') : '—';
    const name = ap ? (ap['Project Name'] || '(no name)') : 'No project';

    const pageMeta = (C.PAGES || []).find(p => p.id === currentPageId);
    const pageStep = pageMeta && pageMeta.step !== '·' ? `Step ${pageMeta.step}` : 'Module';

    return `
      <header class="app-header">
        <div class="ah-l">
          <a href="index.html" style="display:flex;align-items:center;gap:14px">
            <img src="assets/img/EG.jpg" class="ah-logo" alt="EG"
                 onerror="this.style.display='none'" />
          </a>
          <div class="ah-divider"></div>
          <div class="ah-brand">
            <span class="b1">Project Cost Control</span>
            <span class="b2">${pageStep} · ${pageMeta ? pageMeta.title : 'Page'}</span>
          </div>
        </div>
        <div class="ah-r">
          <div class="proj-pill" onclick="Shell.openProjectSwitcher()" title="Change project">
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
      </header>
    `;
  }

  function buildNav(currentPageId) {
    // The nav row shows Steps 1–8 + Variations + Summary; Home/index isn't shown
    const navItems = (C.PAGES || []).filter(p => p.id !== 'home');
    const idx = navItems.findIndex(p => p.id === currentPageId);

    return `
      <nav class="app-nav">
        ${navItems.map((p, i) => {
          const isActive = p.id === currentPageId;
          const isDone = idx > i; // earlier steps marked done when on later step
          const cls = isActive ? 'active' : (isDone ? 'done' : '');
          const stepNum = (p.step === '·' || !p.step) ? p.icon : p.step;
          return `<a class="nav-link ${cls}" href="${p.file}" title="${Utils.esc(p.desc)}">
            <span class="step-num">${stepNum}</span>
            <span>${Utils.esc(p.title)}</span>
          </a>`;
        }).join('')}
      </nav>
    `;
  }

  function buildFooter() {
    return `
      <footer class="app-footer">
        Project Cost Control · <span class="v">v1.0 · Multi-page</span> ·
        Steps 1–8 of Project Budget Preparation Flow ·
        <a href="https://docs.google.com/spreadsheets/d/${C.SHEET_ID}/edit"
           target="_blank" rel="noopener" style="color:var(--green)">Backing Sheet ↗</a>
      </footer>
    `;
  }

  function buildProjectSwitcher() {
    return `
      <div class="modal-bg" id="projectSwitcher" onclick="if(event.target===this)Shell.closeProjectSwitcher()">
        <div class="modal">
          <div class="modal-head">
            <h3>Select Project</h3>
            <button class="btn-icon" onclick="Shell.closeProjectSwitcher()">✕</button>
          </div>
          <div class="modal-body">
            <div class="modal-search">
              <input type="text" id="projectSearch" placeholder="Search by code or name…"
                     oninput="Shell.filterProjects(this.value)" />
            </div>
            <div id="projectList">
              <div class="empty"><div class="empty-icon">📁</div>
                <div class="empty-title">Loading projects…</div></div>
            </div>
          </div>
        </div>
      </div>
      <div id="toast"></div>
    `;
  }

  /**
   * Init shell: inject header/nav/footer, load projects, restore active project.
   * Call from every page's bootstrap.
   */
  async function init(opts) {
    const pageId = (opts && opts.pageId) || '';

    // Inject header BEFORE main content
    const header = document.createElement('div');
    header.innerHTML = buildHeader(pageId) + buildNav(pageId);
    document.body.insertBefore(header, document.body.firstChild);

    // Inject footer + switcher AFTER main
    const tail = document.createElement('div');
    tail.innerHTML = buildFooter() + buildProjectSwitcher();
    document.body.appendChild(tail);

    // Load projects
    await loadProjects();

    return { activeProject: window.STATE.activeProject };
  }

  async function loadProjects() {
    const projects = await API.gviz(C.TABS.PROJECT);
    window.STATE.projects = projects.filter(p => p['Project Code']);
    if (window.STATE.activeProject && window.STATE.projects.length) {
      // Re-resolve from latest data
      const code = window.STATE.activeProject['Project Code'];
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
    const filtered = window.STATE.projects.filter(p =>
      String(p['Project Code'] || '').toLowerCase().includes(ql) ||
      String(p['Project Name'] || '').toLowerCase().includes(ql)
    );
    renderProjectList(filtered);
  }
  function renderProjectList(list) {
    const cont = document.getElementById('projectList');
    if (!cont) return;
    if (!list.length) {
      cont.innerHTML = `<div class="empty"><div class="empty-icon">∅</div>
        <div class="empty-title">No projects found</div>
        <div class="empty-sub">Add a project in the Project Setup page first.</div></div>`;
      return;
    }
    cont.innerHTML = list.map(p => {
      const code = p['Project Code'] || '—';
      const name = p['Project Name'] || '(no name)';
      const cur  = window.STATE.activeProject;
      const isActive = cur && cur['Project Code'] === code;
      return `<div class="proj-row ${isActive ? 'active' : ''}" onclick="Shell.selectProject('${Utils.esc(code)}')">
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
    if (!window.STATE.months.length) {
      // Fallback: 12 months from current
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
    // Trigger page reload of data
    if (window.PAGE && typeof window.PAGE.onProjectChange === 'function') {
      window.PAGE.onProjectChange();
    }
  }
  async function refresh() {
    await loadProjects();
    Utils.toast(`Loaded ${window.STATE.projects.length} projects`, 'ok');
    if (window.PAGE && typeof window.PAGE.onProjectChange === 'function') {
      window.PAGE.onProjectChange();
    }
  }

  return {
    init, refresh,
    openProjectSwitcher, closeProjectSwitcher,
    filterProjects, selectProject,
  };
})();
