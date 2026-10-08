-- NEYO Workspaces (run once in Supabase → SQL Editor → Run)
-- Uses the same bean_users table as Bean and accounts.signaturesi.com.

create table if not exists public.neyo_workspaces (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references public.bean_users(id) on delete cascade,
  name                 text not null check (char_length(name) between 1 and 80),
  description          text not null default '',
  instructions         text not null default '',
  bean_conversation_id uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.neyo_workspace_members (
  workspace_id uuid not null references public.neyo_workspaces(id) on delete cascade,
  user_id      uuid not null references public.bean_users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  added_by     uuid references public.bean_users(id) on delete set null,
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists neyo_workspace_members_user_idx on public.neyo_workspace_members (user_id);

create table if not exists public.neyo_workspace_items (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.neyo_workspaces(id) on delete cascade,
  kind         text not null check (kind in ('task', 'note', 'decision', 'file')),
  title        text not null check (char_length(title) between 1 and 200),
  body         text not null default '',
  status       text check (status is null or status in ('todo', 'doing', 'done')),
  assignee_id  uuid references public.bean_users(id) on delete set null,
  file         jsonb,
  created_by   uuid references public.bean_users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists neyo_workspace_items_ws_idx on public.neyo_workspace_items (workspace_id, created_at desc);

create table if not exists public.neyo_workspace_activity (
  id           bigserial primary key,
  workspace_id uuid not null references public.neyo_workspaces(id) on delete cascade,
  user_id      uuid references public.bean_users(id) on delete set null,
  action       text not null,
  detail       text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists neyo_workspace_activity_ws_idx on public.neyo_workspace_activity (workspace_id, created_at desc);

-- Only the server (service role) reads these tables.
alter table public.neyo_workspaces enable row level security;
alter table public.neyo_workspace_members enable row level security;
alter table public.neyo_workspace_items enable row level security;
alter table public.neyo_workspace_activity enable row level security;
