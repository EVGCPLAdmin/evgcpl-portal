/* ═══════════════════════════════════════════════════════════════════
   EVGCPL Portal — Shared State
   /assets/js/state.js
   ═══════════════════════════════════════════════════════════════════ */

window.STATE = (function() {
  'use strict';

  const KEY = 'evgcpl_state_v1';

  let _state = {
    user: null,        // { email, name, picture }
    role: 'employee',  // resolved portal role
    employee: null,    // matched row from Employee Register
    devMode: false,
    darkMode: false,
    pinned: [],        // array of route ids
    recent: [],        // array of { route, label, ts }
  };

  // ── load from localStorage ────────────────────────────────────
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) Object.assign(_state, JSON.parse(saved));
  } catch (e) { /* fall back to defaults */ }


  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(_state)); } catch (e) {}
  }

  function get(key) { return key ? _state[key] : { ..._state }; }

  function set(patch) {
    Object.assign(_state, patch);
    persist();
  }

  function clear() {
    _state = { user:null, role:'employee', employee:null, devMode:false, darkMode:false, pinned:[], recent:[] };
    persist();
  }

  function isLoggedIn() { return !!(_state.user && _state.user.email); }

  function pushRecent(route, label) {
    _state.recent = _state.recent.filter(r => r.route !== route);
    _state.recent.unshift({ route, label, ts: Date.now() });
    if (_state.recent.length > 8) _state.recent = _state.recent.slice(0, 8);
    persist();
  }

  function togglePin(route) {
    const i = _state.pinned.indexOf(route);
    if (i >= 0) _state.pinned.splice(i, 1);
    else _state.pinned.push(route);
    persist();
  }


  /* ────────────────────────────────────────────────────────────
     ROLE HIERARCHY RESOLVER
     Reads ALL roles from "Role (User Type)" column in Employee
     Register. Hierarchy: MD > Admin > Process Owner > Recruiter >
     Department Head > RM > Site-In-Charge > User
     ──────────────────────────────────────────────────────────── */
  const ROLE_HIERARCHY = [
    { rank: 8, match: r => /\bmd\b|director|managing director/i.test(r),         portal: 'md',         label: 'MD / Director' },
    { rank: 7, match: r => /\badmin\b|administrator/i.test(r),                   portal: 'md',         label: 'Admin' },
    { rank: 6, match: r => /process owner/i.test(r),                              portal: 'md',         label: 'Process Owner' },
    { rank: 5, match: r => /recruiter|talent acquisition/i.test(r),              portal: 'hr',         label: 'Recruiter' },
    { rank: 4, match: r => /department head|dept head|dept\.? head/i.test(r),    portal: 'dept_head',  label: 'Department Head' },
    { rank: 3, match: r => /\brm\b|reporting manager/i.test(r),                  portal: 'site',       label: 'RM' },
    { rank: 2, match: r => /site.?in.?charge|site incharge|site manager/i.test(r), portal: 'site',     label: 'Site-In-Charge' },
    { rank: 1, match: r => /\bhr\b|human resource/i.test(r),                     portal: 'hr',         label: 'HR' },
    { rank: 1, match: r => /purchase|procurement/i.test(r),                       portal: 'purchase',   label: 'Purchase' },
    { rank: 1, match: r => /account/i.test(r),                                    portal: 'accounts',   label: 'Accounts' },
    { rank: 0, match: r => /\buser\b|employee|staff/i.test(r) || r.trim() !== '',portal: 'employee',   label: 'User' },
  ];

  function resolveRole(emp) {
    if (!emp) return { portalRole:'employee', allRoles:[], topRoleLabel:'User', deptHeadDept:'' };
    const raw = (emp['Role (User Type)'] || '').toString();
    const items = raw.split(/[,|;\n\/]+/).map(s => s.trim()).filter(Boolean);
    if (!items.length) return { portalRole:'employee', allRoles:[], topRoleLabel:'User', deptHeadDept:'' };
    let best = null;
    items.forEach(r => {
      for (const h of ROLE_HIERARCHY) {
        if (h.match(r)) { if (!best || h.rank > best.rank) best = { ...h, raw:r }; break; }
      }
    });
    return {
      portalRole: best?.portal || 'employee',
      topRoleLabel: best?.label || 'User',
      allRoles: items,
      deptHeadDept: best?.portal === 'dept_head' ? (emp['Department'] || '') : '',
    };
  }


  return { get, set, clear, persist, isLoggedIn, pushRecent, togglePin, resolveRole, ROLE_HIERARCHY };
})();
