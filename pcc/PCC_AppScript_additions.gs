/**
 * EVGCPL PCC — Apps Script Patch (build 357)
 * Add these 3 handlers to your existing doPost() in PCCHandlers.gs / Router.gs
 *
 * Sheet ID: 1dQow9nD4e0qVOSfpwEWQmPTuhF3FW_8r1oK5dMjJlRE
 * Tabs used: WBS · Activities · WorkPlan
 */

const PCC_SHEET_ID_357 = '1dQow9nD4e0qVOSfpwEWQmPTuhF3FW_8r1oK5dMjJlRE';

// ── Helper ────────────────────────────────────────────────────────
function pccTab357(name, headers) {
  const ss    = SpreadsheetApp.openById(PCC_SHEET_ID_357);
  let   sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers?.length) {
      const r = sheet.getRange(1, 1, 1, headers.length);
      r.setValues([headers]).setFontWeight('bold')
       .setBackground('#1a5276').setFontColor('#ffffff');
    }
  }
  return sheet;
}

// ── saveWBS (FIXED — writes both CheckSum + BOQCheckSum) ──────────
function pccSaveWBS_357(row) {
  const HDR = ['UUID','CheckSum','BOQCheckSum','ProjectUUID','Project Code',
               'WBS Code','WBS Description','Unit','Qty','Timestamp','Active/Inactive?'];
  const sheet   = pccTab357('WBS', HDR);
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(h => row[h] ?? ''));
  return { success: true };
}

// ── saveActivity ──────────────────────────────────────────────────
function pccSaveActivity_357(row) {
  const HDR = ['UUID','CheckSum','Activity Description','Nature of Work',
               'Type of Work','Unit','Qty','Timestamp','Active/Inactive?'];
  const sheet   = pccTab357('Activities', HDR);
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(h => row[h] ?? ''));
  return { success: true };
}

// ── saveWorkPlan (upsert: clears project+FY, re-writes) ───────────
function pccSaveWorkPlan_357(rows, fy, projectCode) {
  if (!rows?.length) return { success: true, written: 0 };
  const HDR = ['UUID','WBSCheckSum','BOQCheckSum','ProjectCode',
               'FY','MonthKey','MonthLabel','Qty','Timestamp'];
  const sheet = pccTab357('WorkPlan', HDR);

  // Delete stale rows for this project+FY (bottom-up to keep index stable)
  const last = sheet.getLastRow();
  if (last > 1) {
    const data  = sheet.getRange(2,1,last-1,sheet.getLastColumn()).getValues();
    const hdrs  = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
    const fyC   = hdrs.indexOf('FY');
    const prjC  = hdrs.indexOf('ProjectCode');
    for (let i = data.length-1; i >= 0; i--) {
      if (data[i][fyC] === fy && data[i][prjC] === projectCode)
        sheet.deleteRow(i + 2);
    }
  }

  // Append new rows
  const hdrs = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  rows.forEach(r => sheet.appendRow(hdrs.map(h => r[h] ?? '')));
  return { success: true, written: rows.length };
}

// ── Paste into your doPost() switch block ─────────────────────────
/*
  case 'saveWBS':       return pccSaveWBS_357(payload.row);
  case 'saveActivity':  return pccSaveActivity_357(payload.row);
  case 'saveWorkPlan':  return pccSaveWorkPlan_357(payload.rows, payload.fy, payload.projectCode);
*/
