-- Migration 132: Omnichannel campaigns — channel on campaigns + per-send.
-- email is live (via deliver()); sms/whatsapp are mock seams (no live provider).
-- Each statement on ONE line (the splitter cuts on `;` at end-of-line only).
alter table public.marketing_campaigns add column if not exists channel text not null default 'email';
alter table public.marketing_campaigns add constraint marketing_campaigns_channel_valid check (channel in ('email','sms','whatsapp'));
alter table public.campaign_sends add column if not exists channel text not null default 'email';
alter table public.campaign_sends add constraint campaign_sends_channel_valid check (channel in ('email','sms','whatsapp'));
alter table public.campaign_sends add column if not exists recipient_phone text;
-- sms/whatsapp sends have no email; relax the v1 NOT NULL (existing rows keep their email).
alter table public.campaign_sends alter column recipient_email drop not null;
