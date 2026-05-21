import { opt } from './env.ts';

export type SendInviteEmailInput = {
  to: string;
  inviteLink: string;
  workspaceName: string;
  inviterName: string;
  role: string;
};

export type SendInviteEmailResult =
  | { sent: true; provider: 'resend'; id: string }
  | { sent: false; reason: 'no_api_key'; fallbackLink: string }
  | { sent: false; reason: 'send_failed'; detail: string; fallbackLink: string };

/**
 * Feature-flagged invite email.
 *
 * If RESEND_API_KEY is unset, returns the fallback link in the response
 * so the caller can show "copy this link" UX. When the env var is set
 * later (Netlify Site → Environment variables), emails start flowing
 * automatically with no code change.
 */
export async function sendInviteEmail(input: SendInviteEmailInput): Promise<SendInviteEmailResult> {
  const apiKey = opt('RESEND_API_KEY');
  const from = opt('RESEND_FROM_EMAIL') ?? 'ExSol <onboarding@resend.dev>';
  if (!apiKey) {
    return { sent: false, reason: 'no_api_key', fallbackLink: input.inviteLink };
  }

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to: input.to,
      subject: `You're invited to ${input.workspaceName} on ExSol`,
      html: renderHtml(input),
      text: renderText(input),
    });
    if (result.error) {
      return {
        sent: false,
        reason: 'send_failed',
        detail: result.error.message,
        fallbackLink: input.inviteLink,
      };
    }
    return { sent: true, provider: 'resend', id: result.data?.id ?? '' };
  } catch (err) {
    return {
      sent: false,
      reason: 'send_failed',
      detail: (err as Error)?.message ?? String(err),
      fallbackLink: input.inviteLink,
    };
  }
}

function renderHtml(i: SendInviteEmailInput): string {
  const safeWs = escapeHtml(i.workspaceName);
  const safeInviter = escapeHtml(i.inviterName);
  const safeRole = escapeHtml(i.role);
  const safeLink = escapeHtml(i.inviteLink);
  return `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.5; color: #1a1a1a;">
<div style="max-width: 560px; margin: 2rem auto; padding: 0 1rem;">
  <h1 style="font-size: 1.4rem;">You're invited to ${safeWs}</h1>
  <p>${safeInviter} has invited you to join <strong>${safeWs}</strong> on ExSol as a <strong>${safeRole}</strong>.</p>
  <p style="margin: 2rem 0;">
    <a href="${safeLink}" style="display: inline-block; padding: 0.7rem 1.5rem; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px;">Accept invitation</a>
  </p>
  <p style="font-size: 0.85rem; color: #6b7280;">If the button doesn't work, paste this link into your browser:<br><a href="${safeLink}">${safeLink}</a></p>
  <p style="font-size: 0.85rem; color: #6b7280;">This invitation expires in 7 days.</p>
</div>
</body></html>`;
}

function renderText(i: SendInviteEmailInput): string {
  return `You're invited to ${i.workspaceName}\n\n${i.inviterName} has invited you to join ${i.workspaceName} on ExSol as a ${i.role}.\n\nAccept the invitation:\n${i.inviteLink}\n\nThis invitation expires in 7 days.\n`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
