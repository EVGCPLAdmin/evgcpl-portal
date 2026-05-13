/**
 * Employee Profile Handlers
 * Handles data retrieval for the HR User Profile view.
 */

function getEmployeeList(e) {
  const userRole = getUserRole(e);
  if (!['hr', 'md'].includes(userRole)) {
    return _err("Unauthorized: HR or MD access required");
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("users");
    const data = sheet.getDataRange().getValues();
    const header = data[0];

    const idIdx = header.indexOf("Employee ID");
    const nameIdx = header.indexOf("Full Name");
    const statusIdx = header.indexOf("Status");

    if (idIdx === -1 || nameIdx === -1) throw new Error("User sheet columns not found");

    const employees = data.slice(1)
      .filter(row => row[statusIdx] === "ACTIVE")
      .map(row => ({
        id: row[idIdx],
        name: row[nameIdx]
      }));

    return _ok(employees);
  } catch (err) {
    return _err("Error fetching employee list: " + err.message);
  }
}

function getUserProfileDetails(e) {
  const userRole = getUserRole(e);
  if (!['hr', 'md'].includes(userRole)) {
    return _err("Unauthorized: HR or MD access required");
  }

  const empId = e.parameter.empId || (e.postData && JSON.parse(e.postData.contents).empId);
  if (!empId) return _err("Employee ID is required");

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Personal Details
    const userSheet = ss.getSheetByName("users");
    const userData = userSheet.getDataRange().getValues();
    const userHeader = userData[0];
    const userRow = userData.find(row => row[userHeader.indexOf("Employee ID")] == empId);

    if (!userRow) return _err("Employee not found");

    const profile = {
      personal: {},
      bank: {},
      salary: [],
      pl: {},
      site: {}
    };

    userHeader.forEach((col, idx) => {
      profile.personal[col] = userRow[idx];
    });

    // 2. Bank Details
    const bankSheet = ss.getSheetByName("bank_details");
    if (bankSheet) {
      const bankData = bankSheet.getDataRange().getValues();
      const bankHeader = bankData[0];
      const bankRow = bankData.find(row => row[bankHeader.indexOf("Employee ID")] == empId);
      if (bankRow) {
        bankHeader.forEach((col, idx) => {
          profile.bank[col] = bankRow[idx];
        });
      }
    }

    // 3. Salary Breakup
    const salarySheet = ss.getSheetByName("salary_breakup");
    if (salarySheet) {
      const salaryData = salarySheet.getDataRange().getValues();
      const salHeader = salaryData[0];
      const salRow = salaryData.find(row => row[salHeader.indexOf("Employee ID")] == empId);
      if (salRow) {
        // Extract only components (everything except ID)
        salHeader.forEach((col, idx) => {
          if (col !== "Employee ID") {
            profile.salary.push({ component: col, value: salRow[idx] });
          }
        });
      }
    }

    // 4. PL Details
    const plSheet = ss.getSheetByName("pl_tracking");
    if (plSheet) {
      const plData = plSheet.getDataRange().getValues();
      const plHeader = plData[0];
      const plRow = plData.find(row => row[plHeader.indexOf("Employee ID")] == empId);
      if (plRow) {
        plHeader.forEach((col, idx) => {
          profile.pl[col] = plRow[idx];
        });
      }
    }

    // 5. Site Information
    const siteSheet = ss.getSheetByName("site_allocation");
    if (siteSheet) {
      const siteData = siteSheet.getDataRange().getValues();
      const siteHeader = siteData[0];
      const siteRow = siteData.find(row => row[siteHeader.indexOf("Employee ID")] == empId);
      if (siteRow) {
        siteHeader.forEach((col, idx) => {
          profile.site[col] = siteRow[idx];
        });
      }
    }

    return _ok(profile);
  } catch (err) {
    return _err("Error fetching profile details: " + err.message);
  }
}

/**
 * Helper to get the role of the user making the request.
 * Assumes a users sheet exists with "Email" and "Role" columns.
 */
function getUserRole(e) {
  const email = e.user.getEmail();
  if (!email) return 'guest';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("users");
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const emailIdx = header.indexOf("Email");
  const roleIdx = header.indexOf("Role");

  const userRow = data.find(row => row[emailIdx] === email);
  return userRow ? userRow[roleIdx] : 'guest';
}
