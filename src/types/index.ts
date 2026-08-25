export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'SALES_REP' | 'SETTER';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  team?: string;
  status: 'Active' | 'Inactive';
  availability: 'Available' | 'Busy' | 'Offline';
  zohoEmail?: string;
  /**
   * Whether this user has connected a Zoho mailbox.
   *
   * The refresh token itself is never sent to the browser — the backend
   * returns this boolean instead. The old `zohoRefreshToken` field meant
   * every client held every user's mail credentials.
   */
  zohoLinked?: boolean;
  /** Whether a password has been set (used by admin screens during rollout). */
  hasPassword?: boolean;
  /**
   * The account must choose a new password.
   *
   * Set when a password was issued for them, or when their old one had been
   * readable in the Users sheet and is therefore considered exposed. Advisory:
   * the backend does not block the account, so this must be acted on in the UI
   * or it means nothing.
   */
  mustChangePassword?: boolean;
  metrics?: {
    openLeads: number;
    openDeals: number;
    todayInteractions: number;
  };
}

/**
 * Password only ever travels browser -> server, never back. It is therefore
 * modelled separately from `User` rather than as an optional field on it.
 */
export type UserWithPassword = Partial<User> & { password?: string };

export type LeadStatus = 'New' | 'Contacted' | 'Qualified' | 'Converted' | 'Closed';

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  linkedin?: string;
  assignedSetter?: string;
  assignedCloser?: string;
  setterId?: string; // Standardized ID
  closerId?: string; // Standardized ID
  status: LeadStatus;
  cost?: number;
  notes: string;
  ownerRepId: string;
  createdAt: string;
  updatedAt: string;
  nextFollowUp?: string;
  /** 'Planned' | 'Completed' — blank on rows written before this existed. */
  followUpStatus?: string;
  followUpCompletedAt?: string;
  /** Why a follow-up was left outstanding. Server-written; never editable. */
  followUpDelayReason?: string;
  followUpDelayReasonAt?: string;
  followUpDelayReasonBy?: string;
  /** What was found out about this company. */
  researchFindings?: string;
  /** Why it was judged worth approaching. */
  qualificationReason?: string;
  /** Where the research came from — a URL or a description. */
  researchSource?: string;
  researchUpdatedAt?: string;
  researchUpdatedBy?: string;
}

export type DealStatus = 'Open' | 'Won' | 'Lost';

export interface Deal {
  id: string;
  leadId: string;
  clientName?: string; // Cache for display
  ownerRepId: string;
  setterId?: string;
  closerId?: string;
  status: DealStatus;
  value: number;
  createdAt: string;
  updatedAt: string;
}

export type RequestType = 'payment' | 'paperwork';
export type PaymentStatus = 'Pending' | 'Sent' | 'Paid' | 'Failed' | 'Approved';
export type PaperworkStatus = 'Pending' | 'Drafting' | 'Sent' | 'Signed' | 'Archived' | 'Approved';

export interface AdminRequest {
  id: string;
  type: RequestType;
  requestedBy: string;
  relatedDealId: string;
  status: PaymentStatus | PaperworkStatus;
  createdAt: string;
  updatedAt: string;
  notes?: string;
  paymentLink?: string;
  documentUrl?: string;
}

export type ProjectStatus = 'Onboarding' | 'InProgress' | 'Completed';

export interface Project {
  id: string;
  dealId: string;
  clientName: string;
  status: ProjectStatus;
  ownerRepId: string;
  accountManagerId?: string; // Delivery contact
  liaisonId?: string; // Liaison between client and sales
  startDate: string;
  dueDate: string;
  notes?: string;
  logs?: Log[];
}

export interface Log {
  id: string;
  entityId: string;
  entityType: 'Lead' | 'Deal' | 'Project' | 'User';
  action: string;
  userId: string;
  details: string;
  metadata?: string;
  timestamp: string;
}

export interface Commission {
  id: string;
  dealId: string;
  setterId: string;
  closerId: string;
  setterCommissionAmount: number;
  closerCommissionAmount: number;
  payoutStatus: 'Pending' | 'Processing' | 'Paid';
  payoutDate?: string;
}


export interface ZohoEmailItem {
  id: string;
  subject: string;
  summary?: string;
  content: string;
  sender?: string;
  toAddress?: string;
  ccAddress?: string;
  direction: 'in' | 'out';
  timestamp: string;
  /** Zoho's own message id — the key a stored copy is matched on. */
  messageId?: string;
  /**
   * True when this entry came from the CRM's own EmailLog rather than a live
   * Zoho fetch. Stored entries keep the conversation readable when a token
   * expires or the message is deleted from the mailbox, but they hold only
   * the envelope and a summary — not the full body.
   */
  stored?: boolean;
}

/** Email activity, already scoped by the backend to what the caller may see. */
export interface EmailAnalytics {
  window: { days: number; from: string; timeZone: string };
  /** How far these figures reach — decided server-side from the session. */
  scope: 'organisation' | 'team' | 'self';
  totals: { sent: number; received: number; matchedToLead: number; withoutLead: number };
  engagement: {
    leadsEmailed: number;
    leadsThatReplied: number;
    /** null when nothing was emailed in the window — not zero. */
    replyRatePercent: number | null;
  };
  byUser: { userId: string; username: string; sent: number; received: number; withoutLead: number }[];
  byDay: { date: string; sent: number; received: number }[];
  coverage: { note: string; mailboxesReporting: number };
}

/** Correspondence in someone's mailbox with no lead behind it. */
export interface UnmatchedEmails {
  total: number;
  truncated: boolean;
  messages: {
    id: string; subject: string; sender: string; toAddress: string;
    direction: 'in' | 'out'; sentAt: string; userId: string;
  }[];
}

/** A half-written email, held in the CRM next to the lead it belongs to. */
export interface EmailDraft {
  id: string;
  leadId: string;
  userId: string;
  toAddress: string;
  subject: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  sentAt: string;
}

