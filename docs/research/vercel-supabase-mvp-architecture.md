# WrapForge MVP: Vercel + Supabase architecture research

**Research date:** 2026-08-09
**Scope:** Current constraints and an MVP architecture for the PRD's `Upload -> Discover -> Download -> Use` loop. Sources are first-party documentation only. Statements labelled **Fact** are sourced platform behavior; statements labelled **Recommendation (inference)** are design conclusions for WrapForge.

## Changelog check and version baseline

- **Fact:** Supabase's current changelog says its JavaScript client libraries dropped Node.js 20 support on 2026-06-30. It also says new tables are no longer automatically exposed through the Data and GraphQL APIs by default, with enforcement for all projects scheduled for 2026-10-30. New Free-tier projects using the default SMTP service can no longer customize auth email templates. ([Supabase changelog](https://supabase.com/changelog.md))
- **Fact:** The same changelog deprecates explicit extension-version pinning and removes the Management API `logs.all` endpoint on 2026-09-23. Neither change should affect the MVP unless migrations pin extensions or CI queries that legacy log endpoint. ([Supabase changelog](https://supabase.com/changelog.md))
- **Recommendation (inference):** Standardize local, CI, and Vercel runtimes on Node.js 22; pin package and CLI versions in the lockfile/workflows. Make every Data API grant explicit in migrations instead of assuming that a `public` table is reachable.

## Recommended system boundary

Use one Next.js App Router application on Vercel and one Supabase environment per trust boundary:

```text
Browser
  -> Next.js Server Components (public reads/SSR/SEO)
  -> Server Actions (authenticated form mutations)
  -> Route Handlers (OAuth callback, upload lifecycle, guest download)
       -> Supabase Auth
       -> Postgres + RLS
       -> Storage

Local code -> local Supabase CLI
dev / Vercel Preview -> hosted development Supabase
main / Vercel Production -> production Supabase
```

**Recommendation (inference):** Default all server code, especially file inspection and thumbnail generation, to the Vercel Node.js runtime. Reserve Client Components for interactive controls and direct-to-Storage transfer. Keep Supabase and Storage behind small application adapters so moving object storage later does not leak provider-specific URLs through the domain model.

## Next.js App Router SSR and Auth

- **Fact:** Supabase's current SSR guidance uses `@supabase/ssr`, separate browser and server clients, and cookies. Because Server Components cannot write cookies, a Next.js `proxy.ts` refreshes tokens and writes refreshed cookies to both the request and response. Supabase says to protect pages/data with `auth.getClaims()` (or `getUser()` when a fresh Auth-server record is required), and explicitly says not to trust the user object from `getSession()` for server authorization. ([Supabase SSR client guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs))
- **Fact:** Supabase warns that caching a response which writes `Set-Cookie` can expose one user's session to another user. ([Supabase SSR client guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs))
- **Fact:** Next.js recommends treating Server Actions and Route Handlers as public-facing endpoints and performing authorization checks inside each action/handler, not only in page-level UI. ([Next.js authentication guide](https://nextjs.org/docs/app/guides/authentication))
- **Recommendation (inference):** Use Server Components for public discovery/detail/profile reads; use Server Actions for small authenticated mutations; use Route Handlers where HTTP semantics matter (OAuth callback, upload finalization, download redirect). Verify identity and authorization again at every mutation boundary, and never cache a personalized response or a response that refreshes auth cookies.

## Email OTP and Google authentication

- **Fact:** Email OTP is enabled by default, uses `signInWithOtp()` followed by `verifyOtp()`, and requires the email template to contain `{{ .Token }}` rather than the Magic Link. The default resend window is 60 seconds and default expiry is one hour. By default `signInWithOtp()` creates a user unless `shouldCreateUser: false` is set. ([Supabase passwordless email guide](https://supabase.com/docs/guides/auth/auth-email-passwordless))
- **Fact:** Supabase's built-in SMTP service is for non-production testing, sends only to authorized team addresses, and is currently limited to two messages per hour. Supabase recommends custom SMTP for production. ([Supabase custom SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp))
- **Fact:** For Google OAuth with SSR/PKCE, `signInWithOAuth()` must redirect to an allow-listed application callback which exchanges the returned code for a session. Google's OAuth client must also use the Supabase project callback URI; local Supabase uses `http://127.0.0.1:54321/auth/v1/callback`. ([Supabase Google login guide](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls))
- **Recommendation (inference):** Implement six-digit email OTP plus Google OAuth. Give local, development, preview, and production projects separate Google credentials where practical; configure exact production/dev callback URLs and the documented Vercel preview wildcard only for preview. Use custom SMTP, CAPTCHA, and tuned Auth rate limits before public launch. Do not reuse production OAuth/SMTP secrets in Preview.

## Storage, upload, and image validation

- **Fact:** Supabase buckets are private by default. Private downloads require an authenticated request allowed by `storage.objects` RLS or a time-limited signed URL; public buckets bypass access control for serving/downloading. Bucket configuration can restrict MIME types and file size. ([Storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control))
- **Fact:** Standard Supabase uploads are recommended for files up to 6 MB. The WrapForge maximum is 1 MB, so resumable upload is unnecessary for the MVP. ([Standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads))
- **Fact:** A Vercel Function request or response body is limited to 4.5 MB; Node.js Functions have finite memory, duration, and bundle limits. ([Vercel Functions limits](https://vercel.com/docs/functions/limitations))
- **Fact:** Supabase can serve transformed images and can sign transformed private URLs, but Storage image transformations require Pro or above. ([Storage image transformations](https://supabase.com/docs/guides/storage/serving/image-transformations))
- **Recommendation (inference):** Use three asset boundaries:
  1. a private `wrap-staging` bucket for pending uploads;
  2. a private `wrap-originals` bucket for validated downloadable PNGs;
  3. derived preview/thumbnail objects kept private until publication. Published derivatives may be copied to a public CDN bucket for best cacheability only if the product accepts that a previously known asset URL is not instantly revocable; otherwise serve short-lived signed derivatives through stable application URLs.
- **Recommendation (inference):** Create a pending-upload row server-side and generate a random storage key under the authenticated user's namespace. Upload the 1 MB PNG directly from the browser to Supabase Storage under RLS, avoiding the Vercel 4.5 MB proxy ceiling and unnecessary double transfer. Do not upsert user uploads.
- **Recommendation (inference):** Finalization runs in a Node.js Route Handler: fetch the staged object; enforce configured byte size; verify PNG extension, declared MIME, eight-byte PNG signature, decodability, and configured dimensions; decode with a bounded pixel limit; generate web preview/thumbnail; move/copy the validated original to its final random key; and commit asset metadata/status only after every required object exists. On any failure, leave a recoverable pending record and delete staging objects asynchronously/idempotently. Client checks improve UX, but this server pass is authoritative.
- **Recommendation (inference):** The PRD's 1 MB and 1024 x 1024 maxima make bounded `sharp` processing practical inside a Node.js Function, but keep image processing out of Edge runtime and set explicit time/memory/pixel guards. Do not use `next/image` as the validation pipeline; it is a display optimizer, not authoritative ingestion validation.

## Secure guest downloads and deduplicated counting

- **Fact:** Supabase signed URLs share a private object for a fixed period and support a download disposition. Signed URLs remain valid until expiry, so keep their TTL short. ([Serving Storage assets](https://supabase.com/docs/guides/storage/serving/downloads), [`createSignedUrl`](https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl))
- **Recommendation (inference):** Make `POST /api/wraps/{id}/download` the only public original-download entry point. It should:
  1. validate the identifier and rate limit abuse;
  2. create/read an opaque, random, `HttpOnly`, `Secure`, `SameSite=Lax` guest-session cookie;
  3. HMAC that token before database storage (never persist raw IP);
  4. create a very short-lived signed URL for the private original;
  5. call one database transaction that rechecks `PUBLISHED`, applies the ten-minute dedupe gate, inserts a counted `DownloadEvent`, and increments the cached counter only when the gate opens;
  6. return a redirect or the signed URL only if the transaction succeeds.
- **Recommendation (inference):** Implement the rolling gate with a table unique on `(wrap_id, session_hash)` and an atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE last_counted_at <= now() - interval '10 minutes' RETURNING ...`. Only a returned row inserts the event and increments the wrap count in that same transaction. This is concurrency-safe and more accurate than a fixed ten-minute time bucket. Cookie deletion can evade it, which is acceptable for the PRD's “obvious duplicate” requirement; rate limiting remains a separate control.

## RLS and administrator authorization

- **Fact:** Supabase recommends RLS on every exposed table. Storage access is also enforced with RLS on `storage.objects`; a Storage upsert requires `INSERT`, `SELECT`, and `UPDATE` policies. ([Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control))
- **Fact:** `raw_user_meta_data` is user-editable and unsafe for authorization. `raw_app_meta_data` can hold authorization data, but JWT claims are stale until refresh. Views bypass RLS by default unless created with `security_invoker = true` on Postgres 15+. Service keys bypass RLS and must never reach the browser. ([Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security))
- **Recommendation (inference):** Grant only required operations explicitly, then add ownership/status policies for each table. Public reads expose only `PUBLISHED` and non-deleted records; creators can mutate only their own records; social rows use user ownership plus database uniqueness; counters and moderation fields are never directly client-writable. Test positive and negative cases for `anon`, `authenticated`, owner, non-owner, suspended user, and admin.
- **Recommendation (inference):** Keep administrator membership in a non-user-editable database table and perform a fresh lookup for each admin request. A server-only privileged client may execute the final moderation operation only after verified claims plus that fresh lookup. Isolate the service key in one server-only module, never use it for ordinary user flows, and log every moderation action. This avoids depending solely on stale `app_metadata` for revocation-sensitive access.

## Environment isolation, migrations, and CI

- **Fact:** Vercel provides Development, Preview, and Production environments with separately scoped variables; Preview variables may also be branch-specific. Changes affect only new deployments. ([Vercel environments](https://vercel.com/docs/deployments/environments), [Vercel environment variables](https://vercel.com/docs/environment-variables))
- **Fact:** Supabase Branches are isolated instances with separate API credentials and no copied production data. Persistent branches suit long-lived development/staging; ephemeral preview branches suit PRs. Supabase's Vercel integration updates matching Preview variables and automatically redeploys because initial provisioning can race the Vercel build. Branching requires Pro; CLI/GitHub deployment without branching works on all plans. ([Supabase branching](https://supabase.com/docs/guides/deployment/branching), [Vercel branching integration](https://supabase.com/docs/guides/deployment/branching/integrations), [Supabase deployment overview](https://supabase.com/docs/guides/deployment))
- **Recommendation (inference):** Use local Supabase for local tests; map Vercel Preview from `dev` to a dedicated development Supabase project or persistent branch; map Vercel Production from `main` only to the production project. Never expose production database/storage/service credentials to Preview. If Pro branching is enabled, pair each feature PR's Vercel Preview with its Supabase Preview Branch; otherwise serialize schema-affecting Preview tests against the shared development project.
- **Fact:** Supabase recommends committed migrations, `supabase db reset` to replay them locally, automated CI/CD rather than manual production pushes, and database/RLS tests on every PR. Supabase Branching automatically applies committed migrations and can make its preview status a required GitHub check. ([Managing environments](https://supabase.com/docs/guides/deployment/managing-environments), [Database testing](https://supabase.com/docs/guides/local-development/testing/overview), [GitHub integration](https://supabase.com/docs/guides/deployment/branching/github-integration))
- **Recommendation (inference):** Treat `supabase/migrations`, `config.toml`, seed data, generated TypeScript database types, and pgTAP/RLS tests as versioned source. CI should start a clean local Supabase, replay migrations, lint the database, run database/RLS tests, regenerate and diff types, then run application typecheck/unit/integration tests and a production Next.js build. Deploy migrations to development from `dev`; deploy production only after the user merges the reviewed `dev -> main` PR.

## Analytics and observability

- **Fact:** Vercel Web Analytics automatically tracks page loads and client-side transitions without third-party cookies; visitor identity uses a request-derived hash discarded after 24 hours. Custom events are plan-dependent (not included on Hobby), and event/property quotas vary by plan. ([Web Analytics privacy](https://vercel.com/docs/analytics/privacy-policy), [Web Analytics pricing and limits](https://vercel.com/docs/analytics/limits-and-pricing), [Web Analytics quickstart](https://vercel.com/docs/analytics/quickstart))
- **Fact:** Vercel Speed Insights supplies route-level real-user performance data and integrates in an App Router root layout. ([Speed Insights quickstart](https://vercel.com/docs/speed-insights/quickstart))
- **Recommendation (inference):** Use Vercel Web Analytics for anonymous page traffic and Speed Insights for Core Web Vitals. Record durable product/business events in Supabase, server-side at the successful transaction boundary wherever possible (`wrap_download`, publish, like, follow, comment, report); accept validated client events only for UI-only steps such as search/filter/upload-start. Never include email, raw IP, free text, object keys, auth tokens, or exact user identifiers in Vercel event properties. This satisfies the PRD on Hobby and avoids making business truth depend on ad blockers or a paid analytics tier.
- **Recommendation (inference):** Emit structured request/error logs with request IDs, operation, sanitized error code, duration, and environment. Do not log OTPs, cookies, signed URLs, service keys, user content, or raw storage/backend errors.

## Deployment and verification gates

- **Fact:** Vercel creates Preview deployments for non-production branches/PRs and Production deployments from the production branch. `vercel inspect` can wait for completion and show build logs; `vercel logs` filters runtime logs by deployment, environment, level, status, request ID, or time. ([Vercel environments](https://vercel.com/docs/deployments/environments), [`vercel inspect`](https://vercel.com/docs/cli/inspect), [`vercel logs`](https://vercel.com/docs/cli/logs))
- **Fact:** Vercel's current promotion guide says promoting Preview to Production performs a production rebuild using Production environment variables. A green Preview therefore does not prove Production configuration. ([Promoting a Preview deployment](https://vercel.com/docs/deployments/promote-preview-to-production))
- **Recommendation (inference):** Before merging any feature into `dev`, require application CI plus migration/RLS checks and browser journeys against the exact Vercel Preview/Supabase development pairing. Before opening `dev -> main`, rerun the complete visitor, creator, community, admin, SEO, and mobile journeys on `dev`, inspect the exact deployment/commit, and scan error logs. Open the PR but do not merge it.
- **Recommendation (inference):** After the user merges, verify the new Production build independently: confirm the commit and environment, migrations, Auth callback/OTP delivery, public reads, private upload, publish/discover, deduped guest download and original contents, admin denial/allow paths, sitemap/robots/OG output, security headers, Web Analytics/Speed Insights intake, and early 4xx/5xx/runtime logs. Production success must not be inferred from Preview success.

## Principal risks to retain in tickets

1. A public preview bucket conflicts with immediate privacy after unpublish; choose the revocation/cache contract explicitly.
2. Shared development Supabase causes cross-PR schema/data interference; use branching or serialize those tests.
3. Service-role code has total bypass power; keep it server-only, minimal, and gated by fresh admin checks.
4. Counter caches can drift unless event insertion, dedupe, and increment are one transaction and periodically reconcilable.
5. OTP launch depends on custom SMTP, template configuration, redirect allow-lists, CAPTCHA, and rate-limit verification in every environment.
