# TJGROUPS CRM System Architecture

This document provides a high-level overview of the architectural design of the TJGROUPS CRM.

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

### Data Aggregation & Business Logic
- **Backend KPIs:** Financial KPIs and pipeline metrics are aggregated on the server-side (`controllers.gs`) to ensure the frontend remains performant and free of complex calculation logic.
- **Commission Split:** The system implements a 2-tier commission model. When a Deal is won, the frontend triggers a modal requiring explicit entry of **Setter** (Lead Generator) and **Closer** (Deal Negotiator) payout amounts, which are then persisted to the `Commissions` sheet.
- **Account Deactivation:** To maintain data integrity and historical record accuracy, users are never "deleted". Instead, the `status` column in the `Users` sheet is toggled to `DEACTIVATED`, which prevents the user from appearing in the login list or authenticated sessions.

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

## 3. Data Flow Example (Winning a Deal)
1. **User Action:** A Sales Rep or Admin clicks the **WON** button on a Deal card.
2. **Modal Entry:** A modal appears requesting the commission amounts for the Setter and Closer.
3. **HTTP POST:** The frontend sends the deal status update and the commission payload to the GAS backend.
4. **API Router:** `api.gs` receives the request and forwards it to the `updateRecord` and `createRecord` functions in `controllers.gs`.
5. **Database Sync:** The `Deals` sheet is updated to `Closed Won`, and new entries are appended to the `Commissions` sheet.
6. **Response:** The frontend receives a success confirmation and re-fetches the pipeline to reflect the updated metrics.
