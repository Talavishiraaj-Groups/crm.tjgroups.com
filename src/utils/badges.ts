/**
 * TJGROPS CRM — Monochromatic Status Utilities
 * 
 * Enterprise-grade status system using only the brand palette.
 * State is communicated through weight, opacity, border, and fill — not color.
 * 
 * Visual hierarchy:
 *   Tier 1 (Filled)    → bg-[#161616] text-white           — Primary / Active / Won
 *   Tier 2 (Tinted)    → bg-[#DFDFDF] text-[#161616]       — Neutral / In Progress
 *   Tier 3 (Outlined)  → border border-[#161616]/30 text-[#161616]/70  — Secondary / New
 *   Tier 4 (Ghost)     → text-[#161616]/40                 — Archived / Offline
 */

export const STATUS_BADGE = {
  // Lead status
  New:        'border border-[#161616]/25 text-[#161616]/70 bg-transparent',
  Contacted:  'bg-[#DFDFDF] text-[#161616]',
  Qualified:  'bg-[#161616] text-white',
  Closed:     'bg-[#161616] text-white',

  // Deal status
  Open:       'bg-[#DFDFDF] text-[#161616]',
  Won:        'bg-[#161616] text-white',
  Lost:       'border border-[#161616]/20 text-[#161616]/40 line-through',

  // Project status
  Onboarding: 'border border-[#161616]/25 text-[#161616]/70',
  InProgress: 'bg-[#DFDFDF] text-[#161616]',
  Completed:  'bg-[#161616] text-white',

  // Payout status
  Pending:    'border border-[#161616]/25 text-[#161616]/70',
  Processing: 'bg-[#DFDFDF] text-[#161616]',
  Paid:       'bg-[#161616] text-white',

  // Payment/Paperwork status
  Sent:       'bg-[#DFDFDF] text-[#161616]',
  Signed:     'bg-[#161616] text-white',
  Failed:     'border border-[#161616]/20 text-[#161616]/40',
  Drafting:   'border border-[#161616]/20 text-[#161616]/50',
  Archived:   'text-[#161616]/30',
} as const;

export const ROLE_BADGE = {
  SUPER_ADMIN: 'bg-[#161616] text-white',
  ADMIN:       'bg-[#DFDFDF] text-[#161616]',
  SALES_REP:   'border border-[#161616]/25 text-[#161616]/70',
} as const;

export const AVAIL_BADGE = {
  Available: 'text-[#161616]',
  Busy:      'text-[#161616]/50',
  Offline:   'text-[#161616]/25',
} as const;

export const AVAIL_DOT = {
  Available: 'bg-[#161616]',
  Busy:      'bg-[#161616]/40',
  Offline:   'bg-[#161616]/15',
} as const;

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN:       'Administrator',
  SALES_REP:   'Sales Rep',
};

// Generic badge class
export const badge = (variant: keyof typeof STATUS_BADGE) =>
  `px-2 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[variant]}`;
