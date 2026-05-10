# TJGROUPS CRM - Manual Verification & RBAC Guide

This document outlines the credentials and steps for manually verifying the **TJGROUPS CRM** system and its Role-Based Access Control (RBAC).

## 🔑 Live User Credentials

The system fetches users dynamically from the `Users` sheet in Google Sheets. You can use the following "Seeded" users for testing:

| Username | Role | Team | Access Level |
| :--- | :--- | :--- | :--- |
| **super_admin** | `SUPER_ADMIN` | Management | Full system control, financial reports, user management. |
| **admin_alpha** | `ADMIN` | Alpha | Team-level management, view and edit leads/deals within team. |
| **sales_rep_1** | `SALES_REP` | Alpha | Individual access, manage own leads and deals only. |
| **sales_rep_2** | `SALES_REP` | Beta | Individual access, manage own leads and deals only. |

> [!NOTE]
> All users currently log in via the dynamic buttons on the login page. This bypasses password entry for development speed while ensuring the correct `user.id` and `role` are stored in the session.

## 🏗️ Role Explanations

### 1. Super Administrator (`SUPER_ADMIN`)
- **Purpose**: Global oversight and configuration.
- **Permissions**:
  - Full access to all modules (Dashboard, Leads, Deals, Projects, Finance, Admin).
  - Can create, edit, and deactivate any record.
  - Can manage system users, invite new ones, and reset passwords.
  - Exclusive access to the **Finance** page for commission processing.

### 2. Administrator / Team Lead (`ADMIN`)
- **Purpose**: Managing a specific team of sales representatives.
- **Permissions**:
  - Access to Dashboard, Leads, Deals, Projects, and Payments.
  - Can view and edit all records belonging to their **Team**.
  - Can approve operational requests for payment or paperwork.
  - **No access** to the Finance (Commission Ledger) page.

### 3. Sales Representative (`SALES_REP`)
- **Purpose**: Individual lead generation and deal closing.
- **Permissions**:
  - Restricted Dashboard view (only own metrics).
  - Can only see and manage leads/deals where they are the **Owner**.
  - Can request payments and paperwork via the Payments module.
  - Access to the **Projects** module to track delivery for won deals.
  - **No access** to Finance or Admin pages.

## 🧪 Testing Workflows

### A. Dynamic User Creation & Deactivation (E2E)
1. Login as `super_admin`.
2. Go to **Admin** → **INVITE USER**.
3. Create a new rep (e.g., "Testing Rep").
4. Logout and verify the new button appears on the login screen.
5. Login back as `super_admin`, go to **Admin**, and click the Three-Dot menu on "Testing Rep".
6. Click **DEACTIVATE**. Verify the user can no longer log in.

### B. Lead-to-Deal Conversion & LinkedIn Tracking
1. Login as a `SALES_REP`.
2. Go to **Leads** → **NEW LEAD**.
3. Create a lead and ensure the **LinkedIn Profile** URL is added.
4. Log an interaction (Call/WhatsApp) in the Detail View.
5. Click **CONVERT TO DEAL**. Verify the lead is archived and a new deal appears in the pipeline.

### C. Financial Processing & Commission Splits
1. Login as `SALES_REP` or `ADMIN`.
2. Find an active Deal and click **WON**.
3. Verify the modal appears asking for **Setter Commission** and **Closer Commission**.
4. Enter values and submit.
5. Login as `super_admin` and go to **Finance**.
6. Verify the new commission entry appears in the Ledger with the correct amounts.
7. Click **PROCESS** to verify the payout status updates to "Paid".

---

## 🛠️ Infrastructure Verification

- **API URL**: Ensure `.env` has the correct `VITE_API_URL`.
- **Backend**: The `api.gs` script must be deployed as a "Web App" accessible to "Anyone".
- **Database**: Ensure the Google Sheet tabs match the `DATABASE_SCHEMA` in `setup.gs`, including the new columns for `linkedin`, `amId`, `liaisonId`, and `status`.
