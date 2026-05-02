# TJGROPS CRM Platform

> **Enterprise-grade Sales & Delivery Management System**  
> Built for the TJGROPS team to manage leads, deals, payments, projects, commissions, and user access — all from a single, role-aware interface.

---

## Overview

TJGROPS CRM is a production-grade internal platform built with **React + TypeScript + Vite**, backed by a **Google Apps Script** API connected to **Google Sheets** as the database. It enforces **Role-Based Access Control (RBAC)** to ensure each team member sees only what they are authorized to access.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| Styling | Vanilla CSS + Tailwind Utilities |
| Routing | React Router v6 |
| Icons | Lucide React |
| Backend / API | Google Apps Script (GAS) |
| Database | Google Sheets |
| Auth | Session-based (username + password via GAS) |
| Hosting | GitHub / Static Deploy |

---

## Role-Based Access Control

The system enforces three distinct permission levels:

| Role | Access |
|---|---|
| `SUPER_ADMIN` | All modules: Dashboard, Leads, Deals, Projects, Payments, Team, **Finance**, **Admin**, Guide |
| `ADMIN` | Dashboard, Leads, Deals, Projects, Payments, **Team**, Guide |
| `SALES_REP` | Dashboard, **My** Leads, **My** Deals, Projects, Payments, Guide |

---

## Modules

### Dashboard
Real-time KPI cards (Total Leads, Active Deals, Revenue, Open Projects). Quick-access to recent leads and activity feed.

### Leads
Full lead lifecycle management — create, search, filter, convert to deal. Detailed view with interaction logging (call, email, SMS) and guidance notes from team leads.

### Deals
Kanban-style deal pipeline tracking from Discovery → Proposal → Negotiation → Closed Won/Lost. Add new deals, update stage and status, view deal value.

### Projects
Track client delivery and onboarding post-close. Supports both Kanban Board and Table views. Status progresses from Onboarding → In Progress → Completed.

### Payments
Submit and manage Payment & Paperwork requests. Admins can view full request details and approve directly from a modal. Status transitions: Pending → Approved.

### Team *(Admin & Super Admin)*
Real-time team capacity board showing each member's availability (Available / Busy / Offline), open leads, open deals, and daily interactions. Admins can edit user profiles and reset passwords via the Three-Dot menu.

### Finance *(Super Admin only)*
Global commission tracking. Automatically calculates setter/closer split commissions. Super Admin can process payouts and mark commissions as Paid.

### Admin *(Super Admin only)*
User management hub. Invite new users, assign roles and team assignments, set passwords, edit existing users, and deactivate accounts.

### Guide *(All roles)*
A comprehensive, role-tailored training manual. Each user sees a playbook specific to their permission level — covering every CRM module end-to-end.

---

## Project Structure

```
tj_crm/
├── backend_apps_script/    # Google Apps Script backend (deploy separately)
│   ├── api.gs              # HTTP request handler & routing
│   ├── controllers.gs      # Business logic per entity
│   ├── utils.gs            # Shared helpers
│   └── setup.gs            # Sheet initialization script
├── docs/                   # Architecture & deployment documentation
├── public/                 # Static assets (favicon, icons)
├── src/
│   ├── api/
│   │   └── services.ts     # All API calls to the GAS backend
│   ├── components/
│   │   ├── layout/         # AppShell, Sidebar, TopBar
│   │   └── ui/             # Reusable DataGrid, KanbanBoard, StatCard
│   ├── context/
│   │   └── AuthContext.tsx # Global auth state & RBAC
│   ├── pages/              # One file per CRM module
│   ├── types/              # Shared TypeScript interfaces
│   └── utils/              # Badge helpers, formatters
├── index.html              # Entry point with SEO & favicon
└── vite.config.ts
```

---

## Getting Started

### Prerequisites
- Node.js ≥ 18
- A deployed Google Apps Script backend (see `docs/BACKEND_DEPLOYMENT.md`)

### Installation

```bash
# Clone the repository
git clone https://github.com/Talavishiraaj-Groups/crm.tjgroups.com.git
cd crm.tjgroups.com

# Install dependencies
npm install
```

### Environment Configuration

Create a `.env` file in the project root:

```env
VITE_API_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

### Running Locally

```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

### Building for Production

```bash
npm run build
```

Output will be in the `/dist` directory, ready for any static host.

---

## Backend Deployment

The Google Apps Script backend must be deployed separately as a Web App.

Refer to [`docs/BACKEND_DEPLOYMENT.md`](./docs/BACKEND_DEPLOYMENT.md) for step-by-step instructions on:
- Setting up the Google Sheets database schema
- Deploying the Apps Script as a public Web App
- Configuring CORS and API routing

---

## Google Sheets Schema

The backend expects the following sheets with exact column names:

| Sheet | Required Columns |
|---|---|
| `Users` | `id`, `username`, `password`, `role`, `team`, `availability` |
| `Leads` | `id`, `name`, `phone`, `email`, `status`, `assignedTo`, `budget`, `source`, `notes` |
| `Deals` | `id`, `leadId`, `name`, `value`, `stage`, `status`, `assignedTo`, `closerId` |
| `Projects` | `id`, `dealId`, `clientName`, `status`, `assignedTo`, `startDate`, `notes` |
| `Requests` | `id`, `type`, `dealId`, `requestedBy`, `status`, `notes`, `createdAt` |
| `Commissions` | `id`, `dealId`, `setterId`, `closerId`, `setterAmount`, `closerAmount`, `payoutStatus` |

---

## Documentation

| Document | Description |
|---|---|
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | System architecture and data flow |
| [`docs/BACKEND_DEPLOYMENT.md`](./docs/BACKEND_DEPLOYMENT.md) | GAS deployment guide |
| [`docs/TESTING_RBAC.md`](./docs/TESTING_RBAC.md) | RBAC verification test cases |

---

## Contributing

This is a private internal system. For changes, create a feature branch and open a PR for review before merging to `main`.

---

## License

Private & Proprietary — © 2026 TJGROPS. All rights reserved.
