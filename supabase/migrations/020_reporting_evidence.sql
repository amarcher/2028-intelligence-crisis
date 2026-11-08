-- Additive repair. Does not resume trading or change risk limits.
alter table public.agent_digests add column if not exists operational_report jsonb;
alter table public.agent_digests add column if not exists model_narrative text;
alter table public.agent_digests add column if not exists delivery_fingerprint text;
alter table public.agent_digests add column if not exists delivery_suppressed boolean not null default false;
comment on column public.agent_digests.model_narrative is 'Unverified model interpretation, never execution evidence. Retained for audit only.';
-- The evidence-based close digest replaces this duplicate daily email.
do $$
declare job record;
begin
  for job in select jobid from cron.job where jobname = 'portfolio-report-daily' loop
    perform cron.unschedule(job.jobid);
  end loop;
end $$;

alter table public.agent_snapshots add column if not exists scheduled_key text;
create unique index if not exists agent_snapshots_scheduled_key on public.agent_snapshots(scheduled_key) where scheduled_key is not null;
-- Dispatcher uses America/New_York and Alpaca's exchange calendar. Post-close
-- means 15 minutes AFTER the actual close, including shortened sessions.
do $$
declare job record;
begin
  for job in select jobid from cron.job where jobname in ('agent-tick-premarket','agent-tick-close','agent-tick-weekly') loop
    perform cron.unschedule(job.jobid);
  end loop;
end $$;
select cron.schedule('agent-tick-session', '0,15 12-22 * * 1-5', $$
  select net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/agent-tick',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)),
    body := '{"scheduled":true}'::jsonb
  );
$$);

-- A partially submitted approval is held for review, never silently marked done
-- or automatically replayed. A crashed 'running' attempt also needs review.
alter table public.agent_approvals add column if not exists execution_status text not null default 'pending';
alter table public.agent_approvals add column if not exists execution_errors jsonb not null default '[]'::jsonb;
