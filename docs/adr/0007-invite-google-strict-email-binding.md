# ADR-0007: Strict email binding for Google sign-in on invite acceptance

When a Secondary User accepts an invite via "Continue with Google" on `/invite-accept.html`, the Google account's verified email **must** equal the invite email (case-insensitive). Mismatches are rejected with `email_mismatch`; the user is told to either ask the inviter to reissue the invite to the Google email, or to use the password fallback at the invite email.

## Why

The invite is a contract between the inviter and a specific email address. The inviter chose `accountant@bobsbusiness.com` deliberately — they're routing a role to a known mailbox. Letting any Google account consume that invite would let an invitee land in the workspace under a *different* identity than the inviter expected, breaking the audit trail's "who got invited where" linkage. It would also create silent identity drift: the audit logs would show actions by `personalgmail@gmail.com` even though the membership was provisioned for `accountant@bobsbusiness.com`.

## Considered alternatives

- **Allow any Google account; keep the invite email as the user's identity** — Most flexible, but creates a confusing "this user signs in as X but their ExSol identity is Y" situation. Rejected: too easy for auditors to misread.
- **Allow mismatch with explicit confirmation** — Show "invite was for X, continue as Y?" and create the user at Y if confirmed. Rejected for v1.1: the friction of "ask your inviter to reissue" is small enough that we don't need to compromise identity clarity for it.

## Consequences

- Invitees whose work email differs from their personal Gmail must use the password path, OR get the invite reissued to their Gmail. We accept that friction.
- A future "/account/link-email" feature could let users merge identities post-acceptance if this becomes a real complaint.
