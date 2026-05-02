import { Lead, Deal, Project, AdminRequest, Log, User, Commission } from '../types';

export const MOCK_LEADS: Lead[] = [
  {
    id: 'l1',
    name: 'Sarah Johnson',
    email: 'sarah.j@example.com',
    phone: '+1 555-0101',
    status: 'New',
    ownerRepId: 'sr_1',
    notes: 'Interested in enterprise license.',
    createdAt: '2023-10-20T10:00:00Z',
    updatedAt: '2023-10-20T10:00:00Z'
  },
  {
    id: 'l2',
    name: 'Michael Chen',
    email: 'm.chen@techcorp.com',
    phone: '+1 555-0102',
    status: 'Contacted',
    ownerRepId: 'sr_1',
    notes: 'Follow up scheduled for Tuesday.',
    createdAt: '2023-10-19T14:30:00Z',
    updatedAt: '2023-10-20T09:00:00Z'
  },
  {
    id: 'l3',
    name: 'Emma Wilson',
    email: 'emma.w@startup.io',
    phone: '+1 555-0103',
    status: 'Qualified',
    ownerRepId: 'sr_2',
    notes: 'Budget approved. Moving to contract.',
    createdAt: '2023-10-15T11:00:00Z',
    updatedAt: '2023-10-18T16:00:00Z'
  }
];

export const MOCK_DEALS: Deal[] = [
  {
    id: 'd1',
    leadId: 'l3',
    ownerRepId: 'sr_2',
    status: 'Open',
    value: 12500,
    createdAt: '2023-10-18T16:30:00Z',
    updatedAt: '2023-10-18T16:30:00Z'
  }
];

export const MOCK_PROJECTS: Project[] = [
  {
    id: 'p1',
    dealId: 'd0', // previous deal
    clientName: 'Global Nexus',
    status: 'InProgress',
    ownerRepId: 'sr_1',
    startDate: '2023-09-01',
    dueDate: '2023-12-01',
    notes: 'Phase 2 integration nearly complete.'
  }
];

export const MOCK_USERS: User[] = [
  {
    id: 'sr_1',
    username: 'sales_rep_1',
    role: 'SALES_REP',
    status: 'Active',
    availability: 'Available',
    metrics: { openLeads: 12, openDeals: 3, todayInteractions: 8 }
  },
  {
    id: 'sr_2',
    username: 'sales_rep_2',
    role: 'SALES_REP',
    status: 'Active',
    availability: 'Busy',
    metrics: { openLeads: 8, openDeals: 5, todayInteractions: 4 }
  },
  {
    id: 'a_1',
    username: 'team_lead',
    role: 'ADMIN',
    team: 'Alpha Team',
    status: 'Active',
    availability: 'Available'
  }
];

export const MOCK_REQUESTS: AdminRequest[] = [
  {
    id: 'req1',
    type: 'payment',
    requestedBy: 'sr_1',
    relatedDealId: 'd1',
    status: 'Pending',
    createdAt: '2023-10-20T12:00:00Z',
    updatedAt: '2023-10-20T12:00:00Z',
    notes: 'Urgent payment request for Sarah.'
  }
];

export const MOCK_COMMISSIONS: Commission[] = [
  {
    id: 'c1',
    dealId: 'd1',
    setterId: 'sr_1',
    closerId: 'sr_2',
    setterCommissionAmount: 1250,
    closerCommissionAmount: 2500,
    payoutStatus: 'Pending'
  }
];
