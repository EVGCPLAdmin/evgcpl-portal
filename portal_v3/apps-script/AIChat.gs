/**
 * EVGCPL Portal — Groq AI Chat Proxy
 * ──────────────────────────────────────────────────────────────────
 * Routes user questions through Groq's Llama 3.3 70B model with
 * context-specific data pulled from the right sheets.
 *
 * Deployment:
 *   1. Open https://script.google.com → open the EVGCPL portal project
 *   2. Append this file's contents to your existing Code.gs (or create
 *      a new file AIChat.gs and paste this in)
 *   3. Project Settings → Script properties → add property:
 *        Name:  GROQ_API_KEY
 *        Value: gsk_xxxxxxxxxxxxxxx  (from console.groq.com)
 *   4. Deploy → Manage Deployments → edit the existing deployment
 *      pencil → New Version → Deploy
 *   5. Exec URL stays the same — no portal change needed
 *
 * Get a Groq API key:
 *   1. Sign up at https://console.groq.com (free)
 *   2. API Keys → Create API Key
 *   3. Copy the key (starts with gsk_) — paste into Script Properties
 *
 * The portal calls this with:
 *   POST { action: 'aiProxy', system: '...', messages: [...], context: 'accounts' }
 * Response:
 *   { success: true, reply: '...' }
 *
 * Models tried: llama-3.3-70b-versatile (default — 128K context, fast)
 * Free tier:    30 req/min, 14K tokens/min — plenty for a portal
 */

// ── Sheet IDs (mirror the portal-bundle.js constants) ───────────────
var AI_SHEETS = {
  EMP:     '1HWKZPhKRhcuvxBgyyN8zRt8p-SzYmKjJWiOdCgykBHs',
  PO:      '1zcqF2tjjBETPuW25c9MBMo0zakBIBD6tksg5OstFA7c',
  PAYMENT: '1mLddxLRf719EaXE9XSET9gT8l0a8Cxns362yIbHo63g',
  STORES:  '1iMQxgqGilUh2_3NCZl5D-EMt-NC8FwugX83q2fWb8fE',
  V2:      '1fhSO4WBYp0LNXPxe9I9zr5qsIPs9CIDFpUixBogPnsM',
  SAFETY:  '1B8P0PawV43ksazbzhKsil1X6-INOfxx9PFvGycNOvDY',
  REWARDS: '1vz8HLopjlSF8TF7rzYuVu5JjqukT929I7aSx7kdehlI',
};

// ── Context → which sheets to pull ──────────────────────────────────
// Each context is a list of { sheetId, tab, label, maxRows }. Lower
// maxRows when a sheet is wide; raise when rows are sparse.
var AI_CONTEXTS = {
  accounts: [
    { sheetId: AI_SHEETS.PAYMENT, tab: 'PaymentRequest', label: 'Payment requests', maxRows: 150 },
  ],
  purchase: [
    { sheetId: AI_SHEETS.PO, tab: 'MRS',          label: 'MRS / requisitions',  maxRows: 100 },
    { sheetId: AI_SHEETS.PO, tab: 'PO',           label: 'Purchase orders',     maxRows: 100 },
    { sheetId: AI_SHEETS.PO, tab: 'VendorMaster', label: 'Vendor directory',    maxRows: 200 },
  ],
  stores: [
    { sheetId: AI_SHEETS.STORES, tab: 'StockIN',     label: 'Stock IN entries',  maxRows: 150 },
    { sheetId: AI_SHEETS.STORES, tab: 'StockLevels', label: 'Current stock',      maxRows: 200 },
    { sheetId: AI_SHEETS.STORES, tab: 'GRN_No',      label: 'GRN log',            maxRows: 100 },
  ],
  hr: [
    { sheetId: AI_SHEETS.EMP, tab: '0_EmployeeRegister_Live', label: 'Employees', maxRows: 350 },
  ],
  site: [
    { sheetId: AI_SHEETS.PO, tab: 'SiteMaster',  label: 'Site master',  maxRows: 100 },
    { sheetId: AI_SHEETS.V2, tab: 'DPR',          label: 'DPR entries',  maxRows: 150 },
    { sheetId: AI_SHEETS.V2, tab: 'LogSheet',     label: 'Plant log',    maxRows: 100 },
  ],
  safety: [
    { sheetId: AI_SHEETS.SAFETY, tab: 'Incidents', label: 'Safety incidents', maxRows: 100 },
    { sheetId: AI_SHEETS.SAFETY, tab: 'Checklist', label: 'SHE checklist',    maxRows: 50 },
  ],
  rewards: [
    { sheetId: AI_SHEETS.REWARDS, tab: 'Nomination', label: 'Nominations', maxRows: 100 },
    { sheetId: AI_SHEETS.REWARDS, tab: 'BlogPosts',  label: 'Wall posts',   maxRows: 50 },
  ],
  // 'all' is a special context that pulls a tighter slice from every
  // sheet — useful for cross-cutting questions but more expensive.
  all: [
    { sheetId: AI_SHEETS.PAYMENT, tab: 'PaymentRequest',           label: 'Payments',       maxRows: 50 },
    { sheetId: AI_SHEETS.PO,      tab: 'MRS',                       label: 'MRS',            maxRows: 40 },
    { sheetId: AI_SHEETS.PO,      tab: 'PO',                        label: 'Purchase Orders',maxRows: 40 },
    { sheetId: AI_SHEETS.STORES,  tab: 'StockLevels',               label: 'Stock',          maxRows: 60 },
    { sheetId: AI_SHEETS.EMP,     tab: '0_EmployeeRegister_Live',   label: 'Employees',      maxRows: 100 },
    { sheetId: AI_SHEETS.V2,      tab: 'DPR',                        label: 'DPR',            maxRows: 40 },
    { sheetId: AI_SHEETS.SAFETY,  tab: 'Incidents',                  label: 'Safety',         maxRows: 40 },
  ],
};


/**
 * Main handler — call from doPost when action === 'aiProxy'
 *
 * Expected POST body:
 *   { action: 'aiProxy',
 *     context: 'accounts' | 'purchase' | 'stores' | 'hr' | 'site' | 'safety' | 'rewards' | 'all',
 *     messages: [{ role:'user', content:'...' }, ...],
 *     system?: 'optional override system prompt' }
 *
 * Returns:
 *   { success: true, reply: '...', tokensUsed: 1234, context: 'accounts' }
 *   or { success: false, message: 'reason' }
 */
function aiProxy(data) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('GROQ_API_KEY');
    if (!apiKey) {
      return _aiErr('GROQ_API_KEY not set in Script Properties. Add it via Project Settings → Script properties.');
    }

    var contextKey = (data.context || 'all').toLowerCase();
    var contextSheets = AI_CONTEXTS[contextKey] || AI_CONTEXTS['all'];

    // ── 1. Pull data from each context sheet ────────────────────────
    var dataBlock = '';
    for (var i = 0; i < contextSheets.length; i++) {
      var spec = contextSheets[i];
      var csv = _aiPullSheet(spec.sheetId, spec.tab, spec.maxRows);
      if (csv) {
        dataBlock += '\n## ' + spec.label + ' (' + spec.tab + ')\n' + csv + '\n';
      }
    }

    // ── 2. Build the system prompt ──────────────────────────────────
    var systemPrompt = (data.system || '') +
      '\n\n## CONTEXT: ' + contextKey.toUpperCase() + '\n' +
      'Below is the relevant operational data. Answer using ONLY this data. ' +
      'If the answer is not present in the data, say so plainly. ' +
      'Be concise. Use bullet points for lists. Use ₹ for Indian Rupees, $ for USD.\n' +
      dataBlock;

    // ── 3. Compose Groq messages ────────────────────────────────────
    var messages = [{ role: 'system', content: systemPrompt }];
    var userMessages = data.messages || [];
    for (var j = 0; j < userMessages.length; j++) {
      var m = userMessages[j];
      if (m.role === 'user' || m.role === 'assistant') {
        messages.push({ role: m.role, content: String(m.content || '') });
      }
    }

    // ── 4. Call Groq ────────────────────────────────────────────────
    var response = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: messages,
        temperature: 0.2,
        max_tokens: 800,
      }),
    });

    var statusCode = response.getResponseCode();
    var body = response.getContentText();

    if (statusCode !== 200) {
      Logger.log('Groq error ' + statusCode + ': ' + body);
      return _aiErr('Groq API returned ' + statusCode + ': ' + body.substring(0, 200));
    }

    var result = JSON.parse(body);
    var reply = (result.choices && result.choices[0] && result.choices[0].message)
      ? result.choices[0].message.content
      : 'No response generated.';

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        reply: reply,
        tokensUsed: result.usage ? result.usage.total_tokens : null,
        context: contextKey,
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('aiProxy fatal: ' + err.toString());
    return _aiErr('Server error: ' + err.toString());
  }
}


// ── Helpers ─────────────────────────────────────────────────────────

function _aiPullSheet(sheetId, tab, maxRows) {
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName(tab);
    if (!sheet) return '';
    var rng = sheet.getDataRange();
    var values = rng.getValues();
    if (!values.length) return '';

    var limit = Math.min(values.length, (maxRows || 100) + 1);  // +1 for header row
    var slice = values.slice(0, limit);

    // Compact CSV — quote only when needed (commas / newlines in cell)
    var lines = slice.map(function(row) {
      return row.map(function(cell) {
        if (cell == null) return '';
        var s = String(cell);
        // Truncate very long text cells (description fields, etc.)
        if (s.length > 140) s = s.substring(0, 140) + '…';
        if (s.indexOf(',') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('"') >= 0) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      }).join(',');
    });

    var note = '';
    if (values.length > limit) {
      note = '\n[Showing ' + (limit - 1) + ' of ' + (values.length - 1) + ' rows]';
    }
    return lines.join('\n') + note;

  } catch (err) {
    Logger.log('_aiPullSheet error for ' + sheetId + '/' + tab + ': ' + err);
    return '';
  }
}

function _aiErr(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, message: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * IMPORTANT — Wire this into your existing doPost():
 *
 *   function doPost(e) {
 *     var data = JSON.parse(e.postData.contents);
 *     if (data.action === 'aiProxy')          return aiProxy(data);
 *     if (data.action === 'appendRow')        return appendRow(data);
 *     // ...other actions...
 *   }
 */
