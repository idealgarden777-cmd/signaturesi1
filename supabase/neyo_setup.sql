-- NEYO setup: run once in Supabase > SQL Editor > New query > paste all > Run

create table if not exists public.neyo_packs (
    id bigserial primary key,
    user_id uuid not null,
    conversation_id text,
    question text not null,
    question_hash text not null,
    kind text not null default 'text',
    lang text,
    chunk_index int not null default 0,
    content text not null,
    search tsvector generated always as (
        to_tsvector('simple', coalesce(question, '') || ' ' || content)
    ) stored,
    created_at timestamptz not null default now()
);

create index if not exists neyo_packs_search_idx on public.neyo_packs using gin (search);
create index if not exists neyo_packs_hash_idx on public.neyo_packs (user_id, question_hash, created_at desc);
create index if not exists neyo_packs_user_idx on public.neyo_packs (user_id, created_at desc);

-- only the server (service role) reads and writes packs
alter table public.neyo_packs enable row level security;

create or replace function public.neyo_pack_search(p_user uuid, p_query text, p_limit int default 8)
returns table (id bigint, question text, kind text, lang text, content text, conversation_id text, rank real)
language sql stable
as $$
    select p.id, p.question, p.kind, p.lang, p.content, p.conversation_id,
           ts_rank(p.search, q) as rank
    from public.neyo_packs p, to_tsquery('simple', p_query) q
    where p.user_id = p_user and p.search @@ q
    order by rank desc, p.created_at desc
    limit greatest(1, least(p_limit, 20));
$$;

revoke all on function public.neyo_pack_search(uuid, text, int) from public, anon, authenticated;
grant execute on function public.neyo_pack_search(uuid, text, int) to service_role;

-- keep it small: packs older than 90 days can be cleaned with
-- delete from public.neyo_packs where created_at < now() - interval '90 days';

create table if not exists public.neyo_memory (
    user_id uuid not null,
    key text not null,
    value text not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, key)
);

create index if not exists neyo_memory_user_idx on public.neyo_memory (user_id, updated_at desc);

-- only the server (service role) reads and writes memory
alter table public.neyo_memory enable row level security;
