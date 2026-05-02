import React from 'react';
import { useAuth } from '../context/AuthContext';

export const GuidePage: React.FC = () => {
  const { role } = useAuth();

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-12">
      <div className="border-b border-[#DFDFDF] pb-6">
        <h2 className="text-2xl font-bold text-[#161616] tracking-tight flex items-center gap-3">
          TJGROPS CRM Platform Guide
        </h2>
        <p className="text-sm text-[#161616]/50 font-medium mt-1.5 max-w-2xl">
          Welcome to the comprehensive user manual for the TJGROPS CRM. This guide is tailored to your specific access level and covers all end-to-end workflows required to successfully operate within the system.
        </p>
      </div>

      {/* ------------------------------------------------------------------------- */}
      {/* SUPER ADMIN GUIDE */}
      {/* ------------------------------------------------------------------------- */}
      {role === 'SUPER_ADMIN' && (
        <div className="flex flex-col gap-8">
          
          <div className="bg-white border border-[#161616]/10 shadow-sm rounded-[6px] overflow-hidden">
            <div className="bg-[#161616] px-6 py-4 flex items-center gap-3">
              <h3 className="text-lg font-bold text-white tracking-wide">Super Administrator Playbook</h3>
            </div>
            <div className="p-6 text-sm text-[#161616]/80 leading-relaxed">
              <p className="mb-6 border-l-2 border-[#161616] pl-4 italic text-[#161616]/60">
                As a Super Admin, you have unrestricted access to all modules, including sensitive financial data and global user management. Your primary role is system oversight, financial processing, and final approvals.
              </p>

              <div className="space-y-8">
                <section>
                  <h4 className="font-bold text-[#161616] text-[15px] mb-3 flex items-center gap-2">
                    1. System & User Administration (Admin Tab)
                  </h4>
                  <p className="mb-3">The Admin module is your control center for managing the CRM's users. Every employee must have an active account to access the system.</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Creating Users:</strong> Click "+ INVITE USER" to add new employees. You must provide a username, assign a role, and set their initial <strong>Password</strong>.</li>
                    <li><strong>Role Hierarchy:</strong> 
                      <ul className="list-[circle] pl-5 mt-1 space-y-1 text-[#161616]/60">
                        <li><em>Super Admin</em>: Full access (Finance, Admin, approvals).</li>
                        <li><em>Admin (Team Lead)</em>: Can view all team metrics, edit users, and approve requests. Cannot access Finance.</li>
                        <li><em>Sales Rep</em>: Can only view their assigned Leads, Deals, and Projects.</li>
                      </ul>
                    </li>
                    <li><strong>Account Maintenance:</strong> Use the Three-Dot menu next to any user to open the Edit Modal. Here you can reset forgotten passwords or re-assign them to different teams.</li>
                    <li><strong>Offboarding:</strong> Never delete a user, as it ruins historical data. Instead, click "DEACTIVATE" to immediately revoke their login access.</li>
                  </ul>
                </section>

                <section>
                  <h4 className="font-bold text-[#161616] text-[15px] mb-3 flex items-center gap-2">
                    2. Financial & Commission Processing (Finance Tab)
                  </h4>
                  <p className="mb-3">The Finance module automatically calculates commission pools when deals are marked as "Closed Won".</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Commission Tracking:</strong> The system identifies both the "Setter" (who created the lead) and the "Closer" (who won the deal) and splits the commission accordingly.</li>
                    <li><strong>Processing Payouts:</strong> When it is time to run payroll, click the black <strong>PROCESS</strong> button next to a pending payout. This marks the commission as "Paid" and removes it from the pending liabilities.</li>
                  </ul>
                </section>

                <section>
                  <h4 className="font-bold text-[#161616] text-[15px] mb-3 flex items-center gap-2">
                    3. Global Request Approvals (Payments Tab)
                  </h4>
                  <p className="mb-3">Sales reps will generate requests for client payments and official paperwork. These must be approved to move the business forward.</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Reviewing Requests:</strong> Click <strong>VIEW</strong> to open the request details. Review the related Deal ID and read the agent's notes carefully.</li>
                    <li><strong>Approving:</strong> Once the payment is verified in your bank or the paperwork is legally cleared, click <strong>APPROVE REQUEST</strong> directly from the View Modal.</li>
                  </ul>
                </section>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------------- */}
      {/* ADMIN (TEAM LEAD) GUIDE */}
      {/* ------------------------------------------------------------------------- */}
      {role === 'ADMIN' && (
        <div className="flex flex-col gap-8">
          
          <div className="bg-white border border-[#161616]/10 shadow-sm rounded-[6px] overflow-hidden">
            <div className="bg-[#161616] px-6 py-4 flex items-center gap-3">
              <h3 className="text-lg font-bold text-white tracking-wide">Team Lead Operations Guide</h3>
            </div>
            <div className="p-6 text-sm text-[#161616]/80 leading-relaxed">
              <p className="mb-6 border-l-2 border-[#161616] pl-4 italic text-[#161616]/60">
                As a Team Lead (Admin), your primary responsibility is pipeline velocity and team oversight. You have visibility into all reps' leads, deals, and daily metrics, as well as the authority to approve operational requests.
              </p>

              <div className="space-y-8">
                <section>
                  <h4 className="font-bold text-[#161616] text-[15px] mb-3 flex items-center gap-2">
                    1. Team Monitoring & Capacity (Team Tab)
                  </h4>
                  <p className="mb-3">The Team module provides a bird's-eye view of your workforce.</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Availability Tracking:</strong> Instantly see who is Available, Busy, or Offline.</li>
                    <li><strong>Performance Metrics:</strong> Review how many open leads and deals each rep is currently juggling, as well as their daily interaction count.</li>
                    <li><strong>User Editing:</strong> If a rep forgets their password or needs to be re-assigned to a different division, click the Three-Dot menu on their card to edit their profile and reset credentials.</li>
                  </ul>
                </section>

                <section>
                  <h4 className="font-bold text-[#161616] text-[15px] mb-3 flex items-center gap-2">
                    2. Pipeline Management (Leads & Deals)
                  </h4>
                  <p className="mb-3">Unlike Sales Reps who only see their own data, you can view the entire company pipeline.</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Lead Auditing:</strong> Click into any Lead to view the interaction log. If a rep is stuck, use the "+ Add Guidance Note" feature to leave managerial advice directly on the lead record.</li>
                    <li><strong>Deal Forecasting:</strong> Monitor the Deals board to forecast revenue. Ensure reps are accurately moving deals from Discovery to Negotiation.</li>
                  </ul>
                </section>

                <section>
                  <h4 className="font-bold text-[#161616] text-[15px] mb-3 flex items-center gap-2">
                    3. Request Approvals (Payments Tab)
                  </h4>
                  <p className="mb-3">You are the first line of defense for approving operational requests.</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Validating Work:</strong> When a rep requests Paperwork or Payment processing, click <strong>VIEW</strong> to read their notes.</li>
                    <li><strong>Approval:</strong> If the request is valid, click <strong>APPROVE REQUEST</strong>. This will update the status globally and notify the team that the next steps can proceed.</li>
                  </ul>
                </section>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------------- */}
      {/* SALES REP GUIDE */}
      {/* ------------------------------------------------------------------------- */}
      {role === 'SALES_REP' && (
        <div className="flex flex-col gap-8">
          
          <div className="bg-white border border-[#161616]/10 shadow-sm rounded-[6px] overflow-hidden">
            <div className="bg-[#161616] px-6 py-4 flex items-center gap-3">
              <h3 className="text-lg font-bold text-white tracking-wide">Sales Representative Playbook</h3>
            </div>
            <div className="p-6 text-sm text-[#161616]/80 leading-relaxed">
              <p className="mb-6 border-l-2 border-[#161616] pl-4 italic text-[#161616]/60">
                Welcome to the TJGROPS CRM. Your core focus is executing the pipeline: turning new Leads into Qualified prospects, converting them into Deals, and closing revenue. The CRM automatically isolates your data so you only see what is assigned to you.
              </p>

              <div className="space-y-8">
                <section>
                  <h4 className="font-bold text-[#161616] text-[15px] mb-3 flex items-center gap-2">
                    1. The Daily Dashboard
                  </h4>
                  <p className="mb-3">Start your day on the Dashboard. This gives you a snapshot of your current performance, total deal value, and a quick-access list of your most recent Leads.</p>
                </section>

                <section>
                  <h4 className="font-bold text-[#161616] text-[15px] mb-3 flex items-center gap-2">
                    2. Lead Execution (Leads Tab)
                  </h4>
                  <p className="mb-3">The Leads tab is where top-of-funnel work happens.</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Creating Leads:</strong> Click "+ NEW LEAD" to log a new prospect. Fill in their contact info and estimated budget.</li>
                    <li><strong>Logging Interactions:</strong> Click on a Lead's name to open their Detail view. Every time you call, text, or email them, you MUST log it in the "Interaction History". This proves your activity to management.</li>
                    <li><strong>Progressing Status:</strong> As you work the lead, update the status dropdown from <em>New</em> &rarr; <em>Contacted</em> &rarr; <em>Qualified</em>.</li>
                    <li><strong>Converting:</strong> Once a Lead is qualified and ready to discuss terms, click the black <strong>CONVERT TO DEAL</strong> button. This archives the Lead and automatically generates an active Deal in your pipeline.</li>
                  </ul>
                </section>

                <section>
                  <h4 className="font-bold text-[#161616] text-[15px] mb-3 flex items-center gap-2">
                    3. Closing Revenue (Deals Tab)
                  </h4>
                  <p className="mb-3">Deals represent actual revenue opportunities.</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong>Pipeline Stages:</strong> Keep your Deals updated. Move them from <em>Discovery</em> to <em>Proposal</em> to <em>Negotiation</em>. Accurate deal stages are required for your commission calculations.</li>
                    <li><strong>Closing:</strong> When the client agrees, change the status to <strong>Closed Won</strong>. (If they back out, mark it <em>Closed Lost</em>).</li>
                  </ul>
                </section>

                <section>
                  <h4 className="font-bold text-[#161616] text-[15px] mb-3 flex items-center gap-2">
                    4. Client Onboarding (Projects Tab)
                  </h4>
                  <p className="mb-3">After winning a deal, a Project is automatically created.</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li>Use the Kanban Board or Table View in the <strong>Projects</strong> tab to track the delivery of the service to your client from <em>Onboarding</em> through <em>Completed</em>.</li>
                  </ul>
                </section>

                <section>
                  <h4 className="font-bold text-[#161616] text-[15px] mb-3 flex items-center gap-2">
                    5. Requesting Approvals (Payments Tab)
                  </h4>
                  <p className="mb-3">You cannot process payments or generate legal contracts yourself. You must request them from Administration.</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li>Go to the <strong>Payments</strong> tab and click "+ NEW REQUEST".</li>
                    <li>Select either <em>Payment</em> or <em>Paperwork</em>.</li>
                    <li>Paste the related Deal ID and write clear instructions in the Notes section for your manager.</li>
                    <li>Once an Admin reviews it, the status will change from <em>Pending</em> to <em>Approved</em>.</li>
                  </ul>
                </section>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
