import dotenv from 'dotenv';
dotenv.config();

const API_URL = process.env.VITE_API_URL;

async function seedData() {
  console.log('Seeding data to Google Apps Script...');

  const leads = [
    { Name: 'Tech Corp Upgrade', Email: 'ceo@techcorp.com', Phone: '555-0101', Status: 'New', OwnerRepId: 'sr_1', Notes: 'Interested in enterprise tier.' },
    { Name: 'Acme LLC Redesign', Email: 'vp@acme.com', Phone: '555-0102', Status: 'Contacted', OwnerRepId: 'sr_1', Notes: 'Budget approved.' },
    { Name: 'Global Logistics', Email: 'ops@globallogistics.com', Phone: '555-0103', Status: 'Qualified', OwnerRepId: 'a_1', Notes: 'Needs custom API integration.' }
  ];

  for (const lead of leads) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'createLead', payload: lead })
    });
    console.log(`Created Lead: ${lead.Name}`, await res.json());
  }

  const deals = [
    { LeadId: 'lead_1', Value: 45000, Status: 'Proposal Sent', OwnerRepId: 'sr_1' },
    { LeadId: 'lead_2', Value: 12000, Status: 'Negotiation', OwnerRepId: 'sr_1' },
    { LeadId: 'lead_3', Value: 85000, Status: 'Closed Won', OwnerRepId: 'a_1' }
  ];

  for (const deal of deals) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'createDeal', payload: deal })
    });
    console.log(`Created Deal Value: ${deal.Value}`, await res.json());
  }
  
  const projects = [
    { ClientName: 'Global Logistics API', Status: 'In Progress', OwnerRepId: 'a_1', StartDate: new Date().toISOString(), DueDate: new Date(Date.now() + 864000000).toISOString() }
  ];

  for (const project of projects) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'createProject', payload: project })
    });
    console.log(`Created Project: ${project.ClientName}`, await res.json());
  }

  console.log('Seeding complete.');
}

seedData().catch(console.error);
