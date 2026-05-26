create extension if not exists "pgcrypto";
create extension if not exists "vector";

create table if not exists public.email_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gmail_thread_id text not null unique,
  subject text not null,
  participants text[] not null default '{}',
  message_count int not null default 0,
  last_message_at timestamptz not null default now(),
  summary text,
  key_points text[] not null default '{}',
  action_items text[] not null default '{}',
  commitments text[] not null default '{}',
  needs_follow_up boolean not null default false,
  embedding vector(384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gmail_message_id text not null unique,
  gmail_thread_id text not null,
  sender text not null,
  subject text not null,
  snippet text not null,
  body_text text not null default '',
  sent_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  transcript text not null,
  summary text,
  decisions text[] not null default '{}',
  tasks text[] not null default '{}',
  unresolved_actions boolean not null default true,
  embedding vector(384),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('email', 'meeting')),
  source_ref text,
  title text not null,
  deadline_at timestamptz,
  urgency smallint not null default 0,
  status text not null default 'pending' check (status in ('pending', 'done')),
  embedding vector(384),
  created_at timestamptz not null default now()
);

create unique index if not exists tasks_user_source_ref_title_unique_idx
on public.tasks (user_id, source, coalesce(source_ref, ''), title);

create table if not exists public.user_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_gmail_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;
alter table public.meetings enable row level security;
alter table public.tasks enable row level security;
alter table public.user_sync_state enable row level security;

create policy "Users own email_threads" on public.email_threads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users own email_messages" on public.email_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users own meetings" on public.meetings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users own tasks" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users own sync state" on public.user_sync_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.match_email_threads(
  query_embedding vector(384),
  match_user_id uuid,
  match_count int default 5
)
returns table (
  gmail_thread_id text,
  subject text,
  summary text,
  key_points text[],
  action_items text[],
  commitments text[],
  similarity float
)
language sql
stable
as $$
  select
    et.gmail_thread_id,
    et.subject,
    et.summary,
    et.key_points,
    et.action_items,
    et.commitments,
    1 - (et.embedding <=> query_embedding) as similarity
  from public.email_threads et
  where et.user_id = match_user_id and et.embedding is not null
  order by et.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.match_meetings(
  query_embedding vector(384),
  match_user_id uuid,
  match_count int default 5
)
returns table (
  id uuid,
  title text,
  summary text,
  decisions text[],
  tasks text[],
  similarity float
)
language sql
stable
as $$
  select
    m.id,
    m.title,
    m.summary,
    m.decisions,
    m.tasks,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.meetings m
  where m.user_id = match_user_id and m.embedding is not null
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.match_tasks(
  query_embedding vector(384),
  match_user_id uuid,
  match_count int default 8
)
returns table (
  id uuid,
  title text,
  status text,
  source text,
  source_ref text,
  similarity float
)
language sql
stable
as $$
  select
    t.id,
    t.title,
    t.status,
    t.source,
    t.source_ref,
    1 - (t.embedding <=> query_embedding) as similarity
  from public.tasks t
  where t.user_id = match_user_id and t.embedding is not null
  order by t.embedding <=> query_embedding
  limit match_count;
$$;
