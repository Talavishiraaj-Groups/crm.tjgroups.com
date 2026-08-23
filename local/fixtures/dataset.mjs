/**
 * Deterministic CRM fixture set.
 *
 * ID format matches production exactly: the backend mints IDs with
 * Utilities.getUuid(), so every fixture ID here is a real UUID string.
 * Tests that assert on ID handling are therefore testing the same shape
 * the live system uses.
 *
 * The dataset is intentionally adversarial: two teams, multiple owners,
 * setter/closer splits that differ from owners, inactive and deactivated
 * accounts, an orphaned deal, a converted lead, and pre-existing
 * commissions in both payout states.
 */

/** Stable UUIDs — handwritten so tests can reference them literally. */
export const ID = {
  // users
  superAdmin: '11111111-1111-4111-a111-111111111101',
  adminAlpha: '11111111-1111-4111-a111-111111111102',
  adminBeta: '11111111-1111-4111-a111-111111111103',
  repAlpha1: '11111111-1111-4111-a111-111111111104',
  repAlpha2: '11111111-1111-4111-a111-111111111105',
  repBeta1: '11111111-1111-4111-a111-111111111106',
  setterAlpha: '11111111-1111-4111-a111-111111111107',
  repInactive: '11111111-1111-4111-a111-111111111108',

  // leads
  leadAlphaNew: '22222222-2222-4222-a222-222222222201',
  leadAlphaQualified: '22222222-2222-4222-a222-222222222202',
  leadAlphaConverted: '22222222-2222-4222-a222-222222222203',
  leadBetaNew: '22222222-2222-4222-a222-222222222204',
  leadBetaContacted: '22222222-2222-4222-a222-222222222205',
  leadUnassigned: '22222222-2222-4222-a222-222222222206',
  leadMalformed: '22222222-2222-4222-a222-222222222207',

  // deals
  dealAlphaOpen: '33333333-3333-4333-a333-333333333301',
  dealAlphaWon: '33333333-3333-4333-a333-333333333302',
  dealBetaOpen: '33333333-3333-4333-a333-333333333303',
  dealBetaLost: '33333333-3333-4333-a333-333333333304',
  dealOrphan: '33333333-3333-4333-a333-333333333305',

  // commissions
  commAlphaPaid: '44444444-4444-4444-a444-444444444401',
  commBetaPending: '44444444-4444-4444-a444-444444444402',

  // projects
  projAlpha: '55555555-5555-4555-a555-555555555501',
  projBeta: '55555555-5555-4555-a555-555555555502',

  // admin requests
  reqAlphaPayment: '66666666-6666-4666-a666-666666666601',
  reqBetaPaperwork: '66666666-6666-4666-a666-666666666602',

  // a well-formed UUID that exists nowhere
  ghost: '99999999-9999-4999-a999-999999999999',
};

const T0 = '2026-01-01T08:00:00.000Z';
const T1 = '2026-01-02T08:00:00.000Z';
const T2 = '2026-01-03T08:00:00.000Z';

export const USERS = [
  {
    ID: ID.superAdmin, Username: 'super_admin', Role: 'SUPER_ADMIN', Team: 'Management',
    Status: 'Active', Availability: 'Available', ZohoEmail: 'super@tjgroups.test',
    ZohoRefreshToken: '', CreatedAt: T0, UpdatedAt: T0,
  },
  {
    ID: ID.adminAlpha, Username: 'admin_alpha', Role: 'ADMIN', Team: 'Alpha',
    Status: 'Active', Availability: 'Available', ZohoEmail: '', ZohoRefreshToken: '',
    CreatedAt: T0, UpdatedAt: T0,
  },
  {
    ID: ID.adminBeta, Username: 'admin_beta', Role: 'ADMIN', Team: 'Beta',
    Status: 'Active', Availability: 'Busy', ZohoEmail: '', ZohoRefreshToken: '',
    CreatedAt: T0, UpdatedAt: T0,
  },
  {
    ID: ID.repAlpha1, Username: 'sales_rep_1', Role: 'SALES_REP', Team: 'Alpha',
    Status: 'Active', Availability: 'Available', ZohoEmail: '', ZohoRefreshToken: '',
    CreatedAt: T0, UpdatedAt: T0,
  },
  {
    ID: ID.repAlpha2, Username: 'sales_rep_2', Role: 'SALES_REP', Team: 'Alpha',
    Status: 'Active', Availability: 'Available', ZohoEmail: '', ZohoRefreshToken: '',
    CreatedAt: T0, UpdatedAt: T0,
  },
  {
    ID: ID.repBeta1, Username: 'sales_rep_beta', Role: 'SALES_REP', Team: 'Beta',
    Status: 'Active', Availability: 'Offline', ZohoEmail: '', ZohoRefreshToken: '',
    CreatedAt: T0, UpdatedAt: T0,
  },
  {
    ID: ID.setterAlpha, Username: 'setter_alpha', Role: 'SETTER', Team: 'Alpha',
    Status: 'Active', Availability: 'Available', ZohoEmail: '', ZohoRefreshToken: '',
    CreatedAt: T0, UpdatedAt: T0,
  },
  {
    ID: ID.repInactive, Username: 'rep_deactivated', Role: 'SALES_REP', Team: 'Alpha',
    Status: 'Inactive', Availability: 'Offline', ZohoEmail: '', ZohoRefreshToken: '',
    CreatedAt: T0, UpdatedAt: T1,
  },
];

export const LEADS = [
  {
    ID: ID.leadAlphaNew, Name: 'Northwind Traders', Email: 'buyer@northwind.test',
    Phone: '+15550100', Status: 'New', OwnerRepId: ID.repAlpha1, SetterId: ID.setterAlpha,
    CloserId: '', Notes: 'Inbound enquiry.', Linkedin: 'https://linkedin.com/company/northwind',
    NextFollowUp: '2026-01-10', CreatedAt: T0, UpdatedAt: T0,
  },
  {
    ID: ID.leadAlphaQualified, Name: 'Contoso Ltd', Email: 'cto@contoso.test',
    Phone: '+15550101', Status: 'Qualified', OwnerRepId: ID.repAlpha1, SetterId: ID.setterAlpha,
    CloserId: ID.repAlpha1, Notes: 'Budget confirmed.', Linkedin: '',
    NextFollowUp: '2026-01-08', CreatedAt: T0, UpdatedAt: T1,
  },
  {
    ID: ID.leadAlphaConverted, Name: 'Fabrikam Inc', Email: 'ops@fabrikam.test',
    Phone: '+15550102', Status: 'Converted', OwnerRepId: ID.repAlpha2, SetterId: ID.setterAlpha,
    CloserId: ID.repAlpha2, Notes: 'Won last quarter.', Linkedin: '',
    NextFollowUp: '', CreatedAt: T0, UpdatedAt: T2,
  },
  {
    ID: ID.leadBetaNew, Name: 'Tailspin Toys', Email: 'md@tailspin.test',
    Phone: '+15550103', Status: 'New', OwnerRepId: ID.repBeta1, SetterId: '',
    CloserId: '', Notes: 'Cold outreach.', Linkedin: '',
    NextFollowUp: '', CreatedAt: T1, UpdatedAt: T1,
  },
  {
    ID: ID.leadBetaContacted, Name: 'Wingtip Toys', Email: 'ceo@wingtip.test',
    Phone: '+15550104', Status: 'Contacted', OwnerRepId: ID.repBeta1, SetterId: '',
    CloserId: ID.repBeta1, Notes: 'Call booked.', Linkedin: '',
    NextFollowUp: '2026-01-09', CreatedAt: T1, UpdatedAt: T1,
  },
  {
    ID: ID.leadUnassigned, Name: 'Litware Inc', Email: 'info@litware.test',
    Phone: '', Status: 'New', OwnerRepId: '', SetterId: '', CloserId: '',
    Notes: '', Linkedin: '', NextFollowUp: '', CreatedAt: T1, UpdatedAt: T1,
  },
  {
    // Deliberately hostile content: spreadsheet formula + HTML injection.
    ID: ID.leadMalformed, Name: '=HYPERLINK("http://evil.test","claim")',
    Email: 'weird@example.test', Phone: '+15550105', Status: 'New',
    OwnerRepId: ID.repAlpha1, SetterId: '', CloserId: '',
    Notes: '<img src=x onerror="alert(1)">', Linkedin: 'javascript:alert(1)',
    NextFollowUp: '', CreatedAt: T1, UpdatedAt: T1,
  },
];

export const DEALS = [
  {
    ID: ID.dealAlphaOpen, LeadId: ID.leadAlphaQualified, Value: 25000, Status: 'Open',
    OwnerRepId: ID.repAlpha1, SetterId: ID.setterAlpha, CloserId: ID.repAlpha1,
    CreatedAt: T1, UpdatedAt: T1,
  },
  {
    ID: ID.dealAlphaWon, LeadId: ID.leadAlphaConverted, Value: 40000, Status: 'Won',
    OwnerRepId: ID.repAlpha2, SetterId: ID.setterAlpha, CloserId: ID.repAlpha2,
    CreatedAt: T0, UpdatedAt: T2,
  },
  {
    ID: ID.dealBetaOpen, LeadId: ID.leadBetaContacted, Value: 15000, Status: 'Open',
    OwnerRepId: ID.repBeta1, SetterId: '', CloserId: ID.repBeta1,
    CreatedAt: T1, UpdatedAt: T1,
  },
  {
    ID: ID.dealBetaLost, LeadId: ID.leadBetaNew, Value: 8000, Status: 'Lost',
    OwnerRepId: ID.repBeta1, SetterId: '', CloserId: ID.repBeta1,
    CreatedAt: T1, UpdatedAt: T2,
  },
  {
    // Dangling foreign key: the referenced lead does not exist.
    ID: ID.dealOrphan, LeadId: ID.ghost, Value: 5000, Status: 'Open',
    OwnerRepId: ID.repAlpha1, SetterId: '', CloserId: '',
    CreatedAt: T1, UpdatedAt: T1,
  },
];

export const COMMISSIONS = [
  {
    ID: ID.commAlphaPaid, DealId: ID.dealAlphaWon, SetterId: ID.setterAlpha,
    SetterAmount: 2000, CloserId: ID.repAlpha2, CloserAmount: 4000,
    PayoutStatus: 'Paid', CreatedAt: T2, UpdatedAt: T2,
  },
  {
    ID: ID.commBetaPending, DealId: ID.dealBetaOpen, SetterId: ID.repBeta1,
    SetterAmount: 750, CloserId: ID.repBeta1, CloserAmount: 1500,
    PayoutStatus: 'Pending', CreatedAt: T2, UpdatedAt: T2,
  },
];

export const PROJECTS = [
  {
    ID: ID.projAlpha, ClientName: 'Fabrikam Inc', Status: 'InProgress',
    OwnerRepId: ID.repAlpha2, AccountManagerId: ID.adminAlpha, LiaisonId: ID.repAlpha1,
    StartDate: '2026-01-05', DueDate: '2026-03-05', CreatedAt: T2, UpdatedAt: T2,
  },
  {
    ID: ID.projBeta, ClientName: 'Wingtip Toys', Status: 'Onboarding',
    OwnerRepId: ID.repBeta1, AccountManagerId: ID.adminBeta, LiaisonId: '',
    StartDate: '2026-01-06', DueDate: '2026-04-06', CreatedAt: T2, UpdatedAt: T2,
  },
];

export const ADMIN_REQUESTS = [
  {
    ID: ID.reqAlphaPayment, Type: 'payment', RelatedDealId: ID.dealAlphaOpen,
    RequestedBy: ID.repAlpha1, Status: 'Pending', CreatedAt: T2, UpdatedAt: T2,
  },
  {
    ID: ID.reqBetaPaperwork, Type: 'paperwork', RelatedDealId: ID.dealBetaOpen,
    RequestedBy: ID.repBeta1, Status: 'Pending', CreatedAt: T2, UpdatedAt: T2,
  },
];

export const LOGS = [
  {
    ID: '77777777-7777-4777-a777-777777777701', EntityId: ID.leadAlphaConverted,
    EntityType: 'Lead', Action: 'CONVERSION', UserId: ID.repAlpha2,
    Details: 'Lead converted to deal', Metadata: '', Timestamp: T2,
  },
];

export const FIXTURES = {
  Users: USERS,
  Leads: LEADS,
  Deals: DEALS,
  Projects: PROJECTS,
  AdminRequests: ADMIN_REQUESTS,
  Commissions: COMMISSIONS,
  Logs: LOGS,
};

/**
 * Load fixtures into a backend that has already run setup.
 * Idempotent: clears data rows first so repeated seeding cannot duplicate.
 */
export function seedFixtures(be, { only } = {}) {
  for (const [sheetName, rows] of Object.entries(FIXTURES)) {
    if (only && !only.includes(sheetName)) continue;
    const sheet = be.store.getSheet(sheetName);
    if (!sheet) continue;
    sheet.rows = [sheet.headers];
    for (const row of rows) be.store.insert(sheetName, row);
  }
  return be;
}

/** Bulk data for performance / full-scan detection. */
export function seedVolume(be, { leads = 500, deals = 300, logs = 2000 } = {}) {
  const pad = (n, w) => String(n).padStart(w, '0');
  for (let i = 0; i < leads; i++) {
    be.store.insert('Leads', {
      ID: `2a000000-0000-4000-a000-${pad(i, 12)}`,
      Name: `Volume Lead ${i}`, Email: `lead${i}@volume.test`, Phone: '',
      Status: ['New', 'Contacted', 'Qualified'][i % 3],
      OwnerRepId: i % 2 ? ID.repAlpha1 : ID.repBeta1,
      SetterId: '', CloserId: '', Notes: '', Linkedin: '', NextFollowUp: '',
      CreatedAt: T1, UpdatedAt: T1,
    });
  }
  for (let i = 0; i < deals; i++) {
    be.store.insert('Deals', {
      ID: `3a000000-0000-4000-a000-${pad(i, 12)}`,
      LeadId: `2a000000-0000-4000-a000-${pad(i, 12)}`,
      Value: 1000 + i, Status: ['Open', 'Won', 'Lost'][i % 3],
      OwnerRepId: i % 2 ? ID.repAlpha1 : ID.repBeta1,
      SetterId: '', CloserId: '', CreatedAt: T1, UpdatedAt: T1,
    });
  }
  for (let i = 0; i < logs; i++) {
    be.store.insert('Logs', {
      ID: `7a000000-0000-4000-a000-${pad(i, 12)}`,
      EntityId: `2a000000-0000-4000-a000-${pad(i % 500, 12)}`,
      EntityType: 'Lead', Action: 'NOTE', UserId: ID.repAlpha1,
      Details: `Volume log ${i}`, Metadata: '', Timestamp: T1,
    });
  }
  return be;
}
