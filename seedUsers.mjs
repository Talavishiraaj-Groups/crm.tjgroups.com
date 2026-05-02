import dotenv from 'dotenv';
dotenv.config();

const API_URL = process.env.VITE_API_URL;

async function seedUsers() {
  console.log('Seeding users to Google Apps Script...');

  const users = [
    { Username: 'super_admin', Role: 'SUPER_ADMIN', Team: 'Global', Status: 'Active', Availability: 'Available' },
    { Username: 'team_lead', Role: 'ADMIN', Team: 'Alpha Team', Status: 'Active', Availability: 'Available' },
    { Username: 'sales_rep_1', Role: 'SALES_REP', Team: 'Alpha Team', Status: 'Active', Availability: 'Available' },
    { Username: 'sales_rep_2', Role: 'SALES_REP', Team: 'Beta Team', Status: 'Active', Availability: 'Available' }
  ];

  for (const user of users) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'createUser', payload: user })
    });
    console.log(`Created User: ${user.Username}`, await res.json());
  }

  console.log('User seeding complete.');
}

seedUsers().catch(console.error);
