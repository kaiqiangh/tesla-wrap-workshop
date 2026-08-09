# Creator upload prototype

> PROTOTYPE — throwaway UI, no persistence and no real upload, database, or publication mutation.

Three variants of the four-step Creator upload and publishing journey, switchable with `?variant=`, on a standalone prototype page because WrapForge does not yet have an application route to host it.

Run from the repository root:

```sh
python3 -m http.server 4173 -d prototypes/creator-upload
```

Then open <http://127.0.0.1:4173/?variant=A>.

## Variants

- `A` — Guided studio: step rail, focused work surface, persistent Wrap summary.
- `B` — Validation pipeline: horizontal stage flow with the trust boundary visually central.
- `C` — Publish checklist: all requirements visible together with a sticky readiness inspector.

Use the bottom switcher or the left/right arrow keys to change variants. Use the state control to inspect all URL-backed prototype state. Try the file scenarios to see client preflight, authoritative server validation, expiration, retry, publish, and unpublish states.

## Question

What concrete four-step Creator experience best handles exact Active Template Variant selection, private direct upload, client preflight, authoritative validation, metadata and rights confirmation, preview, failure recovery, publish/unpublish, and useful errors?

## Accepted recommendation

Use a deliberate hybrid:

- Keep Variant A's focused four-step studio as the primary shell: a labelled rail on desktop and compact numbered steps on mobile.
- Use Variant B's visible trust boundary inside Upload File so the Creator can distinguish fast client preflight, private direct upload, and authoritative server validation.
- Use Variant C's publication-readiness checklist in Preview & Publish, with exactly one primary Publish action. Keep the public compatibility wording beside the preview.
- Treat validation failure or expiry as the end of that Pending Upload. Retry creates a fresh owner-scoped upload; it never mutates a failed or completed Asset Revision.
- After publication, show the public route and one explicit Unpublish action. Unpublishing returns the Wrap to Creator-only visibility without deleting immutable assets or metrics.

## Browser verification

- 1440 × 1000: all three variants render without horizontal overflow; variant switching updates the URL and works with left/right arrow keys.
- 390 × 844: the checklist layout has no horizontal overflow, one visible Publish action, and content controls at least 43 px high.
- Exercised local size rejection, server decode failure, fresh-upload retry, successful validation, rights and template assertions, publish, and unpublish.
- Exercised the Cybertruck `1024 × 768` exception: a square PNG is rejected with `WF-UPLOAD-DIMENSIONS`, while a matching non-square PNG can become READY.
- Browser console: zero errors and zero warnings after adding the inline prototype favicon.

## Captures

- `desktop-a-guided-studio.png`
- `desktop-a-publish-ready.png`
- `desktop-b-validation-pipeline.png`
- `mobile-c-publish-checklist.png`
