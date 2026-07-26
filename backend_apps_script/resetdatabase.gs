/**
 * DANGER: This will wipe all CRM data except for the current Users.
 */
function resetDatabase() {
  // Is system mein har table ek alag spreadsheet file hai
  const sheetsToClear = ['Leads', 'Deals', 'Projects', 'Commissions', 'Logs', 'AdminRequests'];
  
  sheetsToClear.forEach(sheetName => {
    try {
      const sheet = getSheetByName(sheetName); // Aapka existing helper use kar rahe hain
      if (sheet && sheet.getLastRow() > 1) {
        // Clear everything from row 2 onwards
        sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
        Logger.log("Successfully Cleared: " + sheetName);
      }
    } catch (e) {
      Logger.log("Skipped or Error in " + sheetName + ": " + e.message);
    }
  });
  
  Logger.log("Database Reset Complete! System is now clean.");
}
