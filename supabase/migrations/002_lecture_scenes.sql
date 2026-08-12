-- Migration 002 — narrated "video lecture" scenes
--
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- (supabase/schema.sql already contains this; the migration exists so an
-- already-provisioned project can be updated without re-reading the full file.)
--
-- Until this runs, the app still works: scenes are generated on demand and
-- played, they simply are not cached, so every view costs another Gemini call.

create table if not exists public.lecture_scenes (
  id               uuid primary key default gen_random_uuid(),
  material_id      uuid not null references public.materials (id) on delete cascade,
  card_index       integer not null,
  scene_index      integer not null,
  narration_text   text not null,
  visual_json      jsonb not null,
  audio_url        text,
  duration_seconds numeric(6,2) not null default 6,
  image_json       jsonb,
  created_at       timestamptz not null default now(),
  unique (material_id, card_index, scene_index)
);

-- Added after 002 first shipped; harmless if the column already exists.
alter table public.lecture_scenes add column if not exists image_json jsonb;

create index if not exists lecture_scenes_card_idx
  on public.lecture_scenes (material_id, card_index, scene_index);

-- Reads/writes go through the service-role key on the server, which bypasses
-- RLS. Enabled with no permissive policy so the anon key cannot read scenes.
alter table public.lecture_scenes enable row level security;
