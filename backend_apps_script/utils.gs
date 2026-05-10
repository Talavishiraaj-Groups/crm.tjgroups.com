/**
 * TJGROUPS CRM - Utilities
 * 
 * Helper functions for API formatting and data manipulation.
 */

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function createErrorResponse(message) {
  return createJsonResponse({
    status: 'error',
    message: message
  });
}


