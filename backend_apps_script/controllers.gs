/**
 * TJGROPS CRM - Database Controllers
 * 
 * Handles CRUD operations interacting with Google Sheets.
 */

function getSheetByName(sheetName) {
  const dbFolderId = PropertiesService.getScriptProperties().getProperty('DB_FOLDER_ID');
  if (!dbFolderId) throw new Error('Database not initialized. Run setupCRMDatabase first.');
  
  const folder = DriveApp.getFolderById(dbFolderId);
  const files = folder.getFilesByName(sheetName);
  
  if (!files.hasNext()) throw new Error(`Database sheet ${sheetName} not found.`);
  
  return SpreadsheetApp.openById(files.next().getId()).getActiveSheet();
}

function getRecords(sheetName) {
  const sheet = getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  
  if (data.length <= 1) return []; // Only headers or empty
  
  const headers = data[0];
  const rows = data.slice(1);
  
  return rows.map(row => {
    let obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });
}

function getRecordById(sheetName, id) {
  const records = getRecords(sheetName);
  return records.find(record => record.ID === id) || null;
}

function createRecord(sheetName, payload) {
  const sheet = getSheetByName(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  // Generate ID and Timestamps
  payload.ID = generateUUID();
  payload.CreatedAt = new Date().toISOString();
  payload.UpdatedAt = payload.CreatedAt;
  
  const newRow = headers.map(header => payload[header] !== undefined ? payload[header] : '');
  
  sheet.appendRow(newRow);
  
  return payload;
}

function updateRecord(sheetName, id, payload) {
  const sheet = getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) { // Assuming ID is always the first column
      rowIndex = i + 1; // +1 because sheets are 1-indexed
      break;
    }
  }
  
  if (rowIndex === -1) throw new Error(`Record with ID ${id} not found in ${sheetName}.`);
  
  payload.UpdatedAt = new Date().toISOString();
  
  // Update only provided fields
  headers.forEach((header, colIndex) => {
    if (payload[header] !== undefined && header !== 'ID' && header !== 'CreatedAt') {
      sheet.getRange(rowIndex, colIndex + 1).setValue(payload[header]);
    }
  });
  
  return getRecordById(sheetName, id);
}

function getFinancialKPIs() {
  const deals = getRecords('Deals');
  const commissions = getRecords('Commissions');
  const requests = getRecords('AdminRequests');
  
  const totalValue = deals.reduce((sum, deal) => sum + Number(deal.Value || 0), 0);
  const totalCommissions = commissions.reduce((sum, comm) => sum + Number(comm.SetterAmount || 0) + Number(comm.CloserAmount || 0), 0);
  
  const paymentRequests = requests.filter(r => r.Type === 'payment');
  const payoutsPending = paymentRequests.filter(r => r.Status === 'Pending').length * 1000; // Placeholder logic
  const payoutsPaid = paymentRequests.filter(r => r.Status === 'Approved').length * 1000; // Placeholder logic
  
  return {
    totalValue,
    totalCommissions,
    payoutsPending,
    payoutsPaid
  };
}

function getLogs(entityId) {
  const allLogs = getRecords('Logs');
  return allLogs
    .filter(log => log.EntityId === entityId)
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
}

function generateUUID() {
  return Utilities.getUuid();
}
