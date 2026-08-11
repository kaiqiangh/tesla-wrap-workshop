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

If `nvm use` says Node 22 but `node --version` still prints `v26.x`, check
`command -v node`. In `~/.zshrc`, Homebrew's `PATH` exports must come before
the NVM block; otherwise `/opt/homebrew/bin/node` overrides NVM. After fixing
the order, open a new terminal or run:

```sh
exec zsh
cd /Users/kai/Desktop/my-repo/tesla-wrap-workshop
nvm use
command -v node       # should be ~/.nvm/versions/node/v22.../bin/node
node --version        # must print v22.x
```

If `nvm` is not installed, run `brew install nvm`, create `~/.nvm`, then run
the same commands. To use the already-installed binary for one command without
changing the shell, use:

```sh
PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" pnpm test
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

Open `http://127.0.0.1:3000`. Local email OTP messages are captured at
`http://127.0.0.1:54324`; no external SMTP is required. The Google PKCE entry
point and callback are present locally, but real Google provider credentials
are verified only in the isolated hosted development Environment Pair.

For a direct Next.js run using `.env` instead of the wrapper, use `pnpm dev`.
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
