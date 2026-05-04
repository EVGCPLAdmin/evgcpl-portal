/* ═══════════════════════════════════════════════════════════════════
   PCC — Activity Master (cascading Nature of Work → Type of Work)
   ───────────────────────────────────────────────────────────────────
   Drop into:  /pcc/assets/js/activities-master.js

   Source of truth: PCC sheet → M_PL_1_Activities tab
                    1dQow9nD4e0qVOSfpwEWQmPTuhF3FW_8r1oK5dMjJlRE

   Used by:    wbs.html, workplan.html, boq.html, and any DPR form
               that asks for Nature of Work + Type of Work.

   This is a stand-alone module — it does NOT depend on portal-bundle.js
   so it works inside the iframed PCC pages even if portal globals
   aren't visible there.
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const PCC_SHEET_ID = '1dQow9nD4e0qVOSfpwEWQmPTuhF3FW_8r1oK5dMjJlRE';
  const ACTIVITY_TAB = 'M_PL_1_Activities';
  const CACHE_KEY    = 'pcc_activitiesCache';
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  let _cache = null;

  function _norm(s) { return (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, ''); }

  function _findCol(cols, ...names) {
    for (const n of names) {
      const i = cols.findIndex(c => _norm(c) === _norm(n));
      if (i >= 0) return i;
    }
    return -1;
  }

  function _readSession() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj.loadedAt || (Date.now() - obj.loadedAt) > CACHE_TTL_MS) return null;
      return obj;
    } catch (_) { return null; }
  }

  function _writeSession(obj) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch (_) {}
  }

  /**
   * Load the activity master from the PCC sheet (cached for 5 minutes).
   * Returns: Promise<Array<{natureOfWork, typeOfWork, uom, dependsOn, basis, active}>>
   */
  async function loadActivityMaster(force) {
    if (!force) {
      if (_cache && (Date.now() - _cache.loadedAt) < CACHE_TTL_MS) return _cache.rows;
      const fromSession = _readSession();
      if (fromSession) { _cache = fromSession; return _cache.rows; }
    }
    const url = `https://docs.google.com/spreadsheets/d/${PCC_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(ACTIVITY_TAB)}`;
    try {
      const res = await fetch(url);
      const txt = await res.text();
      const m   = txt.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
      if (!m) throw new Error('Bad gviz response — sheet may not be public');
      const data = JSON.parse(m[1]);
      if (!data.table || !data.table.cols) throw new Error('No table data');

      const cols = data.table.cols.map(c => (c.label || c.id || '').toString().trim());
      const iN = _findCol(cols, 'Nature of Work', 'NatureOfWork', 'Cost Package');
      const iT = _findCol(cols, 'Type of Work', 'TypeOfWork', 'Activity', 'Cost Center');
      const iU = _findCol(cols, 'UOM', 'Unit', 'Unit of Measure');
      const iD = _findCol(cols, 'Depends On', 'DependsOn', 'Predecessor');
      const iB = _findCol(cols, 'Measurement Basis', 'Formula', 'Basis');
      const iA = _findCol(cols, 'Active', 'Status', 'Enabled');

      const get = (cells, i) => i < 0 ? '' : (cells[i]?.f ?? cells[i]?.v ?? '').toString().trim();

      const rows = (data.table.rows || []).map(r => {
        const c = r.c || [];
        const activeStr = iA >= 0 ? get(c, iA) : '';
        return {
          natureOfWork:     get(c, iN),
          typeOfWork:       get(c, iT),
          uom:              get(c, iU),
          dependsOn:        get(c, iD),
          measurementBasis: get(c, iB),
          active:           !activeStr || /^(true|yes|y|1|active|on)$/i.test(activeStr),
        };
      }).filter(x => x.natureOfWork && x.typeOfWork && x.active);

      _cache = { rows, loadedAt: Date.now() };
      _writeSession(_cache);
      return rows;
    } catch (err) {
      console.warn('[ActivityMaster] load failed:', err.message);
      _cache = { rows: [], loadedAt: Date.now(), error: err.message };
      return [];
    }
  }

  /**
   * Get unique sorted list of Nature of Work values.
   * Use for the WBS Level 2 dropdown and as the parent for cascading.
   */
  function getNaturesOfWork() {
    const rows = (_cache && _cache.rows) || [];
    return [...new Set(rows.map(r => r.natureOfWork))].sort();
  }

  /**
   * Get sorted list of Types of Work for a given Nature of Work.
   * Use for the cascading child dropdown.
   * Returns: Array<{typeOfWork, uom, dependsOn, basis}>
   */
  function getTypesOfWork(natureOfWork) {
    if (!natureOfWork) return [];
    const rows = (_cache && _cache.rows) || [];
    return rows
      .filter(r => r.natureOfWork.toLowerCase() === natureOfWork.toLowerCase())
      .map(r => ({
        typeOfWork: r.typeOfWork,
        uom: r.uom,
        dependsOn: r.dependsOn,
        basis: r.measurementBasis,
      }))
      .sort((a, b) => a.typeOfWork.localeCompare(b.typeOfWork));
  }

  /**
   * Wire two <select>s as cascading dropdowns.
   * @param natureId - id of the Nature of Work select
   * @param typeId   - id of the Type of Work select
   * @param opts.onChange   - callback({nature, type, uom, basis})
   * @param opts.uomFieldId - optional id of an input/span to auto-fill with UOM
   */
  async function bindActivityCascade(natureId, typeId, opts) {
    opts = opts || {};
    await loadActivityMaster();
    const nSel = document.getElementById(natureId);
    const tSel = document.getElementById(typeId);
    if (!nSel || !tSel) {
      console.warn('[ActivityMaster] selects not found:', natureId, typeId);
      return;
    }

    const natures = getNaturesOfWork();
    nSel.innerHTML = '<option value="">— Select Nature of Work —</option>'
                   + natures.map(n => `<option value="${_esc(n)}">${_esc(n)}</option>`).join('');

    function repopulateTypes(nature) {
      const types = getTypesOfWork(nature);
      tSel.innerHTML = '<option value="">— Select Type of Work —</option>'
                     + types.map(t => {
                         const label = t.uom ? `${t.typeOfWork} (${t.uom})` : t.typeOfWork;
                         return `<option value="${_esc(t.typeOfWork)}" data-uom="${_esc(t.uom||'')}" data-deps="${_esc(t.dependsOn||'')}" data-basis="${_esc(t.basis||'')}">${_esc(label)}</option>`;
                       }).join('');
      tSel.disabled = types.length === 0;
    }

    repopulateTypes(nSel.value);

    nSel.addEventListener('change', () => {
      repopulateTypes(nSel.value);
      _emit({ nature: nSel.value, type: '', uom: '', basis: '' });
    });
    tSel.addEventListener('change', () => {
      const opt   = tSel.options[tSel.selectedIndex];
      const uom   = opt ? opt.dataset.uom   || '' : '';
      const basis = opt ? opt.dataset.basis || '' : '';
      if (opts.uomFieldId) {
        const f = document.getElementById(opts.uomFieldId);
        if (f) ('value' in f) ? (f.value = uom) : (f.textContent = uom);
      }
      _emit({ nature: nSel.value, type: tSel.value, uom, basis });
    });

    function _emit(payload) { if (opts.onChange) opts.onChange(payload); }
  }

  function _esc(s) {
    return (s || '').toString()
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Public API ──
  global.ActivityMaster = {
    load:           loadActivityMaster,
    natures:        getNaturesOfWork,
    types:          getTypesOfWork,
    bindCascade:    bindActivityCascade,
    invalidate:     () => { _cache = null; sessionStorage.removeItem(CACHE_KEY); },
  };
})(window);
