# TJGROUPS CRM Backend Deployment Guide

This document explains how to deploy the Google Apps Script backend that powers the TJGROUPS CRM. The backend uses Google Drive and Google Sheets as its primary database.

## 1. Setup the Google Apps Script Project
1. Navigate to [script.google.com](https://script.google.com/).
2. Click **New Project** and name it "TJGROUPS CRM Backend".
3. In the left-hand sidebar, create four script files matching the ones found in `/backend_apps_script`:
   - `setup.gs`
   - `api.gs`
   - `controllers.gs`
   - `utils.gs`
4. Copy the contents from your local files into the respective Apps Script files.
5. **Delete the default `Code.gs` file** to prevent conflicts.

## 2. Configure Environment Secrets
We use Google Apps Script's `PropertiesService` to securely store environment variables. This prevents hardcoding sensitive IDs directly in the source code.

1. In the Apps Script editor, click the **Project Settings** (gear icon ⚙️) on the left sidebar.
2. Scroll to the bottom to the **Script Properties** section.
3. Click **Add script property**.
4. Set the **Property** to: `MAIN_FOLDER_ID`
5. Set the **Value** to your target Google Drive Folder ID (e.g., `1RSlT9bTnVMN1x5ngOQv3cV1z9NQJYDke`).
6. Click **Save script properties**.

## 3. Initialize the Database Structure
1. Open the `setup.gs` file in the Apps Script editor.
2. In the top toolbar, ensure the function `setupCRMDatabase` is selected in the dropdown menu.
3. Click the **Run** button.
4. **Authorization:** Google will ask you to authorize the script. This is required so the script can create folders and files on your behalf.
   - Click "Review permissions".
   - Select your Google Account.
   - Click "Advanced" -> "Go to TJGROUPS CRM Backend (unsafe)".
   - Click "Allow".
5. **Result:** The script will automatically connect to your `MAIN_FOLDER_ID`, generate the `Databases` subfolder, and scaffold all the required Google Sheets (`Users`, `Leads`, `Deals`, etc.) with proper headers.

## 4. Deploy the REST API (Web App)
For the React frontend to communicate with this backend, you must deploy the script as a Web App.

1. Click the blue **Deploy** button in the top right corner.
2. Select **New deployment**.
3. Click the gear icon next to "Select type" and choose **Web app**.
4. Configure the settings:
   - **Description:** `Initial Deployment v1`
   - **Execute as:** `Me` (This ensures the script has permission to write to your Drive).
   - **Who has access:** `Anyone` (Required for the external React app to POST/GET data without requiring Google Sign-In on the frontend API calls).
5. Click **Deploy**.
6. **Important:** Copy the **Web App URL** provided at the end of this process.

## 5. Connect the Frontend
Finally, connect your React app to the newly deployed backend:
1. Open the `.env` file in the root of the React project (create one if it doesn't exist).
2. Add your Web App URL:
   ```env
   VITE_API_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
   ```
3. Restart your local React development server.
