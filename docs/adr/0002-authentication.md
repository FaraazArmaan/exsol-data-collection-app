# ADR 0002: Authentication

- **Status:** Accepted
- **Date:** 2026-05-19

## Context

Original brief asked for Google + Apple + SMS + email-verification + username/password, separately for clients and admin. Implementing all five is multi-week work, and three of them (Apple, SMS, custom email-verification) carry recurring cost. The user base is Indian SMB clients and their team members; Gmail penetration is near-universal but not 100%.

## Decision

- **Primary:** Google Sign-In via Google Identity Services (GIS), official Google JS library.
- **Fallback:** Email + password (Argon2id hash) for the rare user without a Google account, with email verification via a transactional email provider (Resend free tier).
- **Dropped:** Apple ID login, SMS OTP, separate admin login mechanism.
- **Admin vs client distinction lives in the DB**, not in separate login pages. After a successful sign-in, the Netlify Function looks up the user's role (`admin` | `primary` | `secondary`) and redirects accordingly.
- **Session:** Netlify Function issues a signed JWT in an HTTP-only, Secure, SameSite=Lax cookie. Short access token (15 min) + refresh token (30 days) pattern.
- **Admin account safety:** 2FA mandatory on the admin's Google account; an emergency-recovery escape hatch (a second admin email or a sealed recovery code) must exist before launch.

## Consequences

- New users cannot self-sign-up — every account must be either (a) the admin, (b) a primary client onboarded by the admin, or (c) a secondary user invited by a primary client. Sign-in for an unknown email is rejected. This matches the "admin onboards clients" model in the brief.
- We must verify the Google ID token on every sign-in server-side (`google-auth-library` package); never trust the client-side token alone.
- Email+password adds a small surface: rate-limited login endpoint, password-reset flow, breach-database check on registration.
- The admin's Gmail account becomes a single point of failure; ADR-TBD must define the recovery procedure.

## Alternatives considered

- **Supabase Auth** — would have absorbed all five providers cleanly. Rejected because the user is happy with Google-only-plus-fallback, and Supabase adds a third dashboard alongside Netlify and Neon.
- **Clerk** — same logic. Also React-leaning when our frontend is plain HTML/JS.
- **Firebase Auth** — viable but ties us to a Firebase project for one feature.
- **Full custom build** — explicitly rejected; we're not in the auth business.
