# WrapForge

WrapForge is a community for distributing compatible Tesla Paint Shop Custom
Wrap files.

## Local development

### 1. Switch from Node 26 to the pinned Node 22

This repository declares `node: 22.x` in `package.json` and pins the major
version in both `.nvmrc` and `.node-version`. Node 26 will be rejected by pnpm.

On macOS with Homebrew NVM, load NVM in the current terminal and select the
repository version:

```sh
export NVM_DIR="$HOME/.nvm"
source /opt/homebrew/opt/nvm/nvm.sh
nvm install 22       # no-op when Node 22 is already installed
nvm use               # reads .nvmrc; selects the installed v22.x
nvm alias default 22  # optional: use Node 22 in new terminals
node --version        # must print v22.x
```

If `nvm` is not installed, run `brew install nvm`, create `~/.nvm`, then run
the same commands. To use Node 22 for one command without changing the shell,
use:

```sh
nvm exec 22 pnpm test
```

Enable the pinned pnpm release once per Node installation:

```sh
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm --version        # must print 11.16.0
```

### 2. Start local Supabase and the app

The ignored `.env` file is already created for this checkout from the local
Supabase credentials. Never commit it. The `:local` scripts also read the
running Supabase stack and inject the matching values automatically, so they
are the recommended path:

```sh
pnpm install --frozen-lockfile
pnpm exec supabase start
pnpm exec supabase db reset
pnpm dev:local
```

Open `http://127.0.0.1:3000`. Sign-in is Google-only. Local Google OAuth uses
the Supabase callback `http://127.0.0.1:54321/auth/v1/callback`, then returns to
the app callback at `http://127.0.0.1:3000/auth/callback`.

The local Supabase CLI stack includes Auth, PostgREST, Storage, Kong, and
Realtime in addition to Postgres; the app needs those services for Google
sessions, RLS-backed API calls, and private media. Stop the whole local stack
when you are finished with `pnpm exec supabase stop` rather than deleting one
container by hand.

To enable real local Google sign-in, put the OAuth client values in the ignored
`.env` file (never commit them):

```dotenv
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=...
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=...
```

Keep `enabled = true` in `[auth.external.google]` in `supabase/config.toml`,
restart Supabase, and run `pnpm dev:local`. Keep a separate Google OAuth
client and Supabase credentials for each hosted Environment Pair
(development/preview and production).

OAuth callback matrix:

| Environment Pair           | Google Authorized redirect URI                | Supabase Auth redirect allow-list               |
| -------------------------- | --------------------------------------------- | ----------------------------------------------- |
| Local                      | `http://127.0.0.1:54321/auth/v1/callback`     | `http://127.0.0.1:3000/auth/callback`           |
| Hosted Development/Preview | `<development-supabase-url>/auth/v1/callback` | `<preview-or-development-origin>/auth/callback` |
| Production                 | `<production-supabase-url>/auth/v1/callback`  | `<production-origin>/auth/callback`             |

Replace angle-bracket values with the real Environment Pair URLs in Google
Cloud and the matching Supabase Auth URL settings. Never reuse a Production
client or secret in Preview.

For Vercel Preview deployments, add
`https://*-<team-or-account-slug>.vercel.app/**` to the hosted development
project's Supabase Auth redirect allow-list as well as the exact canonical
branch callback. The app intentionally sends each sign-in back to the origin
that owns the browser's PKCE cookie; replacing that callback with the Site URL
can make the code exchange fail.

In each hosted Supabase project, disable the Email provider in Auth →
Providers. The repository migration retires the OTP RPCs and policies, but
dashboard provider state is intentionally configured per project.

For CI and unit tests, Google is represented by an admin-created test identity;
no email OTP or Mailpit flow is supported. For a direct Next.js run using `.env`
instead of the wrapper, use `pnpm dev`.
If the local Supabase project is recreated and its keys change, rerun
`pnpm exec supabase status -o json` and refresh the ignored `.env` values; the
`:local` scripts avoid this manual step.

### 3. Run the local quality gates

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
