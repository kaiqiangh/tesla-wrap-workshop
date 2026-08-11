# WrapForge

WrapForge is a community for distributing compatible Tesla Paint Shop Custom
Wrap files.

## Local development

Use Node 22 and the pinned pnpm version, then run the application against the
local Docker Supabase stack:

```sh
pnpm install --frozen-lockfile
pnpm exec supabase start
pnpm exec supabase db reset
pnpm dev:local
```

Open the application at `http://127.0.0.1:3000`. Local email OTP messages are
captured at `http://127.0.0.1:54324`; no external SMTP is required. The Google
PKCE entry point and callback are present locally, but real Google provider
credentials are verified only in the isolated hosted development Environment
Pair.

Run the local quality gates with:

```sh
pnpm test:db
pnpm test
pnpm test:browser:local
pnpm build:local
pnpm scan:security
```

`pnpm scan:security` expects the production build to exist and fails closed on
missing lockfile/env schema, high-or-critical dependency advisories, tracked
secret patterns, or server-only values in the client bundle.
