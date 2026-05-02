/* ════════════════════════════════════════════════════════════════
   UTILS · formatting, toast, dates, helpers
═══════════════════════════════════════════════════════════════ */

window.Utils = (function() {

  function fmt(n, d = 0) {
    const v = Number(n) || 0;
    return v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  const fmt2 = n => fmt(n, 2);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg, type = 'ok', duration = 2400) {
    const t = document.getElementById('toast');
    if (!t) return console.log(`[toast:${type}]`, msg);
    t.textContent = msg;
    t.className = 'show ' + type;
    setTimeout(() => t.className = '', duration);
  }

  function uuid(prefix = '') {
    return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36).toUpperCase();
  }

  function genMonths(start, end) {
    const out = [];
    if (!start || !end) return out;
    const s = new Date(start), e = new Date(end);
    if (isNaN(s) || isNaN(e)) return out;
    const cur = new Date(s.getFullYear(), s.getMonth(), 1);
    while (cur <= e) {
      out.push(cur.toISOString().slice(0, 7));
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }

  function monthLabel(ym) {
    if (!ym) return '';
    const [y, m] = String(ym).split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[+m - 1] || m} ${y.slice(2)}`;
  }

  function debounce(fn, ms = 200) {
    let h;
    return function(...args) {
      clearTimeout(h);
      h = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  return { fmt, fmt2, esc, toast, uuid, genMonths, monthLabel, debounce };
})();
