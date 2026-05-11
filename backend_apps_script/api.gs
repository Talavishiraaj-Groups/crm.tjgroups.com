/**
 * TJGROUPS CRM - Apps Script API Endpoints
 * 
 * Handles all incoming HTTP requests from the React frontend.
 */

function doOptions(e) {
  // CORS Preflight
  return createJsonResponse({ status: 'ok' });
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    const id = e.parameter.id;
    
    if (!action) {
      return createErrorResponse('Missing action parameter');
    }

    let data;
    switch(action) {
      case 'getLeads':
        data = getRecords('Leads');
        break;
      case 'getDeals':
        data = getRecords('Deals');
        break;
      case 'getProjects':
        data = getRecords('Projects');
        break;
      case 'getUsers':
        data = getRecords('Users');
        break;
      case 'getCommissions':
        data = getRecords('Commissions');
        break;
      case 'getAdminRequests':
        data = getRecords('AdminRequests');
        break;
      case 'getLeadById':
        data = getRecordById('Leads', id);
        break;
      case 'getKPIs':
        data = getFinancialKPIs();
        break;
      case 'getLogs':
        data = getLogs(id);
        break;
      default:
        return createErrorResponse('Unknown action: ' + action);
    }

    return createJsonResponse({ status: 'success', data: data });
    
  } catch (error) {
    return createErrorResponse(error.toString());
  }
}

function doPost(e) {
  try {
    // Parse the incoming JSON body
    const requestBody = JSON.parse(e.postData.contents);
    const action = requestBody.action;
    const payload = requestBody.payload;
    
    if (!action) {
      return createErrorResponse('Missing action parameter in payload');
    }

    let result;
    switch(action) {
      case 'createUser':
        result = createRecord('Users', payload);
        break;
      case 'updateUser':
        result = updateRecord('Users', payload.id, payload);
        break;
      case 'createLead':
        result = createRecord('Leads', payload);
        break;
      case 'updateLead':
        result = updateRecord('Leads', payload.id, payload);
        break;
      case 'createDeal':
        result = createRecord('Deals', payload);
        break;
      case 'updateDeal':
        result = updateRecord('Deals', payload.id, payload);
        break;
      case 'createProject':
        result = createRecord('Projects', payload);
        break;
      case 'updateProject':
        result = updateRecord('Projects', payload.id, payload);
        break;
      case 'createAdminRequest':
        result = createRecord('AdminRequests', payload);
        break;
      case 'updateAdminRequest':
        result = updateRecord('AdminRequests', payload.id, payload);
        break;
      case 'createCommission':
        result = createRecord('Commissions', payload);
        break;
      case 'updateCommission':
        result = updateRecord('Commissions', payload.id, payload);
        break;
      case 'createLog':
        payload.Timestamp = new Date().toISOString();
        result = createRecord('Logs', payload);
        break;
      case 'deleteUser':
        result = deleteRecord('Users', payload.id);
        break;
      case 'deleteLead':
        result = deleteRecord('Leads', payload.id);
        break;
      default:
        return createErrorResponse('Unknown action: ' + action);
    }

    return createJsonResponse({ status: 'success', data: result });
    
  } catch (error) {
    return createErrorResponse(error.toString());
  }
}
