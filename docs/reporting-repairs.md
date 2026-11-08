# Reporting integrity repair

The operational digest is built from stored configuration, calculated account weights, dated signal observations and recorded order outcomes. Model prose is retained separately as unverified interpretation. Advisory, submitted and filled states remain distinct; order-size percentages are not portfolio holding targets.

Missing or stale inputs produce unknown readings and block entry execution. Revenue trends compare the same companies across adjacent quarters; market baskets require complete, aligned sessions. Corrected fast scores have a new version and reset historical smoothing. The dashboard distinguishes live evidence from archived editorial claims and legacy model reports.

The scheduler uses Eastern time and the exchange calendar. It refreshes FRED before scheduled reports, suppresses unchanged updates, retries failed notification channels independently, and replaces the duplicate portfolio email. Trading halt configuration is preserved. Dry runs do not write records, place orders or send notifications.

## Validation

Run `npm run test:repairs`, `npm run check:edge`, `npm run lint`, and `npm run build`. Tests use synthetic account figures. Edge type checks use the installed Supabase library without downloading dependencies; production bundling and runtime verification are separate checks.

## Release

Apply only migration 020 after backing up current cron definitions. Deploy agent-tick, agent-exit-check, agent-queue-flush and agent-kill-check together with the frontend. Confirm existing halt state before and after. Check scheduled no-op behavior, then a controlled halted report, delivery receipts and zero new entry orders. Do not replay historical migrations.

Rollback restores the previous function versions and saved cron definitions, leaving additive columns and audit history intact. Keep the halt unchanged. No automatic resume or strategy expansion is part of this release.

## Limits

The research score is not a validated predictive probability. Observation-age windows are not release-calendar service guarantees. Estimated earnings dates need independent confirmation. Order reconciliation uses polling; concurrently invoked manual ticks are not an exactly-once notification queue. Partial approval batches require review rather than replay.
