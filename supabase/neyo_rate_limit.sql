-- NEYO shared rate limit (works across all Vercel servers)
-- Run once in Supabase > SQL Editor > New query > paste all > Run.
-- Safe to run again. Until it is run, NEYO falls back to per-server limits.

create table if not exists public.neyo_rate_limits (
    key text primary key,
    window_start timestamptz not null default now(),
    hits int not null default 0
);

-- only the server (service role) touches this table
alter table public.neyo_rate_limits enable row level security;

create or replace function public.neyo_rate_hit(p_key text, p_limit int, p_window_seconds int)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    r public.neyo_rate_limits;
    now_ts timestamptz := clock_timestamp();
    win interval := make_interval(secs => greatest(p_window_seconds, 1));
begin
    insert into public.neyo_rate_limits as t (key, window_start, hits)
    values (left(p_key, 200), now_ts, 1)
    on conflict (key) do update set
        window_start = case when t.window_start <= now_ts - win then now_ts else t.window_start end,
        hits = case when t.window_start <= now_ts - win then 1 else t.hits + 1 end
    returning * into r;

    -- tidy old rows now and then
    if random() < 0.01 then
        delete from public.neyo_rate_limits where window_start < now_ts - interval '1 day';
    end if;

    return json_build_object(
        'ok', r.hits <= p_limit,
        'remaining', greatest(p_limit - r.hits, 0),
        'retry_after', greatest(1, ceil(extract(epoch from (r.window_start + win - now_ts)))::int)
    );
end;
$$;

revoke all on function public.neyo_rate_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.neyo_rate_hit(text, int, int) to service_role;
