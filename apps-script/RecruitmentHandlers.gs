// ════════════════════════════════════════════════════════════════
//  RECRUITMENT HANDLERS  —  add to EVGCPL_Portal_API
//  File: RecruitmentHandlers.gs  (paste into same project as Router.gs)
//  All actions routed via existing Router.gs doPost handler
// ════════════════════════════════════════════════════════════════

// ── Sheet tab names ───────────────────────────────────────────
const RC_TABS = {
  MRF:      'MRF_Register',
  OFFERS:   'Offer_Tracker',
  PREJOIN:  'PreJoining_Checklist',
  JOINING:  'v1_JoiningList',          // existing tab — do NOT rename
};

// ── Default headers ───────────────────────────────────────────
const RC_MRF_HEADERS = [
  'MRF ID','Position','Department','Site','Vacancies','Type','Replacing',
  'Required By','Reporting To','Skills','Reason','Budget',
  'Status','Raised By','Raised By Email','HR Remarks','MD Remarks',
  'Created At','Updated At','Updated By','Closed At'
];

const RC_OFFER_HEADERS = [
  'OL ID','MRF ID','Candidate Name','Position','Site','CTC (Annual)',
  'Basic','HRA','Allowances','PF','Gross','Net',
  'Joining Date','Probation Period','Offer Valid Until',
  'Candidate Email','Dispatch Method',
  'Status','Sent Date','Acceptance Date','Remarks',
  'Created By','Created At',
  // Appended for full letter rendering (offer + appointment templates)
  'Ref No','Offer Date','Grade','Department',
  'Address','Company','Employee Type','Contractual Period',
  'Address Line 1','Address Line 2','Address Line 3','Address Line 4',
  'Start Time','End Time','Notice Period','Reporting Manager',
  'DA','Special Allowance','Conveyance','Education Allowance',
  'Uniform Allowance','LTA','Site Allowance','Medical','PF Employer','CTC (Monthly)',
  // Dynamic salary model (Basic / HRA / Other Allowance)
  'Agreed Salary','Calculated Salary','Basic Total','HRA Total','Other Total','Salary JSON',
  // Approval / lifecycle (Phase 2)
  'Submitted For Approval At','Submitted By','Approved By','Approved At',
  'Accept By','Accepted At','Decline Reason'
];

const RC_PREJOIN_HEADERS = [
  'Joining Code','MRF ID','Candidate Name','Item ID','Item Label','Owner',
  'Checked','Checked By','Checked At','Remarks'
];

const RC_JOINING_HEADERS = [
  'Joining Code','Path','MRF ID','OL ID','Candidate Name','Position','Department',
  'Site','Reporting Manager','Expected DOJ','Actual DOJ',
  'Status','EmpCode','Appointment Letter Ref','Appointment Letter Date',
  'Signed Copy Received','Remarks','Created By','Created At','Updated At',
  // Phase 3 — HR onboarding handoff
  'Onboarding Triggered At','Onboarding Triggered By','Onboarding Status'
];

// ─────────────────────────────────────────────────────────────
//  Helper: get recruitment sheet (opened from RECRUITMENT_SHEET_ID)
//  !! Replace 'YOUR_RECRUITMENT_SHEET_ID' with real ID before deploying !!
// ─────────────────────────────────────────────────────────────
// ── Sheet ID (wired) ──────────────────────────────────────────
const RECRUITMENT_SHEET_ID = '1Dw48OEDmIAAu9Va1-a9z7PZT7wKS_mWU7cwpK6osRNI';

function _rcSS() {
  return SpreadsheetApp.openById(RECRUITMENT_SHEET_ID);
}

function _rcTab(tabName, headers) {
  const ss = _rcSS();
  let sh = ss.getSheetByName(tabName);
  if (!sh) {
    // Tab doesn't exist — create it with our schema
    sh = ss.insertSheet(tabName);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length)
      .setBackground('#1A6038').setFontColor('#FFFFFF').setFontWeight('bold');
    return sh;
  }
  // Tab exists — NEVER overwrite existing headers
  // Only write headers if row 1 col A is completely blank (sheet was just created)
  const firstCell = sh.getRange(1, 1).getValue();
  if (!firstCell || firstCell === '') {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length)
      .setBackground('#1A6038').setFontColor('#FFFFFF').setFontWeight('bold');
  }
  return sh;
}

// ─────────────────────────────────────────────────────────────
//  ACTION: saveMRF
//  Appends a new MRF row to MRF_Register tab
// ─────────────────────────────────────────────────────────────
function saveMRF(payload) {
  try {
    const m  = payload.mrf || {};
    const sh = _rcTab(RC_TABS.MRF, RC_MRF_HEADERS);
    const now = _fmtTimestamp(new Date());

    const row = [
      m.id        || '',   // MRF ID
      m.position  || '',   // Position
      m.dept      || '',   // Department
      m.site      || '',   // Site
      m.vacancies || 1,    // Vacancies
      m.type      || '',   // Type
      m.replacing || '',   // Replacing
      m.requiredBy|| '',   // Required By
      m.reportingTo||'',   // Reporting To
      m.skills    || '',   // Skills
      m.reason    || '',   // Reason
      m.budget    || '',   // Budget
      'Pending HR Review', // Status
      m.raisedBy  || '',   // Raised By
      m.raisedByEmail||'', // Raised By Email
      '', '',              // HR Remarks, MD Remarks
      m.createdAt || now,  // Created At
      now, '', '',         // Updated At, Updated By, Closed At
    ];

    sh.appendRow(row);
    return { success: true, id: m.id };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ACTION: updateMRFStatus
//  Updates status, remarks, timestamps for an existing MRF row
// ─────────────────────────────────────────────────────────────
function updateMRFStatus(payload) {
  try {
    const sh     = _rcTab(RC_TABS.MRF, RC_MRF_HEADERS);
    const data   = sh.getDataRange().getValues();
    const headers= data[0];
    const idCol  = headers.indexOf('MRF ID');
    const statCol= headers.indexOf('Status');
    const hrRmk  = headers.indexOf('HR Remarks');
    const mdRmk  = headers.indexOf('MD Remarks');
    const updAt  = headers.indexOf('Updated At');
    const updBy  = headers.indexOf('Updated By');
    const closAt = headers.indexOf('Closed At');

    const now = _fmtTimestamp(new Date());

    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === payload.id) {
        const rowNum = i + 1;
        sh.getRange(rowNum, statCol+1).setValue(payload.status);
        sh.getRange(rowNum, updAt+1).setValue(now);
        sh.getRange(rowNum, updBy+1).setValue(payload.actor || '');
        if (payload.remarks) {
          const rmkCol = payload.role === 'hr' ? hrRmk : mdRmk;
          sh.getRange(rowNum, rmkCol+1).setValue(payload.remarks);
        }
        const closed = ['Closed – Filled','Closed – Cancelled'].includes(payload.status);
        if (closed) sh.getRange(rowNum, closAt+1).setValue(now);
        return { success: true };
      }
    }
    return { success: false, message: 'MRF ID not found: ' + payload.id };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ACTION: updateMRF  (edit an existing MRF — field updates)
// ─────────────────────────────────────────────────────────────
function updateMRF(payload) {
  try {
    const m      = payload.mrf || {};
    const sh     = _rcTab(RC_TABS.MRF, RC_MRF_HEADERS);
    const data   = sh.getDataRange().getValues();
    const headers= data[0];
    const idCol  = headers.indexOf('MRF ID');
    const now    = _fmtTimestamp(new Date());

    // Build update map: header → value
    const updates = {
      'Position':     m.position,
      'Department':   m.dept,
      'Site':         m.site,
      'Vacancies':    m.vacancies,
      'Type':         m.type,
      'Replacing':    m.replacing,
      'Required By':  m.requiredBy,
      'Reporting To': m.reportingTo,
      'Skills':       m.skills,
      'Reason':       m.reason,
      'Budget':       m.budget,
      'Updated At':   now,
      'Updated By':   m.updatedBy || '',
    };

    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === m.id) {
        const rowNum = i + 1;
        Object.entries(updates).forEach(([col, val]) => {
          const ci = headers.indexOf(col);
          if (ci >= 0 && val !== undefined) sh.getRange(rowNum, ci+1).setValue(val);
        });
        return { success: true };
      }
    }
    return { success: false, message: 'MRF not found: ' + m.id };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ACTION: getMRFs
//  Returns all MRF rows as JSON array
// ─────────────────────────────────────────────────────────────
function getMRFs(payload) {
  try {
    const sh     = _rcTab(RC_TABS.MRF, RC_MRF_HEADERS);
    const data   = sh.getDataRange().getValues();
    if (data.length <= 1) return { success: true, rows: [] };
    const headers = data[0];
    const rows = data.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = r[i]);
      return obj;
    });
    return { success: true, rows };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ACTION: saveOffer
//  Appends a new offer letter row to Offer_Tracker
// ─────────────────────────────────────────────────────────────
function saveOffer(payload) {
  try {
    const o  = payload.offer || {};
    const sh = _rcTab(RC_TABS.OFFERS, RC_OFFER_HEADERS);
    const now = _fmtTimestamp(new Date());

    // Auto-generate OL ID
    const lastRow = sh.getLastRow();
    const year    = new Date().getFullYear();
    const seq     = String(Math.max(lastRow, 1)).padStart(3, '0');
    const olId    = o.olId || `OL-${year}-${seq}`;

    // Header-aware write: ensure every RC_OFFER_HEADERS column exists in row 1
    // (append any missing — preserves existing columns/order), then write by name.
    let headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
    let added = false;
    RC_OFFER_HEADERS.forEach(h => { if (headers.indexOf(h) === -1) { headers.push(h); added = true; } });
    if (added) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, headers.length)
        .setBackground('#1A6038').setFontColor('#FFFFFF').setFontWeight('bold');
    }

    const vals = {
      'OL ID': olId, 'MRF ID': o.mrfId || '', 'Candidate Name': o.candidateName || '',
      'Position': o.position || '', 'Site': o.site || '', 'CTC (Annual)': o.ctcAnnual || '',
      'Basic': o.basic || '', 'HRA': o.hra || '', 'Allowances': o.allowances || '',
      'PF': o.pf || '', 'Gross': o.gross || '', 'Net': o.net || '',
      'Joining Date': o.joiningDate || '', 'Probation Period': o.probation || '6',
      'Offer Valid Until': o.validUntil || '', 'Candidate Email': o.candidateEmail || '',
      'Dispatch Method': o.dispatchMethod || '', 'Status': 'Sent', 'Sent Date': now,
      'Acceptance Date': '', 'Remarks': '', 'Created By': o.createdBy || '', 'Created At': now,
      'Ref No': o.refNo || '',
      'Offer Date': o.offerDate || '', 'Grade': o.grade || '', 'Department': o.department || '',
      'Address': o.address || '', 'Company': o.company || '',
      'Employee Type': o.empType || '', 'Contractual Period': o.contractPeriod || '',
      'Address Line 1': o.addr1 || '', 'Address Line 2': o.addr2 || '',
      'Address Line 3': o.addr3 || '', 'Address Line 4': o.addr4 || '',
      'Start Time': o.startTime || '', 'End Time': o.endTime || '', 'Notice Period': o.noticePeriod || '',
      'Reporting Manager': o.reportingManager || '',
      'DA': o.da || '', 'Special Allowance': o.specialallow || '', 'Conveyance': o.conveyance || '',
      'Education Allowance': o.education || '', 'Uniform Allowance': o.uniform || '', 'LTA': o.lta || '',
      'Site Allowance': o.siteallow || '', 'Medical': o.medical || '', 'PF Employer': o.pfEmployer || '',
      'CTC (Monthly)': o.ctcMonthly || '',
      'Agreed Salary': o.agreedSalary || '', 'Calculated Salary': o.calculatedSalary || '',
      'Basic Total': o.basicTotal || '', 'HRA Total': o.hraTotal || '',
      'Other Total': o.otherTotal || '', 'Salary JSON': o.salJSON || '',
    };
    const row = headers.map(h => (h in vals) ? vals[h] : '');

    sh.appendRow(row);
    return { success: true, olId };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ACTION: updateOfferStatus
//  Accepted / Declined / Expired
// ─────────────────────────────────────────────────────────────
function updateOfferStatus(payload) {
  try {
    const sh     = _rcTab(RC_TABS.OFFERS, RC_OFFER_HEADERS);

    // Ensure all RC_OFFER_HEADERS exist in row 1 so payload.fields can target new columns
    let headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(),1)).getValues()[0].map(String);
    let added = false;
    RC_OFFER_HEADERS.forEach(h => { if (headers.indexOf(h) === -1) { headers.push(h); added = true; } });
    if (added) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, headers.length).setBackground('#1A6038').setFontColor('#FFFFFF').setFontWeight('bold');
    }

    const data   = sh.getDataRange().getValues();
    const idCol  = headers.indexOf('OL ID');
    const statCol= headers.indexOf('Status');
    const accCol = headers.indexOf('Acceptance Date');
    const now    = _fmtTimestamp(new Date());

    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === payload.olId) {
        if (payload.status) {
          sh.getRange(i+1, statCol+1).setValue(payload.status);
          if (['Accepted','Declined'].includes(payload.status) && accCol >= 0) {
            sh.getRange(i+1, accCol+1).setValue(now);
          }
        }
        // Write any extra fields by header name (e.g. Approved By, Accept By, ...)
        if (payload.fields && typeof payload.fields === 'object') {
          Object.keys(payload.fields).forEach(name => {
            const c = headers.indexOf(name);
            if (c >= 0) sh.getRange(i+1, c+1).setValue(payload.fields[name]);
          });
        }
        return { success: true };
      }
    }
    return { success: false, message: 'OL not found: ' + payload.olId };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ACTION: createJoiningEntry
//  Creates a row in Joining_List (both Path A and Path B)
// ─────────────────────────────────────────────────────────────
function createJoiningEntry(payload) {
  try {
    const j  = payload.joiner || {};
    const sh = _rcTab(RC_TABS.JOINING, RC_JOINING_HEADERS);
    const now = _fmtTimestamp(new Date());

    // Auto-generate Joining Code
    const lastRow = sh.getLastRow();
    const year    = new Date().getFullYear();
    const seq     = String(Math.max(lastRow, 1)).padStart(3, '0');
    const jCode   = j.joiningCode || `JC-${year}-${seq}`;

    const row = [
      jCode,
      j.path          || 'A',  // A or B
      j.mrfId         || '',
      j.olId          || '',
      j.name          || '',
      j.position      || '',
      j.dept          || '',
      j.site          || '',
      j.reportingManager|| '',
      j.expectedDOJ   || '',
      '',                       // Actual DOJ — filled on markAsJoined
      'Pending',               // Status
      '',                       // EmpCode — filled after joining
      '', '',                   // Appointment Letter Ref, Date
      'No',                     // Signed Copy Received
      j.remarks       || '',
      j.createdBy     || '',
      now,
      now,
    ];

    sh.appendRow(row);
    return { success: true, joiningCode: jCode };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ACTION: savePreJoining
//  Upserts a checklist item row in PreJoining_Checklist
// ─────────────────────────────────────────────────────────────
function savePreJoining(payload) {
  try {
    const p  = payload;
    const sh = _rcTab(RC_TABS.PREJOIN, RC_PREJOIN_HEADERS);
    const data   = sh.getDataRange().getValues();
    const headers= data[0];
    const jcCol  = headers.indexOf('Joining Code');
    const idCol  = headers.indexOf('Item ID');
    const now    = _fmtTimestamp(new Date());

    // Try to update existing row
    for (let i = 1; i < data.length; i++) {
      if (data[i][jcCol] === p.joiningCode && data[i][idCol] === p.itemId) {
        sh.getRange(i+1, headers.indexOf('Checked')+1).setValue(p.checked ? 'Yes' : 'No');
        sh.getRange(i+1, headers.indexOf('Checked By')+1).setValue(p.checkedBy || '');
        sh.getRange(i+1, headers.indexOf('Checked At')+1).setValue(p.checked ? now : '');
        sh.getRange(i+1, headers.indexOf('Remarks')+1).setValue(p.remarks || '');
        return { success: true, action: 'updated' };
      }
    }

    // Append new row
    const row = [
      p.joiningCode || '',
      p.mrfId       || '',
      p.candidateName||'',
      p.itemId      || '',
      p.itemLabel   || '',
      p.owner       || '',
      p.checked     ? 'Yes' : 'No',
      p.checkedBy   || '',
      p.checked     ? now : '',
      p.remarks     || '',
    ];
    sh.appendRow(row);
    return { success: true, action: 'appended' };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ACTION: markAsJoined
//  Sets Actual DOJ, status → Joined, returns employee template
// ─────────────────────────────────────────────────────────────
function markAsJoined(payload) {
  try {
    const sh     = _rcTab(RC_TABS.JOINING, RC_JOINING_HEADERS);
    const data   = sh.getDataRange().getValues();
    const headers= data[0];
    const jcCol  = headers.indexOf('Joining Code');
    const now    = _fmtTimestamp(new Date());

    for (let i = 1; i < data.length; i++) {
      if (data[i][jcCol] === payload.joiningCode) {
        sh.getRange(i+1, headers.indexOf('Actual DOJ')+1).setValue(payload.actualDOJ || now);
        sh.getRange(i+1, headers.indexOf('Status')+1).setValue('Joined');
        sh.getRange(i+1, headers.indexOf('Updated At')+1).setValue(now);

        // Return pre-filled employee register template for HR to review
        const template = {
          name:            data[i][headers.indexOf('Candidate Name')],
          designation:     data[i][headers.indexOf('Position')],
          department:      data[i][headers.indexOf('Department')],
          site:            data[i][headers.indexOf('Site')],
          reportingManager:data[i][headers.indexOf('Reporting Manager')],
          doj:             payload.actualDOJ || now,
          joiningCode:     payload.joiningCode,
          path:            data[i][headers.indexOf('Path')],
        };
        return { success: true, employeeTemplate: template };
      }
    }
    return { success: false, message: 'Joining Code not found: ' + payload.joiningCode };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ACTION: assignEmpCode
//  Links EmpCode to Joining_List row and updates status to Active
// ─────────────────────────────────────────────────────────────
function assignEmpCode(payload) {
  try {
    const sh     = _rcTab(RC_TABS.JOINING, RC_JOINING_HEADERS);
    const data   = sh.getDataRange().getValues();
    const headers= data[0];
    const jcCol  = headers.indexOf('Joining Code');
    const now    = _fmtTimestamp(new Date());

    for (let i = 1; i < data.length; i++) {
      if (data[i][jcCol] === payload.joiningCode) {
        sh.getRange(i+1, headers.indexOf('EmpCode')+1).setValue(payload.empCode);
        sh.getRange(i+1, headers.indexOf('Status')+1).setValue('Active');
        sh.getRange(i+1, headers.indexOf('Updated At')+1).setValue(now);
        return { success: true };
      }
    }
    return { success: false, message: 'Joining Code not found' };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ACTION: sendOfferEmail
//  Sends offer letter PDF to candidate via MailApp
//  payload.pdfBase64: base64-encoded PDF blob
//  payload.to:        candidate email
//  payload.olId:      offer letter reference
//  payload.candidateName
// ─────────────────────────────────────────────────────────────
function sendOfferEmail(payload) {
  try {
    if (!payload.to) return { success: false, message: 'No recipient email address' };
    const fname = `OfferLetter_${(payload.candidateName||'Candidate').replace(/\s+/g,'_')}_${payload.olId||''}.pdf`;
    let blob;
    if (payload.html) {
      // Convert the offer-letter HTML to PDF server-side
      blob = Utilities.newBlob(payload.html, 'text/html', fname.replace(/\.pdf$/, '.html'))
        .getAs('application/pdf').setName(fname);
    } else if (payload.pdfBase64) {
      blob = Utilities.newBlob(Utilities.base64Decode(payload.pdfBase64), 'application/pdf', fname);
    } else {
      return { success: false, message: 'No html or pdfBase64 provided' };
    }
    MailApp.sendEmail({
      to:          payload.to,
      subject:     `Offer Letter — ${payload.position || 'Position'} at Evergreen Enterprises`,
      htmlBody:    `<p>Dear ${payload.candidateName || 'Candidate'},</p>
                    <p>Please find attached your offer letter from Evergreen Enterprises (EVGCPL).</p>
                    <p>Kindly sign and return a copy to HR to confirm your acceptance.</p>
                    <p>Regards,<br>HR Team<br>Evergreen Enterprises</p>`,
      attachments: [blob],
    });
    return { success: true };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ACTION: getJoiningListSchema
//  Returns the existing headers from v1_JoiningList so the portal
//  can map fields to the correct columns regardless of order
// ─────────────────────────────────────────────────────────────
function getJoiningListSchema() {
  try {
    const ss = _rcSS();
    const sh = ss.getSheetByName(RC_TABS.JOINING);
    if (!sh || sh.getLastRow() === 0) return { success: true, headers: [], tabName: RC_TABS.JOINING };
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(h => String(h).trim()).filter(Boolean);
    return { success: true, headers, tabName: RC_TABS.JOINING, lastRow: sh.getLastRow() };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ACTION: getJoiningList
//  Returns all rows from v1_JoiningList as JSON — maps to actual headers
// ─────────────────────────────────────────────────────────────
function getJoiningList() {
  try {
    const ss = _rcSS();
    const sh = ss.getSheetByName(RC_TABS.JOINING);
    if (!sh || sh.getLastRow() <= 1) return { success: true, rows: [], headers: [] };
    const data    = sh.getDataRange().getValues();
    const headers = data[0].map(h => String(h).trim());
    const rows    = data.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = r[i]; });
      return obj;
    });
    return { success: true, headers, rows };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ROUTER ENTRIES  —  already wired into Router.gs doPost
// ─────────────────────────────────────────────────────────────
/*
  Registered in Router.gs doPost (if/_wrap style — this project has no switch):

  if (action === 'saveMRF')                  return _wrap(saveMRF(body));
  if (action === 'updateMRF')                return _wrap(updateMRF(body));
  if (action === 'updateMRFStatus')          return _wrap(updateMRFStatus(body));
  if (action === 'getMRFs')                  return _wrap(getMRFs(body));
  if (action === 'saveOffer')                return _wrap(saveOffer(body));
  if (action === 'updateOfferStatus')        return _wrap(updateOfferStatus(body));
  if (action === 'createJoiningEntry')       return _wrap(createJoiningEntry(body));
  if (action === 'getJoiningList')           return _wrap(getJoiningList(body));
  if (action === 'getJoiningListSchema')     return _wrap(getJoiningListSchema());
  if (action === 'savePreJoining')           return _wrap(savePreJoining(body));
  if (action === 'markAsJoined')             return _wrap(markAsJoined(body));
  if (action === 'assignEmpCode')            return _wrap(assignEmpCode(body));
  if (action === 'sendOfferEmail')           return _wrap(sendOfferEmail(body));
  if (action === 'updateApptLetter')         return _wrap(updateApptLetter(body));
*/

// ─────────────────────────────────────────────────────────────
//  ACTION: updateApptLetter
//  Logs appointment letter ref, date, and signed copy status
// ─────────────────────────────────────────────────────────────
function updateApptLetter(payload) {
  try {
    const sh     = _rcTab(RC_TABS.JOINING, RC_JOINING_HEADERS);

    // Header-aware: ensure all RC_JOINING_HEADERS columns exist in row 1
    let headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(),1)).getValues()[0].map(String);
    let added = false;
    RC_JOINING_HEADERS.forEach(h => { if (headers.indexOf(h) === -1) { headers.push(h); added = true; } });
    if (added) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, headers.length).setBackground('#1A6038').setFontColor('#FFFFFF').setFontWeight('bold');
    }

    const data   = sh.getDataRange().getValues();
    const jcCol  = headers.indexOf('Joining Code');
    const now    = _fmtTimestamp(new Date());
    for (let i = 1; i < data.length; i++) {
      if (data[i][jcCol] === payload.joiningCode) {
        const map = {
          'Appointment Letter Ref':  payload.ref,
          'Appointment Letter Date': payload.date,
          'Signed Copy Received':    payload.signed,
          'Updated At':              now,
        };
        if (payload.triggerOnboarding === true) {
          map['Onboarding Triggered At'] = now;
          map['Onboarding Triggered By'] = payload.updatedBy || '';
          map['Onboarding Status']       = 'Pending HR';
        }
        Object.entries(map).forEach(([col, val]) => {
          const ci = headers.indexOf(col);
          if (ci >= 0 && val !== undefined) sh.getRange(i+1, ci+1).setValue(val);
        });
        return { success: true };
      }
    }
    return { success: false, message: 'Joining Code not found' };
  } catch(e) {
    return { success: false, message: e.message };
  }
}
