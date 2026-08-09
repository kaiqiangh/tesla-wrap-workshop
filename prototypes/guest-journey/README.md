# Guest discovery and download prototype

PROTOTYPE — throwaway UI used to settle the guest journey. Do not promote this code directly into the application.

Question: What concrete mobile-first public experience best communicates artwork, exact Template Variant compatibility, availability caveats, creator identity, community proof, safe download, and Tesla App/USB use without visual clutter or implied Tesla affiliation?

Three structurally different variants share one read-only journey and are switchable with `?variant=A|B|C`:

- A — Artwork editorial
- B — Compatibility navigator
- C — Creator magazine

Run from the repository root:

```sh
python3 -m http.server 4173 -d prototypes/guest-journey
```

Then open <http://127.0.0.1:4173/?variant=A>. Use the bottom switcher or Left/Right arrow keys to compare variants. All state is in the URL and the prototype state panel; the Download action is a stub and never serves a file.
