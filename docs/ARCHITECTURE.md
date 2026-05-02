# TJGROPS CRM System Architecture

This document provides a high-level overview of the architectural design of the TJGROPS CRM.

## Overview
The CRM is designed as a serverless Single Page Application (SPA). 
- **Frontend:** React + TypeScript (Vite), styled with Tailwind CSS (v3).
- **Backend:** Google Apps Script (GAS) exposing a REST API.
- **Database:** Google Drive (Folder hierarchy) & Google Sheets (Relational tables).

---

## 1. Frontend Architecture

### Core Technologies
- **Framework:** React 18
- **Build Tool:** Vite
- **Styling:** Tailwind CSS (Strictly monochromatic: `#161616` and `#DFDFDF`)
- **Icons:** `lucide-react`
- **Routing:** `react-router-dom`

### State Management & Context
- `AuthContext.tsx`: Manages the current user's session and Role-Based Access Control (RBAC). It provides the `user` object and `role` to all child components.
- State is generally kept local to the specific pages (e.g., `LeadsPage.tsx` manages the `leads` list).

### Security (RBAC)
- **Dynamic Login:** The login system is fully data-driven. Upon loading the Login screen, the app fetches all active users from the backend `Users` sheet. Selecting a user initializes the `AuthContext` session.
- **Session Persistence:** The `user.id` is stored in `localStorage`, and the session is restored on page refresh by re-fetching the user's data from the API.
- **Route Protection:** Routes are protected by a `<ProtectedRoute>` wrapper that enforces role hierarchy:
1. `SUPER_ADMIN`: Full access to all modules, including Finance and System Administration.
2. `ADMIN`: Team management access; can view team leads and availability.
3. `SALES_REP`: Restricted view; can only access leads and deals assigned directly to them.

### Data Aggregation
- **Backend KPIs:** Financial KPIs and pipeline metrics are aggregated on the server-side (`controllers.gs`) to ensure the frontend remains performant and free of complex calculation logic.

---

## 2. Backend Architecture (Google Apps Script)

### Design Philosophy
Because the CRM requires simple, low-cost persistence with easy exportability, Google Sheets is used as the primary database, orchestrated by Google Apps Script.

### File Structure (`/backend_apps_script/`)
- `setup.gs`: Initialization script. Connects to the root Drive folder, creates sub-directories (`Databases`, `Uploads`), and scaffolds the Google Sheets with proper headers.
- `api.gs`: The HTTP entry point. Handles `doGet` and `doPost` requests from the React application and routes them to the appropriate controller.
- `controllers.gs`: Database logic. Handles reading from and writing to specific Google Sheets.
- `utils.gs`: Shared helper functions (JSON formatting, UUID generation).

### Security & Credentials
- **No Hardcoded Keys:** The root Google Drive Folder ID is stored securely in the Google Apps Script **Project Properties** (`MAIN_FOLDER_ID`).
- **Frontend Protection:** The deployment URL for the Apps Script Web App is stored in the frontend `.env` file as `VITE_API_URL` and is never committed to version control.

---

## 3. Data Flow Example (Creating a Lead)
1. **User Action:** A Sales Rep fills out the "New Lead" form in the React frontend.
2. **Frontend Service:** The `api.leads.create()` function is called in `src/api/services.ts`.
3. **HTTP POST:** The frontend sends a JSON payload to the `VITE_API_URL` (Apps Script Web App).
4. **API Router:** `api.gs` receives the `doPost` request, parses the JSON, reads the `action: 'createLead'`, and forwards the payload to `createRecord` in `controllers.gs`.
5. **Database Write:** `controllers.gs` finds the `Leads` Google Sheet, generates a UUID and Timestamp, maps the payload to the correct columns, and uses `sheet.appendRow()` to write the data.
6. **Response:** A success JSON response is sent back to the React app, which updates the UI to reflect the new lead.
