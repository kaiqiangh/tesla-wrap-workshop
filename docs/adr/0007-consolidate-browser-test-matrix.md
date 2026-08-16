---
status: accepted
---

# Consolidate the browser test matrix and reduce run cost

WrapForge's Playwright suite defined eleven projects (three engines plus eight viewport-only variants), executed serially with one worker against a `next dev` server after a full `supabase db reset` on every invocation. On a developer laptop this saturated memory and took minutes, while the viewport variants added little signal: mobile-chrome (Pixel 7) and mobile-safari (iPhone 13) already covered the mobile boundary, and the remaining variants re-ran the same tests at slightly different widths. The suite will run the five engine-and-mobile projects (chromium, firefox, webkit, mobile-chrome, mobile-safari), skip the database reset when migrations and seed are unchanged, record trace only on failure and stop recording video, and run with two workers.

## Consequences

- The default `test:browser` command runs chromium + mobile-chrome; `test:browser:compat` runs the full five-project matrix; `test:browser:full` remains the exhaustive gate.
- The six viewport-only projects (viewport-360, reflow-320, mobile-landscape, tablet-portrait, tablet-landscape, desktop-1440) are removed. If a viewport regression is reported, a single focused project can be reintroduced with an ADR note.
- Browser tests seed their own identity and data fixtures, so a reset is only required when `supabase/migrations/` or the seed changes; a stale-database check guards the conditional reset.
- Recording policy: `video` off, `trace` on-failure, `screenshot` on-failure. Debugging a rare failure may require a one-off run with recording re-enabled.
- CI reuses the production build for the browser gate instead of running `next dev`, which lowers memory and page-load latency in the gate; local runs keep `next dev` for iteration speed.
- CI runs the fast default command (chromium + mobile-chrome) as its gate. The cross-engine compatibility and exhaustive matrices remain available as `test:browser:compat` and `test:browser:full`, and a release reviewer exercises them against the Release Candidate as part of Release Evidence (per ADR-0005); the matrix consolidation does not weaken that release authority, it removes redundant viewport duplication that produced no additional engine signal.
