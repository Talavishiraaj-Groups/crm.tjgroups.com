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
    headers: { "Authorization": "Zoho-oauthtoken " + resData.access_token }
  });
  var accountsData = JSON.parse(accountsRes.getContentText());
  var zohoEmail = accountsData.data[0].incomingMailAddress;
  
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
  
  // Search messages matching leadEmail
  var searchUrl = "https://mail.zoho.in/api/accounts/" + accountId + "/messages?searchKey=sender:" + leadEmail + " OR recipient:" + leadEmail;
  var searchRes = UrlFetchApp.fetch(searchUrl, {
    headers: { "Authorization": "Zoho-oauthtoken " + accessToken }
  });
  var messageList = JSON.parse(searchRes.getContentText()).data || [];
  
  // Map Zoho messages to UI format
  return messageList.map(function(m) {
    return {
      id: m.messageId,
      subject: m.subject,
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
  
  var refreshToken = getUserRefreshToken(userId);
  if (!refreshToken) throw new Error("User has not linked their Zoho Mail account.");
  
  var accessToken = getZohoAccessToken(refreshToken);
  
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
      toAddress: to,
      subject: subject,
      content: content
    }),
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(sendUrl, sendOptions);
  return JSON.parse(response.getContentText());
}

function triggerAuth() {
  UrlFetchApp.fetch("https://accounts.zoho.in");
}
