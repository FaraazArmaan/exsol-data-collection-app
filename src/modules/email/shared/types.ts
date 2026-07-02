// Shared domain types for the Email/Notifications module (vendor outbox).

export type MailTemplate = 'booking_confirmation' | 'storefront_receipt';
export type OutboxStatus = 'pending' | 'sent' | 'failed' | 'logged';

export interface OutboxRow {
  id: string;
  to_email: string;
  template: MailTemplate;
  subject: string;
  status: OutboxStatus;
  provider_id: string | null;
  error: string | null;
  body_html: string;
  created_at: string;
  sent_at: string | null;
}
