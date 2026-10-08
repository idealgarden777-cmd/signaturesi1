-- NEYO one-click app connections (MCP). Run once in Supabase > SQL Editor.
create table if not exists public.neyo_mcp (
  user_id uuid not null,
  server text not null,
  token text not null,          -- encrypted (AES-256-GCM) by the server
  account text default '',
  scopes text default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, server)
);
alter table public.neyo_mcp enable row level security;
-- No policies: only the server (service role) can read or write it.
