---
status: accepted
---

# Use Google OAuth as the only supported sign-in

WrapForge will authenticate Users through Supabase Auth's Google OAuth provider and send first-time Users through Profile onboarding. The application will remove its Email Sign-in surface and disable the Supabase Email provider because there are no production Users or existing User records to migrate; all Google accounts are eligible, with separate OAuth credentials for local, hosted development, and Production environments. This keeps the existing Supabase User/Profile boundary and avoids introducing a second session system or an account-merge policy that has no current data to serve.

## Consequences

- Google OAuth callback and Supabase session handling remain the authentication boundary.
- Profile, Username, onboarding, authorization, and audit concepts remain provider-agnostic.
- Email OTP UI, routes, tests, configuration, and retired rate-limit/database artifacts can be removed in a follow-up implementation.
- A later decision to support another provider or recover email accounts would require a new ADR.
