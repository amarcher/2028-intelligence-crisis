# Shipping Pulse — deploy + verify

Phase 1 + 2 of the plan. Ships the schema, three easy sources (Freightos FBX,
BDRY via Yahoo, FRED macro), the agent API, the weekly cron, and a new
dashboard section. Harder sources (Drewry, MarineTraffic, Port of LA) are
gated on manual follow-up work.

## 1. Apply migrations

In the Supabase SQL Editor, run these two files in order:

1. `supabase/migrations/011_shipping_signals.sql`
   - Creates `shipping_signals`, `shipping_signal_scrape_log`, and the three
     views (`shipping_signals_latest`, `shipping_signals_wow`,
     `shipping_signal_source_status`). Enables public-read RLS.
2. `supabase/migrations/012_shipping_pulse_cron.sql`
   - Schedules `shipping-pulse-pull` on pg_cron (Mondays 14:15 UTC).

Both are idempotent.

## 2. Set secrets

Already set (confirm):
- `FRED_API_KEY` — reused from the existing `fetch-fred` function.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — auto-injected by Supabase.

New, required for the agent API only:
- `SIGNALS_API_TOKEN` — any long random string. The Alpaca agent sends
  this as `x-signals-token`. The UI doesn't need it (reads views via
  anon + RLS).

```bash
supabase secrets set SIGNALS_API_TOKEN=$(openssl rand -hex 32)
```

Optional (gracefully skipped if absent — Phase 3 scope):
- `DREWRY_USERNAME`, `DREWRY_PASSWORD`
- `MARINETRAFFIC_API_KEY`
- `PORT_LA_USERNAME`, `PORT_LA_PASSWORD`

## 3. Deploy functions

```bash
supabase functions deploy shipping-pulse-pull
supabase functions deploy signals-api
```

## 4. Kick the first pull manually

Before waiting for Monday's cron, fire once to populate data:

```bash
curl -X POST https://<project>.supabase.co/functions/v1/shipping-pulse-pull \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected response shape:

```json
{
  "ran_at": "...",
  "ok": 3,
  "failed": 0,
  "skipped": 0,
  "total_rows": 500,
  "results": [
    { "name": "fbx",  "status": "ok",   "rows": ~12, ... },
    { "name": "bdry", "status": "ok",   "rows": ~500, ... },
    { "name": "fred", "status": "ok",   "rows": ~360, ... }
  ]
}
```

If FBX fails with `__NEXT_DATA__ not found`, their page structure changed.
Edit `supabase/functions/shipping-pulse-pull/sources/freightos.ts` and
redeploy — BDRY and FRED will keep flowing in the meantime.

## 5. Verify in the dashboard

Load the app (dev or prod). New "Shipping Pulse" tile appears below Agent
Digest. The header chain-nav now includes a **Shipping Pulse** button.

On first pull you should see:
- FBX Global vitals with a dollar amount + WoW badge
- BDRY close (last 2y of daily data, weekly-bucketed)
- US Retail I/S ratio and imports from FRED
- Three history charts
- Source freshness footer showing `fbx · ok · today` etc.

## 6. Verify the agent API

```bash
TOKEN=<the SIGNALS_API_TOKEN you set>

curl https://<project>.supabase.co/functions/v1/signals-api/v1/snapshot \
  -H "x-signals-token: $TOKEN"

curl "https://<project>.supabase.co/functions/v1/signals-api/v1/history?source=fbx&metric=global" \
  -H "x-signals-token: $TOKEN"

curl https://<project>.supabase.co/functions/v1/signals-api/v1/status \
  -H "x-signals-token: $TOKEN"
```

## 7. Inspect cron

```sql
SELECT * FROM cron.job WHERE jobname = 'shipping-pulse-pull';
SELECT * FROM cron.job_run_details
 WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'shipping-pulse-pull')
 ORDER BY start_time DESC LIMIT 10;

-- cron.job_run_details.status = 'succeeded' only means pg_net enqueued the
-- HTTP request. The actual Edge Function response lives here:
SELECT id, status_code, created, left(coalesce(content,''), 200) AS body
FROM net._http_response
WHERE created > now() - interval '1 hour'
ORDER BY created DESC;
```

Every cron-triggered Edge Function must POST with an `Authorization: Bearer
<service_role_jwt>` header or the gateway returns 401
`UNAUTHORIZED_NO_AUTH_HEADER`. `012_shipping_pulse_cron.sql` was fixed
forward by `014_cron_auth_header.sql`, which reads the JWT from
`supabase_vault` at run time so the secret stays out of git. New cron
migrations should follow the same vault-read pattern.

## What's deferred

- **Drewry WCI** (HTML scrape with login) — highest-value source; needs a
  Playwright-based implementation, not a fetch(). Phase 3.
- **MarineTraffic** — REST API, but scarce free credits (100/mo). Needs
  `MARINETRAFFIC_API_KEY` + budgeting logic. Phase 3.
- **Port of LA Signal** — authenticated Playwright scrape; flagged as
  hard in the plan. Phase 4.
- **Weekly Claude commentary card** — plan §8. Phase 4.

Each missing source has a clear foothold: add a new file under
`supabase/functions/shipping-pulse-pull/sources/`, register it in the
`SOURCES` array in `index.ts`, and the orchestrator + logging + API
surface it automatically.
