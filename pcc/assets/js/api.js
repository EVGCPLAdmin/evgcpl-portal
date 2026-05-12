/* ════════════════════════════════════════════════════════════════
   API · gviz reads + Apps Script POST writes
   Same patterns as project_setup_v1
═══════════════════════════════════════════════════════════════ */

window.API = (function() {

  /**
   * Read a Google Sheet tab via gviz JSON.
   * Sheet must be public (Anyone with link → Viewer).
   * Returns array of objects keyed by column header (label).
   */
  async function gviz(tab, sheetId) {
    const id = sheetId || window.CONFIG.SHEET_ID;
    const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const txt = await r.text();
      const m = txt.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/);
      if (!m) throw new Error('Bad gviz response');
      const data = JSON.parse(m[1]);
      if (!data.table) return [];
      const cols = data.table.cols.map(c => c.label || c.id);
      return data.table.rows.map(row => {
        const obj = {};
        (row.c || []).forEach((cell, i) => {
          obj[cols[i]] = cell ? (cell.f || cell.v) : '';
        });
        return obj;
      });
    } catch (e) {
      console.warn(`gviz ${tab} failed:`, e.message);
      return [];
    }
  }

  /**
   * POST to Apps Script.
   * CORS-safe pattern: text/plain content-type with JSON body.
   */
  async function scriptCall(action, payload) {
    if (window.CONFIG.DEMO_MODE) {
      await new Promise(r => setTimeout(r, 400));
      return { success: true, message: 'Demo mode — not saved' };
    }
    try {
      // Spread payload at top level alongside action so Apps Script handlers
      // can read p.projectCode, p.nodes, etc. directly (no wrapper object).
      const r = await fetch(window.CONFIG.SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action, ...(payload || {}) }),
      });
      return await r.json();
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  return { gviz, scriptCall };
})();
