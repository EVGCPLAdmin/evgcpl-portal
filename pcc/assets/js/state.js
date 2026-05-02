/* ════════════════════════════════════════════════════════════════
   STATE · Cross-page state with localStorage persistence
   Active project survives navigation between pages.
═══════════════════════════════════════════════════════════════ */

const LS_KEY = 'EVGCPL_PCC_STATE_V1';

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function persistState() {
  try {
    const minimal = {
      activeProject: window.STATE.activeProject,
      months:        window.STATE.months,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(minimal));
  } catch {}
}

const persisted = loadPersistedState() || {};

window.STATE = {
  // Project context (persisted)
  activeProject: persisted.activeProject || null,
  months:        persisted.months        || [],

  // Per-page caches (in-memory only; reload on page change)
  projects:   [],
  boq:        [],
  wbs:        [],
  activities: [],
  workplan:   [],
  manpower:   [],
  machinery:  [],
  materials:  [],
  overheads:  [],
  variations: [],

  loadingProjects: false,
};

window.persistState = persistState;
