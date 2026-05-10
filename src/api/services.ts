import { 
  Lead, Deal, Project, AdminRequest, Log, User, Commission, 
  UserRole, LeadStatus, DealStatus, ProjectStatus 
} from '../types';

const API_URL = import.meta.env.VITE_API_URL;

async function fetchAPI(action: string, method: 'GET' | 'POST' = 'GET', payload?: any, params: Record<string, string> = {}) {
  if (!API_URL) throw new Error('VITE_API_URL is missing in .env');
  
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    const fetchOptions: RequestInit = method === 'POST' ? {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload })
    } : { method: 'GET' };

    const res = await fetch(method === 'GET' ? url.toString() : API_URL, fetchOptions);
    const text = await res.text();
    
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error(`Invalid JSON for ${action}:`, text);
      throw new Error(`Invalid response from server for ${action}.`);
    }

    if (json.status !== 'success') {
      console.error(`API Error for ${action}:`, json.message);
      throw new Error(json.message || `API Error for ${action}`);
    }
    return json.data;
  } catch (error: any) {
    console.error(`API Failure [${action}]:`, error);
    throw error;
  }
}

export const api = {
  leads: {
    getAll: async (role: UserRole, userId: string): Promise<Lead[]> => {
      try {
        const data = await fetchAPI('getLeads');
        if (!Array.isArray(data)) return [];
        
        let leads = data.map((r: any) => ({
          id: String(r.ID || ''), name: r.Name || 'Unknown', email: r.Email || '', phone: r.Phone || '',
          linkedin: r.Linkedin || '',
          setterId: r.SetterId || '', closerId: r.CloserId || '',
          status: r.Status || 'New', ownerRepId: r.OwnerRepId || '', notes: r.Notes || '',
          createdAt: r.CreatedAt || '', updatedAt: r.UpdatedAt || ''
        })) as Lead[];
        
        if (role === 'SALES_REP') leads = leads.filter(l => l.ownerRepId === userId);
        return leads;
      } catch (err) {
        return [];
      }
    },
    getById: async (id: string): Promise<Lead | undefined> => {
      const data = await fetchAPI('getLeadById', 'GET', null, { id });
      if (!data) return undefined;
      return {
        id: String(data.ID || ''), name: data.Name || 'Unknown', email: data.Email || '', phone: data.Phone || '',
        linkedin: data.Linkedin || '',
        setterId: data.SetterId || '', closerId: data.CloserId || '',
        status: data.Status || 'New', ownerRepId: data.OwnerRepId || '', notes: data.Notes || '',
        createdAt: data.CreatedAt || '', updatedAt: data.UpdatedAt || ''
      } as Lead;
    },
    create: async (payload: Partial<Lead>): Promise<Lead> => {
      const sheetPayload = {
        Name: payload.name, Email: payload.email, Phone: payload.phone, Linkedin: payload.linkedin,
        Status: payload.status, OwnerRepId: payload.ownerRepId, Notes: payload.notes,
        SetterId: payload.setterId, CloserId: payload.closerId
      };
      const res = await fetchAPI('createLead', 'POST', sheetPayload);
      return {
        id: res.ID, name: res.Name, email: res.Email, phone: res.Phone, linkedin: res.Linkedin,
        status: res.Status, ownerRepId: res.OwnerRepId, notes: res.Notes,
        setterId: res.SetterId, closerId: res.CloserId,
        createdAt: res.CreatedAt, updatedAt: res.UpdatedAt
      } as Lead;
    },
    update: async (id: string, payload: Partial<Lead>): Promise<void> => {
      const sheetPayload: any = { id };
      if (payload.status !== undefined) sheetPayload.Status = payload.status;
      if (payload.notes !== undefined) sheetPayload.Notes = payload.notes;
      if (payload.name !== undefined) sheetPayload.Name = payload.name;
      if (payload.linkedin !== undefined) sheetPayload.Linkedin = payload.linkedin;
      if (payload.setterId !== undefined) sheetPayload.SetterId = payload.setterId;
      if (payload.closerId !== undefined) sheetPayload.CloserId = payload.closerId;
      await fetchAPI('updateLead', 'POST', sheetPayload);
    },
    convertToDeal: async (leadId: string, userId: string, value: number): Promise<Deal> => {
      const lead = await api.leads.getById(leadId);
      const deal = await api.deals.create({
        leadId: leadId,
        ownerRepId: userId,
        setterId: lead?.ownerRepId || userId,
        closerId: userId,
        status: 'Open',
        value: value
      });
      await api.leads.update(leadId, { status: 'Converted' });
      await api.logs.create({
        entityId: leadId,
        entityType: 'Lead',
        action: 'CONVERSION',
        userId: userId,
        details: `Lead converted to Deal #${deal.id} with value $${value}`
      });
      return deal;
    }
  },

  deals: {
    getAll: async (role: UserRole, userId: string): Promise<Deal[]> => {
      try {
        const data = await fetchAPI('getDeals');
        if (!Array.isArray(data)) return [];
        
        let deals = data.map((r: any) => ({
          id: String(r.ID || ''), 
          leadId: r.LeadId || '', 
          clientName: r.ClientName || '',
          value: Number(r.Value || 0), 
          status: r.Status || 'Open', 
          ownerRepId: r.OwnerRepId || '',
          setterId: r.SetterId || '',
          closerId: r.CloserId || '',
          createdAt: r.CreatedAt || '', 
          updatedAt: r.UpdatedAt || ''
        })) as Deal[];
        
        if (role === 'SALES_REP') deals = deals.filter(d => d.ownerRepId === userId);
        return deals;
      } catch (err) {
        return [];
      }
    },
    create: async (payload: Partial<Deal>): Promise<Deal> => {
      const sheetPayload = {
        LeadId: payload.leadId, 
        Value: payload.value, 
        Status: payload.status, 
        OwnerRepId: payload.ownerRepId,
        SetterId: payload.setterId,
        CloserId: payload.closerId
      };
      const res = await fetchAPI('createDeal', 'POST', sheetPayload);
      return { 
        id: res.ID, leadId: res.LeadId, value: res.Value, status: res.Status, 
        ownerRepId: res.OwnerRepId, createdAt: res.CreatedAt, updatedAt: res.UpdatedAt 
      } as Deal;
    },
    updateStatus: async (dealId: string, status: DealStatus, commissionData?: { setterAmount: number, closerAmount: number, setterId?: string, closerId?: string }): Promise<void> => {
      await fetchAPI('updateDeal', 'POST', { id: dealId, Status: status });
      
      if (status === 'Won') {
        try {
          const deals = await fetchAPI('getDeals');
          const deal = Array.isArray(deals) ? deals.find((d: any) => String(d.ID) === String(dealId)) : null;
          if (deal) {
            const leadId = deal.LeadId;
            const leads = await fetchAPI('getLeads');
            const lead = Array.isArray(leads) ? leads.find((l: any) => String(l.ID) === String(leadId)) : null;
            
            if (lead) {
              const value = Number(deal.Value || 0);
              const setterAmount = commissionData?.setterAmount ?? (value * 0.05);
              const closerAmount = commissionData?.closerAmount ?? (value * 0.10);
              const setterId = commissionData?.setterId || lead.OwnerRepId;
              const closerId = commissionData?.closerId || deal.OwnerRepId;
              
              await fetchAPI('createCommission', 'POST', {
                DealId: dealId,
                SetterId: setterId,
                CloserId: closerId,
                SetterAmount: setterAmount,
                CloserAmount: closerAmount,
                PayoutStatus: 'Pending'
              });
              
              await api.logs.create({
                entityId: dealId,
                entityType: 'Deal',
                action: 'COMMISSION_GENERATED',
                userId: 'SYSTEM',
                details: `Commissions generated: Setter ($${setterAmount}), Closer ($${closerAmount})`
              });
            }
          }
        } catch (commErr) {
          console.error("Commission generation failed:", commErr);
        }
      }
    }
  },

  projects: {
    getAll: async (role: UserRole, userId: string): Promise<Project[]> => {
      try {
        const data = await fetchAPI('getProjects');
        if (!Array.isArray(data)) return [];
        
        let projects = data.map((r: any) => {
          let status = r.Status || 'Onboarding';
          if (status === 'In Progress') status = 'InProgress';
          
          return {
            id: String(r.ID || ''), clientName: r.ClientName || 'Unknown', status: status as ProjectStatus, ownerRepId: r.OwnerRepId || '',
            accountManagerId: r.AccountManagerId || '', liaisonId: r.LiaisonId || '',
            startDate: r.StartDate || '', dueDate: r.DueDate || ''
          };
        }) as Project[];
        
        if (role === 'SALES_REP') projects = projects.filter(p => p.ownerRepId === userId);
        return projects;
      } catch (err) {
        return [];
      }
    },
    create: async (payload: Partial<Project>): Promise<Project> => {
      const sheetPayload = {
        ClientName: payload.clientName, Status: payload.status, OwnerRepId: payload.ownerRepId,
        AccountManagerId: payload.accountManagerId, LiaisonId: payload.liaisonId,
        StartDate: payload.startDate, DueDate: payload.dueDate
      };
      const res = await fetchAPI('createProject', 'POST', sheetPayload);
      return { 
        id: res.ID, clientName: res.ClientName, status: res.Status, ownerRepId: res.OwnerRepId, 
        accountManagerId: res.AccountManagerId, liaisonId: res.LiaisonId,
        startDate: res.StartDate, dueDate: res.DueDate 
      } as Project;
    },
    update: async (id: string, payload: Partial<Project>): Promise<void> => {
      const sheetPayload = {
        id,
        Status: payload.status,
        AccountManagerId: payload.accountManagerId,
        LiaisonId: payload.liaisonId,
        Notes: payload.notes
      };
      await fetchAPI('updateProject', 'POST', sheetPayload);
    }
  },

  users: {
    getAll: async (): Promise<User[]> => {
      try {
        const data = await fetchAPI('getUsers');
        if (!Array.isArray(data)) return [];
        
        return data.map((row: any) => ({
          id: String(row.ID || ''), username: String(row.Username || 'Unknown'), password: row.Password ? String(row.Password) : '', role: row.Role || 'SALES_REP', team: row.Team || '', 
          status: row.Status || 'Inactive', availability: row.Availability || 'Offline',
          metrics: row.Metrics ? JSON.parse(row.Metrics) : undefined
        }));
      } catch (err) {
        return [];
      }
    },
    create: async (payload: Partial<User>): Promise<User> => {
      const sheetPayload = {
        Username: payload.username, Password: payload.password, Role: payload.role, Team: payload.team, Status: payload.status, Availability: payload.availability
      };
      const res = await fetchAPI('createUser', 'POST', sheetPayload);
      return { id: res.ID, username: res.Username, password: res.Password, role: res.Role, team: res.Team, status: res.Status, availability: res.Availability } as User;
    },
    update: async (id: string, payload: Partial<User>): Promise<User> => {
      const sheetPayload: any = { id };
      if (payload.status) sheetPayload.Status = payload.status;
      if (payload.availability) sheetPayload.Availability = payload.availability;
      if (payload.role) sheetPayload.Role = payload.role;
      if (payload.username) sheetPayload.Username = payload.username;
      if (payload.password) sheetPayload.Password = payload.password;
      if (payload.team) sheetPayload.Team = payload.team;
      
      const res = await fetchAPI('updateUser', 'POST', sheetPayload);
      return { id: res.ID, username: res.Username, password: res.Password, role: res.Role, team: res.Team, status: res.Status, availability: res.Availability } as User;
    },
    delete: async (id: string): Promise<void> => {
      await fetchAPI('deleteUser', 'POST', { id });
    }
  },

  adminRequests: {
    getAll: async (): Promise<AdminRequest[]> => {
      try {
        const data = await fetchAPI('getAdminRequests');
        if (!Array.isArray(data)) return [];
        
        return data.map((r: any) => ({
          id: String(r.ID || ''), type: r.Type || 'payment', relatedDealId: r.RelatedDealId || '', requestedBy: r.RequestedBy || '', 
          status: r.Status || 'Pending', createdAt: r.CreatedAt || '', notes: r.Notes || '',
          paymentLink: r.PaymentLink || '', documentUrl: r.DocumentUrl || ''
        })) as AdminRequest[];
      } catch (err) {
        return [];
      }
    },
    create: async (payload: Partial<AdminRequest>): Promise<AdminRequest> => {
      const sheetPayload = {
        Type: payload.type, RelatedDealId: payload.relatedDealId, 
        RequestedBy: payload.requestedBy, Status: payload.status, Notes: payload.notes
      };
      const res = await fetchAPI('createAdminRequest', 'POST', sheetPayload);
      return { 
        id: res.ID, type: res.Type, relatedDealId: res.RelatedDealId, 
        requestedBy: res.RequestedBy, status: res.Status, createdAt: res.CreatedAt, notes: res.Notes
      } as AdminRequest;
    },
    update: async (id: string, payload: Partial<AdminRequest>): Promise<void> => {
      const sheetPayload: any = { id };
      if (payload.status) sheetPayload.Status = payload.status;
      if (payload.paymentLink) sheetPayload.PaymentLink = payload.paymentLink;
      if (payload.documentUrl) sheetPayload.DocumentUrl = payload.documentUrl;
      await fetchAPI('updateAdminRequest', 'POST', sheetPayload);
    }
  },

  finance: {
    getCommissions: async (): Promise<Commission[]> => {
      try {
        const data = await fetchAPI('getCommissions');
        if (!Array.isArray(data)) return [];
        
        return data.map((r: any) => ({
          id: String(r.ID || ''), dealId: r.DealId || '', setterId: r.SetterId || '', setterCommissionAmount: Number(r.SetterAmount || 0),
          closerId: r.CloserId || '', closerCommissionAmount: Number(r.CloserAmount || 0), payoutStatus: r.PayoutStatus || 'Pending'
        }));
      } catch (err) {
        return [];
      }
    },
    getKPIs: async () => {
      try {
        return await fetchAPI('getKPIs');
      } catch (err) {
        return { totalValue: 0, totalCommissions: 0, payoutsPending: 0, payoutsPaid: 0 };
      }
    },
    processCommission: async (id: string): Promise<void> => {
      await fetchAPI('updateCommission', 'POST', { id, PayoutStatus: 'Paid' });
    }
  },
  
  logs: {
    getByEntity: async (entityId: string): Promise<Log[]> => {
      try {
        // If entityId is GLOBAL, we fetch all logs without ID param
        const params: Record<string, string> = entityId === 'GLOBAL' ? {} : { id: entityId };
        const data = await fetchAPI('getLogs', 'GET', null, params);
        if (!Array.isArray(data)) return [];
        
        return data.map((r: any) => ({
          id: String(r.ID || ''), entityId: r.EntityId || '', entityType: r.EntityType || 'Lead',
          action: r.Action || 'LOG', userId: r.UserId || '', details: r.Details || '', timestamp: r.Timestamp || ''
        }));
      } catch (err) {
        return [];
      }
    },
    create: async (payload: { entityId: string, entityType: string, action: string, userId: string, details: string }): Promise<void> => {
      const sheetPayload = {
        EntityId: payload.entityId, EntityType: payload.entityType,
        Action: payload.action, UserId: payload.userId, Details: payload.details
      };
      await fetchAPI('createLog', 'POST', sheetPayload);
    }
  }
};
