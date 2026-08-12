-- Migration 003 — Video → Notes
--
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- Adds the columns and table that let a material be a *video* whose derived
-- content is structured notes, alongside the existing document → lecture flow.

-- ---------------------------------------------------------------------------
-- materials: distinguish a video source from a document source
-- ---------------------------------------------------------------------------
alter table public.materials
  add column if not exists content_type text not null default 'document';

alter table public.materials
  drop constraint if exists materials_content_type_check;
alter table public.materials
  add constraint materials_content_type_check check (content_type in ('document', 'video'));

-- Either a YouTube watch URL or a Supabase Storage path, depending on how the
-- video arrived. Null for documents.
alter table public.materials add column if not exists video_url text;
alter table public.materials add column if not exists video_duration_seconds integer;

-- Citations for a video point at a moment, not a page. The existing
-- SourceUnit mechanism already drives citation wording, so extending it here
-- means the RAG chatbot needs no new code to cite "[12:04]".
alter table public.materials
  drop constraint if exists materials_source_unit_check;
alter table public.materials
  add constraint materials_source_unit_check check (source_unit in ('page', 'slide', 'timestamp'));

-- ---------------------------------------------------------------------------
-- video_notes — the structured notes derived from one video
--
-- One row per material. `status` exists because Vercel functions cannot run
-- long enough to analyse a video in a single request: the client polls and each
-- request advances one step, so the state has to live somewhere durable.
-- ---------------------------------------------------------------------------
create table if not exists public.video_notes (
  id               uuid primary key default gen_random_uuid(),
  material_id      uuid not null references public.materials (id) on delete cascade,
  -- { title, sections: [{ heading, timestamp_start, bullets[], key_terms[] }] }
  notes_json       jsonb,
  status           text not null default 'pending',
  progress_message text,
  error            text,
  -- Cursor for the client-driven pipeline: each request analyses one segment,
  -- because a Vercel function cannot outlive a whole video.
  segment_index    integer not null default 0,
  segment_total    integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (material_id)
);

alter table public.video_notes add column if not exists segment_index integer not null default 0;
alter table public.video_notes add column if not exists segment_total integer not null default 1;

-- Gemini Files API URI for an uploaded (non-YouTube) video. Files expire after
-- 48 hours on Google's side, so this is a cache, not a permanent reference.
alter table public.video_notes add column if not exists gemini_file_uri text;

alter table public.video_notes
  drop constraint if exists video_notes_status_check;
alter table public.video_notes
  add constraint video_notes_status_check
  check (status in ('pending', 'uploading', 'analysing', 'structuring', 'done', 'failed'));

create index if not exists video_notes_material_idx on public.video_notes (material_id);

-- Reads/writes go through the service-role key on the server, which bypasses
-- RLS. Enabled with no permissive policy so the anon key cannot read notes.
alter table public.video_notes enable row level security;

-- ---------------------------------------------------------------------------
-- Storage bucket for uploaded video files.
--
-- Private: the browser uploads directly with a signed URL (Vercel functions cap
-- request bodies at 4.5 MB, so video bytes can never pass through a route), and
-- the server reads it back with the service-role key.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('lecture-videos', 'lecture-videos', false)
on conflict (id) do nothing;
