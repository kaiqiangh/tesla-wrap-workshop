# Pair application and Supabase environments through staged release

Auth, Postgres, Storage, and application code can only be trusted when they advance as one isolated Environment Pair. WrapForge therefore uses local Docker for local development and CI, introduces one dedicated hosted development pair only when Vercel Preview verification needs it, connects Production only to `main`, and applies verified committed migrations before deploying the matching application commit; Preview credentials, data, and results never stand in for Production.
