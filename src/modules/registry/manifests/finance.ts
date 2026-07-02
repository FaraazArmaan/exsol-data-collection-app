import type { ModuleManifest } from '../types';

// Finance is a vendor-side money surface: a P&L over existing revenue (read-only
// from sales + bookings) plus an expenses ledger. Money/P&L is "business" data,
// so it declares the single `business` bucket with full CRUD — view for the P&L,
// create/edit/delete for the expenses table. Bucket×verb keys only (no POS-style
// action namespace): finance.business.{view,create,edit,delete}.
export const financeManifest: ModuleManifest = {
  key: 'finance',
  label: 'Finance',
  data_buckets: ['business'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
};
