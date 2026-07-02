// Thin fetch-based Resend client. No npm dependency → no Netlify
// external_node_modules bundling concern. When RESEND_API_KEY is absent
// (dev / CI / tests) we DON'T call out: deliver() reports ok-but-undelivered
// so the caller records the send as 'logged'.
export interface OutgoingMail {
  to: string;
  from: string;
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: string }>; // content = utf-8 text
}

export interface DeliveryResult {
  ok: boolean;          // false only on a real provider/transport failure
  delivered: boolean;   // true only when actually handed to Resend
  providerId?: string;
  error?: string;
}

export async function deliver(mail: OutgoingMail): Promise<DeliveryResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: true, delivered: false }; // dev fallback → 'logged'
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
        attachments: mail.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content, 'utf-8').toString('base64'),
        })),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, delivered: false, error: `resend_${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, delivered: true, providerId: json.id };
  } catch (e) {
    return { ok: false, delivered: false, error: String((e as Error)?.message ?? e) };
  }
}
