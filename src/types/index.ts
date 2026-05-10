export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'SALES_REP' | 'SETTER';

export interface User {
  id: string;
  username: string;
  password?: string;
  role: UserRole;
  team?: string;
  status: 'Active' | 'Inactive';
  availability: 'Available' | 'Busy' | 'Offline';
  metrics?: {
    openLeads: number;
    openDeals: number;
    todayInteractions: number;
  };
}

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
