# Make browser journeys and database policies the release authority

WrapForge crosses browser, application, Postgres, Auth, and Storage trust boundaries, so line coverage and isolated tests cannot prove P0 behavior. A Release Candidate must therefore pass real browser journeys against its exact Environment Pair and exhaustive database, RLS, Storage-policy, and state-transition tests, supported by focused unit and integration tests; no global coverage percentage or raw test count substitutes for these gates, and a failure at the highest relevant seam blocks release.
