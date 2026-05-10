/**
 * TJGROUPS CRM - Apps Script Backend Setup
 * 
 * Run the setupCRMDatabase() function ONCE from the Apps Script editor to 
 * generate the necessary folder structure and Google Sheets.
 */

// Pull the Main Drive Folder ID from Script Properties (Settings > Script Properties)
// This avoids hardcoding sensitive Drive IDs in the source code.
const MAIN_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('MAIN_FOLDER_ID');

// Define the core tables and their headers
const DATABASE_SCHEMA = {
  'Users': ['ID', 'Username', 'Role', 'Team', 'Status', 'Availability', 'CreatedAt', 'UpdatedAt'],
  'Leads': ['ID', 'Name', 'Email', 'Phone', 'Status', 'OwnerRepId', 'SetterId', 'CloserId', 'Notes', 'Linkedin', 'CreatedAt', 'UpdatedAt'],
  'Deals': ['ID', 'LeadId', 'Value', 'Status', 'OwnerRepId', 'SetterId', 'CloserId', 'CreatedAt', 'UpdatedAt'],
  'Projects': ['ID', 'ClientName', 'Status', 'OwnerRepId', 'AccountManagerId', 'LiaisonId', 'StartDate', 'DueDate', 'CreatedAt', 'UpdatedAt'],
  'AdminRequests': ['ID', 'Type', 'RelatedDealId', 'RequestedBy', 'Status', 'CreatedAt', 'UpdatedAt'],
  'Commissions': ['ID', 'DealId', 'SetterId', 'SetterAmount', 'CloserId', 'CloserAmount', 'PayoutStatus', 'CreatedAt', 'UpdatedAt'],
  'Logs': ['ID', 'EntityId', 'EntityType', 'Action', 'UserId', 'Details', 'Metadata', 'Timestamp']
};

function setupCRMDatabase() {
  try {
    if (!MAIN_FOLDER_ID) {
      throw new Error('MAIN_FOLDER_ID is not set. Please add it in Project Settings > Script Properties.');
    }
    const mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);
    
    // 1. Create Subfolders
    const dbFolder = getOrCreateSubFolder(mainFolder, 'Databases');
    const uploadsFolder = getOrCreateSubFolder(mainFolder, 'Uploads_Paperwork');
    const exportsFolder = getOrCreateSubFolder(mainFolder, 'Exports_Reports');

    Logger.log('Folders verified/created successfully.');

    // 2. Create Spreadsheets for each Schema entity
    for (const [sheetName, headers] of Object.entries(DATABASE_SCHEMA)) {
      getOrCreateSpreadsheet(dbFolder, sheetName, headers);
    }
    
    Logger.log('CRM Setup Complete. All databases are ready.');
    
    // Save the DB folder ID to script properties so the API can find it later
    PropertiesService.getScriptProperties().setProperty('DB_FOLDER_ID', dbFolder.getId());

    refreshDatabaseHeaders(); // Automatically sync headers
  } catch (error) {
    Logger.log('Setup Error: ' + error.toString());
  }
}

/**
 * Syncs the headers of existing sheets with the DATABASE_SCHEMA.
 * Call this after updating DATABASE_SCHEMA to add new columns.
 */
function refreshDatabaseHeaders() {
  const dbFolderId = PropertiesService.getScriptProperties().getProperty('DB_FOLDER_ID');
  if (!dbFolderId) return;
  
  const folder = DriveApp.getFolderById(dbFolderId);
  
  for (const [sheetName, expectedHeaders] of Object.entries(DATABASE_SCHEMA)) {
    const files = folder.getFilesByName(sheetName);
    if (files.hasNext()) {
      const ss = SpreadsheetApp.openById(files.next().getId());
      const sheet = ss.getActiveSheet();
      const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      
      // Find missing headers
      const missingHeaders = expectedHeaders.filter(h => !currentHeaders.includes(h));
      
      if (missingHeaders.length > 0) {
        const startCol = currentHeaders.length + 1;
        sheet.getRange(1, startCol, 1, missingHeaders.length).setValues([missingHeaders]);
        sheet.getRange(1, startCol, 1, missingHeaders.length).setFontWeight("bold");
        Logger.log(`Added missing columns to ${sheetName}: ${missingHeaders.join(', ')}`);
      }
    }
  }
}

/** Helper: Gets a folder by name or creates it if it doesn't exist */
function getOrCreateSubFolder(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(folderName);
}

/** Helper: Creates a new Google Sheet with headers if it doesn't exist */
function getOrCreateSpreadsheet(parentFolder, fileName, headers) {
  const files = parentFolder.getFilesByName(fileName);
  
  if (files.hasNext()) {
    Logger.log(`Spreadsheet ${fileName} already exists.`);
    return files.next();
  }
  
  // Create a new spreadsheet
  const newSpreadsheet = SpreadsheetApp.create(fileName);
  const sheet = newSpreadsheet.getActiveSheet();
  sheet.setName(fileName); // Rename Sheet1 to the entity name
  
  // Set headers
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
  
  // Move it to the correct folder
  const file = DriveApp.getFileById(newSpreadsheet.getId());
  file.moveTo(parentFolder);
  
  Logger.log(`Created new spreadsheet: ${fileName}`);
  return file;
}
