/**
 * TJGROUPS CRM - Zoho Mail Integration
 * 
 * Handles Server-based App OAuth flow, Token Refresh, and Mail API fetching/sending.
 */

const ZOHO_CLIENT_ID = "1000.TPZZG4KWERXN232O5CWEUG3G2KMYVX";
const ZOHO_CLIENT_SECRET = "eb477a17163216be3a302c9ef3a5d0680720c0b652";

// 1. Link Zoho User profile
function linkZoho(payload) {
  var userId = payload.id;
  var code = payload.code;
  var redirectUri = payload.redirectUri || "https://crm.tjgroups.com/oauth/callback";
  
  // Exchange code for token
  var tokenUrl = "https://accounts.zoho.in/oauth/v2/token";
  var options = {
    method: "POST",
    payload: {
      code: code,
      client_id: ZOHO_CLIENT_ID,
      client_secret: ZOHO_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    },
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(tokenUrl, options);
  var resData = JSON.parse(response.getContentText());
  
  if (!resData.refresh_token) {
    throw new Error("Failed to exchange Zoho token: " + response.getContentText());
  }
  
  // Get User Account Info (retrieve email address)
  var accountsUrl = "https://mail.zoho.in/api/accounts";
  var accountsRes = UrlFetchApp.fetch(accountsUrl, {
    headers: { "Authorization": "Zoho-oauthtoken " + resData.access_token },
    muteHttpExceptions: true
  });
  var accountsData = JSON.parse(accountsRes.getContentText());
  var acct = accountsData.data && accountsData.data[0] ? accountsData.data[0] : {};
  // Zoho returns email under different field names depending on account type
  var zohoEmail = acct.primaryEmailAddress || acct.incomingMailAddress || acct.mailboxAddress || acct.emailAddress || '';
  
  if (!zohoEmail) {
    throw new Error("Could not retrieve Zoho email address. Raw account data: " + JSON.stringify(acct));
  }
  
  // Save credentials to Users database sheet
  updateRecord('Users', userId, {
    ZohoEmail: zohoEmail,
    ZohoRefreshToken: resData.refresh_token
  });

  return { status: "success", email: zohoEmail };
}

// 2. Unlink Zoho Credentials
function unlinkZoho(payload) {
  var userId = payload.id;
  updateRecord('Users', userId, {
    ZohoEmail: '',
    ZohoRefreshToken: ''
  });
  return { status: "success" };
}

// Helper: Refresh Zoho Access Token
function getZohoAccessToken(refreshToken) {
  var tokenUrl = "https://accounts.zoho.in/oauth/v2/token";
  var options = {
    method: "POST",
    payload: {
      refresh_token: refreshToken,
      client_id: ZOHO_CLIENT_ID,
      client_secret: ZOHO_CLIENT_SECRET,
      grant_type: "refresh_token"
    }
  };
  var response = UrlFetchApp.fetch(tokenUrl, options);
  var data = JSON.parse(response.getContentText());
  return data.access_token;
}

// Helper: Get user's refresh token from sheet
function getUserRefreshToken(userId) {
  var userObj = getRecordById('Users', userId);
  return userObj ? userObj.ZohoRefreshToken : null;
}

// 3. Fetch Zoho Mail Inbox/Sent conversations
function getZohoEmails(params) {
  var leadEmail = params.leadEmail;
  var userId = params.userId;
  
  var refreshToken = getUserRefreshToken(userId);
  if (!refreshToken) return [];
  
  var accessToken = getZohoAccessToken(refreshToken);
  
  // Get Account ID
  var accountsUrl = "https://mail.zoho.in/api/accounts";
  var accountsRes = UrlFetchApp.fetch(accountsUrl, {
    headers: { "Authorization": "Zoho-oauthtoken " + accessToken }
  });
  var accountId = JSON.parse(accountsRes.getContentText()).data[0].accountId;
  
  // 1. Fetch Sent emails (to the lead)
  var sentUrl = "https://mail.zoho.in/api/accounts/" + accountId + "/messages/search?searchKey=" + encodeURIComponent("to:" + leadEmail);
  var sentRes = UrlFetchApp.fetch(sentUrl, {
    headers: { "Authorization": "Zoho-oauthtoken " + accessToken },
    muteHttpExceptions: true
  });
  var sentData = JSON.parse(sentRes.getContentText()).data || [];
  
  // 2. Fetch Received emails (from the lead)
  var inboxUrl = "https://mail.zoho.in/api/accounts/" + accountId + "/messages/search?searchKey=" + encodeURIComponent("sender:" + leadEmail);
  var inboxRes = UrlFetchApp.fetch(inboxUrl, {
    headers: { "Authorization": "Zoho-oauthtoken " + accessToken },
    muteHttpExceptions: true
  });
  var inboxData = JSON.parse(inboxRes.getContentText()).data || [];
  
  // Merge and deduplicate by messageId
  var allMessages = sentData.concat(inboxData);
  var uniqueMessages = [];
  var seenIds = {};
  
  for (var i = 0; i < allMessages.length; i++) {
    var msg = allMessages[i];
    if (msg && msg.messageId && !seenIds[msg.messageId]) {
      seenIds[msg.messageId] = true;
      uniqueMessages.push(msg);
    }
  }
  
  // Sort chronologically by receivedTime ascending
  uniqueMessages.sort(function(a, b) {
    return Number(a.receivedTime) - Number(b.receivedTime);
  });
  
  // Map Zoho messages to UI format
  return uniqueMessages.map(function(m) {
    return {
      id: m.messageId,
      subject: m.subject || "(No Subject)",
      content: m.summary || "No preview summary",
      direction: m.sender.indexOf(leadEmail) !== -1 ? "in" : "out",
      timestamp: new Date(Number(m.receivedTime)).toISOString()
    };
  });
}

// 4. Send Email via Zoho Mail
function sendZohoEmail(payload) {
  var userId = payload.userId;
  var to = payload.to;
  var subject = payload.subject;
  var content = payload.content;
  
  var userObj = getRecordById('Users', userId);
  if (!userObj || !userObj.ZohoRefreshToken) {
    throw new Error("User has not linked their Zoho Mail account. No refresh token found.");
  }
  
  var accessToken = getZohoAccessToken(userObj.ZohoRefreshToken);
  
  // If ZohoEmail is missing from the sheet, fetch it dynamically and save it
  var fromAddress = userObj.ZohoEmail;
  if (!fromAddress) {
    var acctUrl = "https://mail.zoho.in/api/accounts";
    var acctRes = UrlFetchApp.fetch(acctUrl, {
      headers: { "Authorization": "Zoho-oauthtoken " + accessToken },
      muteHttpExceptions: true
    });
    var acctData = JSON.parse(acctRes.getContentText());
    var acct = acctData.data && acctData.data[0] ? acctData.data[0] : {};
    fromAddress = acct.primaryEmailAddress || acct.incomingMailAddress || acct.mailboxAddress || acct.emailAddress || '';
    
    if (!fromAddress) {
      throw new Error("Could not determine Zoho email address. Raw: " + JSON.stringify(acct));
    }
    
    // Save it to the sheet so next time we don't need to fetch
    updateRecord('Users', userId, { ZohoEmail: fromAddress });
  }
  
  // Get Account ID
  var accountsUrl = "https://mail.zoho.in/api/accounts";
  var accountsRes = UrlFetchApp.fetch(accountsUrl, {
    headers: { "Authorization": "Zoho-oauthtoken " + accessToken }
  });
  var accountId = JSON.parse(accountsRes.getContentText()).data[0].accountId;
  
  // Send message
  var sendUrl = "https://mail.zoho.in/api/accounts/" + accountId + "/messages";
  var sendOptions = {
    method: "POST",
    contentType: "application/json",
    headers: { "Authorization": "Zoho-oauthtoken " + accessToken },
    payload: JSON.stringify({
      fromAddress: fromAddress,
      toAddress: to,
      subject: subject,
      content: content,
      mailFormat: "html"
    }),
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(sendUrl, sendOptions);
  var resJSON = JSON.parse(response.getContentText());
  
  // Check if delivery was successful
  if (resJSON.status && resJSON.status.code !== 200) {
    throw new Error("Zoho API Error: " + resJSON.status.description);
  }
  
  return resJSON;
}

function triggerAuth() {
  UrlFetchApp.fetch("https://accounts.zoho.in");
}
