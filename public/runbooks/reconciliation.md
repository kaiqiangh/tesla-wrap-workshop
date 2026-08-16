# Reconciliation alert

`/api/profile/cleanup` returns `503 WF-RECONCILIATION-ALERT` when a cleanup or
reconciliation item fails. Inspect the correlated Vercel log, fix the storage
or database dependency, then rerun the cron endpoint; jobs remain retryable.
