-- SkillRot database schema (PRD §7.2)
-- Run this in the Supabase SQL Editor, or: supabase db execute --file supabase/schema.sql
--
-- Supabase is OPTIONAL. Without it the app falls back to an in-process store so
-- the demo flow still works end to end (see src/lib/store.ts).

create extension if not exists "vector";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- users
-- `id` is text rather than uuid because the MVP has no auth (PRD §4 non-goals):
-- students are identified by an anonymous client-generated id of the form
-- "student-<uuid>". A row is created on first upload by store.ensureUser().
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id         text primary key,
  email      text unique,
  name       text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- materials — one uploaded lecture/deck/notes document
-- ---------------------------------------------------------------------------
create table if not exists public.materials (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null references public.users (id) on delete cascade,
  title      text not null,
  raw_text   text not null,
  -- 'document' → PDF/PPTX/text that becomes a video lecture.
  -- 'video'    → an uploaded video or YouTube URL that becomes structured notes.
  content_type text not null default 'document' check (content_type in ('document', 'video')),
  -- YouTube watch URL or Supabase Storage path. Null for documents.
  video_url   text,
  video_duration_seconds integer,
  -- 'slide' for .pptx decks, 'page' for PDFs and pasted text, 'timestamp' for
  -- video. Drives whether RAG citations read "Slide 4", "Page 4" or "12:04".
  source_unit text not null default 'page' check (source_unit in ('page', 'slide', 'timestamp')),
  created_at timestamptz not null default now()
);

create index if not exists materials_user_id_idx on public.materials (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- material_chunks — RAG retrieval units
-- 768 dimensions. gemini-embedding-001 natively returns 3072, so the app asks
-- the API to truncate to 768 (see EMBEDDING_DIMENSIONS in src/lib/gemini.ts):
-- pgvector cannot index vectors wider than 2000. Changing the embedding model
-- or width requires changing this column and re-embedding every chunk.
-- ---------------------------------------------------------------------------
create table if not exists public.material_chunks (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete cascade,
  chunk_index integer not null,
  chunk_text  text not null,
  page_start  integer,
  page_end    integer,
  embedding   vector(768),
  created_at  timestamptz not null default now(),
  unique (material_id, chunk_index)
);

create index if not exists material_chunks_material_idx on public.material_chunks (material_id, chunk_index);

-- IVFFlat index for cosine similarity. Postgres only uses it once the table has
-- a reasonable row count; small demo datasets fall back to a sequential scan,
-- which is still fast at this scale.
create index if not exists material_chunks_embedding_idx
  on public.material_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ---------------------------------------------------------------------------
-- learning_cards
-- ---------------------------------------------------------------------------
create table if not exists public.learning_cards (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete cascade,
  title       text not null,
  content     text not null,
  emoji       text,
  order_index integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists learning_cards_material_idx on public.learning_cards (material_id, order_index);

-- ---------------------------------------------------------------------------
-- lecture_scenes — narrated "video lecture" scenes for one learning card
--
-- Generated lazily on first view of a card and cached here, so a deck never
-- costs more Gemini calls than the student actually watches.
-- ---------------------------------------------------------------------------
create table if not exists public.lecture_scenes (
  id               uuid primary key default gen_random_uuid(),
  material_id      uuid not null references public.materials (id) on delete cascade,
  card_index       integer not null,
  scene_index      integer not null,
  narration_text   text not null,
  visual_json      jsonb not null,
  -- Populated only when a TTS provider is configured; browser speech synthesis
  -- needs no stored audio.
  audio_url        text,
  duration_seconds numeric(6,2) not null default 6,
  -- { url, credit, credit_url } for the scene's stock photo. Null when image
  -- search is unconfigured or found nothing usable.
  image_json       jsonb,
  created_at       timestamptz not null default now(),
  unique (material_id, card_index, scene_index)
);

create index if not exists lecture_scenes_card_idx
  on public.lecture_scenes (material_id, card_index, scene_index);

-- ---------------------------------------------------------------------------
-- video_notes — structured notes derived from a video material
--
-- One row per material. `status` exists because Vercel functions cannot run
-- long enough to analyse a video in one request: the client polls and each
-- request advances one step, so progress has to live somewhere durable.
-- ---------------------------------------------------------------------------
create table if not exists public.video_notes (
  id               uuid primary key default gen_random_uuid(),
  material_id      uuid not null references public.materials (id) on delete cascade,
  -- { title, sections: [{ heading, timestamp_start, bullets[], key_terms[] }] }
  notes_json       jsonb,
  status           text not null default 'pending'
                   check (status in ('pending', 'uploading', 'analysing', 'structuring', 'done', 'failed')),
  progress_message text,
  error            text,
  -- Cursor for the client-driven pipeline: each request analyses one segment,
  -- because a Vercel function cannot outlive a whole video.
  segment_index    integer not null default 0,
  segment_total    integer not null default 1,
  -- Gemini Files API URI for uploaded (non-YouTube) video. Google expires these
  -- after 48 hours, so treat it as a cache rather than a permanent reference.
  gemini_file_uri  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (material_id)
);

create index if not exists video_notes_material_idx on public.video_notes (material_id);

-- ---------------------------------------------------------------------------
-- skills — accumulates across every upload by a student
-- ---------------------------------------------------------------------------
create table if not exists public.skills (
  id                 uuid primary key default gen_random_uuid(),
  user_id            text not null references public.users (id) on delete cascade,
  skill_name         text not null,
  source_material_id uuid references public.materials (id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists skills_user_idx on public.skills (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- job_roles — curated static reference data (PRD §8)
-- The application reads this dataset from src/lib/job-roles.ts so the roadmap
-- works with no database at all. This table mirrors it for SQL-side querying.
-- ---------------------------------------------------------------------------
create table if not exists public.job_roles (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  title           text not null,
  track           text,
  required_skills text[] not null default '{}',
  description     text
);

-- ---------------------------------------------------------------------------
-- Vector similarity search RPC (PRD §7.4 step 3).
-- src/lib/retrieval.ts calls this first. If the function is missing or errors,
-- retrieval falls back to computing cosine similarity in-process, so an app
-- running without this function still answers questions correctly.
-- ---------------------------------------------------------------------------
create or replace function public.match_material_chunks (
  p_material_id uuid,
  query_embedding vector(768),
  match_count int default 4
)
returns table (
  chunk_index int,
  chunk_text  text,
  page_start  int,
  page_end    int,
  similarity  float
)
language sql stable
as $$
  select
    mc.chunk_index,
    mc.chunk_text,
    mc.page_start,
    mc.page_end,
    1 - (mc.embedding <=> query_embedding) as similarity
  from public.material_chunks mc
  where mc.material_id = p_material_id
    and mc.embedding is not null
  order by mc.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- All application access goes through the service role key on the server, which
-- bypasses RLS. RLS is enabled with no permissive policies so that the public
-- anon key cannot read another student's materials (PRD §9, data privacy).
-- ---------------------------------------------------------------------------
alter table public.materials       enable row level security;
alter table public.material_chunks enable row level security;
alter table public.learning_cards  enable row level security;
alter table public.lecture_scenes  enable row level security;
alter table public.video_notes     enable row level security;
alter table public.skills          enable row level security;
alter table public.users           enable row level security;

alter table public.job_roles enable row level security;

drop policy if exists "job_roles are publicly readable" on public.job_roles;
create policy "job_roles are publicly readable"
  on public.job_roles for select
  using (true);

-- ---------------------------------------------------------------------------
-- Seed job roles (mirrors src/lib/job-roles.ts)
-- ---------------------------------------------------------------------------
insert into public.job_roles (slug, title, track, required_skills, description) values
  ('junior-backend-developer',   'Junior Backend Developer',      'engineering', array['Data Structures','Algorithms','SQL','REST APIs','Git','Node.js','Databases'], 'Entry-level role building and maintaining backend services and APIs.'),
  ('junior-frontend-developer',  'Junior Frontend Developer',     'engineering', array['JavaScript','HTML','CSS','React','Git','Responsive Design','REST APIs'], 'Builds user-facing web interfaces and connects them to backend services.'),
  ('full-stack-developer',       'Full Stack Developer',          'engineering', array['JavaScript','React','Node.js','SQL','REST APIs','Git','Data Structures','Authentication'], 'Works across both frontend and backend of web applications.'),
  ('mobile-app-developer',       'Mobile App Developer',          'engineering', array['Mobile Development','Object-Oriented Programming','REST APIs','Git','UI Design','State Management'], 'Develops native or cross-platform applications for iOS and Android.'),
  ('qa-automation-engineer',     'QA / Automation Engineer',      'engineering', array['Testing','Debugging','Python','Git','CI/CD','Software Development Lifecycle'], 'Designs automated test suites and validates software quality before release.'),
  ('devops-engineer',            'Junior DevOps Engineer',        'engineering', array['Linux','Docker','CI/CD','Cloud Computing','Networking','Scripting','Git'], 'Automates build, deployment and infrastructure operations.'),
  ('cloud-engineer',             'Cloud Engineer',                'engineering', array['Cloud Computing','Networking','Linux','Security','Databases','Infrastructure as Code'], 'Designs and maintains cloud infrastructure on AWS, Azure or GCP.'),
  ('security-analyst',           'Information Security Analyst',  'engineering', array['Security','Networking','Cryptography','Operating Systems','Risk Assessment','Linux'], 'Monitors systems for threats and hardens infrastructure against attacks.'),
  ('embedded-systems-engineer',  'Embedded Systems Engineer',     'engineering', array['C Programming','Operating Systems','Computer Architecture','Debugging','Microcontrollers'], 'Programs low-level software that runs directly on hardware devices.'),
  ('systems-engineer',           'Systems Engineer',              'engineering', array['Operating Systems','Computer Networks','Linux','Scripting','Computer Architecture','Debugging'], 'Maintains and optimises server and operating-system level infrastructure.'),
  ('data-analyst',               'Data Analyst',                  'data',        array['SQL','Statistics','Data Visualization','Excel','Python','Critical Thinking'], 'Turns raw datasets into dashboards and insight for business decisions.'),
  ('junior-data-scientist',      'Junior Data Scientist',         'data',        array['Python','Statistics','Machine Learning','Linear Algebra','Data Visualization','SQL','Probability'], 'Builds predictive models and runs experiments on large datasets.'),
  ('machine-learning-engineer',  'Machine Learning Engineer',     'data',        array['Machine Learning','Python','Linear Algebra','Calculus','Deep Learning','Data Structures','Cloud Computing'], 'Trains and deploys machine learning models into production systems.'),
  ('data-engineer',              'Data Engineer',                 'data',        array['SQL','Python','Databases','Data Modeling','ETL','Cloud Computing','Distributed Systems'], 'Builds the pipelines that move and reshape data across an organisation.'),
  ('bi-analyst',                 'Business Intelligence Analyst', 'data',        array['SQL','Data Visualization','Statistics','Business Analysis','Excel','Communication'], 'Reports on business performance using warehouse data and BI tooling.'),
  ('ai-research-assistant',      'AI Research Assistant',         'data',        array['Machine Learning','Linear Algebra','Probability','Python','Research Methods','Deep Learning','Technical Writing'], 'Supports academic or industrial research on machine learning methods.'),
  ('product-manager-intern',     'Associate Product Manager',     'product',     array['Product Strategy','User Research','Communication','Data Analysis','Agile','Roadmapping'], 'Defines what to build and why, coordinating design and engineering.'),
  ('business-analyst',           'Business Analyst',              'business',    array['Business Analysis','Requirements Gathering','SQL','Process Modeling','Communication','Excel'], 'Translates business problems into documented system requirements.'),
  ('technical-program-manager',  'Technical Program Manager',     'product',     array['Project Management','Agile','Communication','Risk Assessment','Software Development Lifecycle','Stakeholder Management'], 'Drives cross-team technical programs from planning to delivery.'),
  ('management-consultant',      'Junior Management Consultant',  'business',    array['Problem Solving','Financial Analysis','Communication','Presentation Skills','Market Research','Excel'], 'Advises client organisations on strategy and operational improvement.'),
  ('financial-analyst',          'Financial Analyst',             'business',    array['Financial Analysis','Accounting','Excel','Statistics','Valuation','Economics'], 'Models company financials and supports investment decisions.'),
  ('marketing-analyst',          'Marketing Analyst',             'business',    array['Market Research','Data Analysis','Statistics','Communication','Consumer Behavior','Excel'], 'Measures campaign performance and identifies growth opportunities.'),
  ('operations-analyst',         'Operations Analyst',            'business',    array['Process Modeling','Data Analysis','Supply Chain','Excel','Statistics','Problem Solving'], 'Optimises internal operations and supply-chain efficiency.'),
  ('ux-designer',                'Junior UX Designer',            'design',      array['User Research','Wireframing','Prototyping','UI Design','Usability Testing','Visual Design'], 'Researches user needs and designs the flows that meet them.'),
  ('ui-engineer',                'UI Engineer',                   'design',      array['HTML','CSS','JavaScript','UI Design','Accessibility','Responsive Design','Design Systems'], 'Implements polished, accessible interface components in code.'),
  ('technical-writer',           'Technical Writer',              'product',     array['Technical Writing','Communication','Research Methods','Git','Information Architecture'], 'Documents software products for developer and end-user audiences.')
on conflict (slug) do update
  set title = excluded.title,
      track = excluded.track,
      required_skills = excluded.required_skills,
      description = excluded.description;
