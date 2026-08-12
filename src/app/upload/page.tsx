'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import ChatPanel, { type Citation } from '@/components/ChatPanel';
import FileUploadZone from '@/components/FileUploadZone';
import Footer from '@/components/Footer';
import LectureCardPanel from '@/components/lecture/LectureCardPanel';
import LoadingState from '@/components/LoadingState';
import SkillPill from '@/components/SkillPill';
import SourceViewer from '@/components/SourceViewer';
import type { LearningCard } from '@/lib/lecture-types';
import { isVideoFilename, isVideoMimeType, parseYouTubeUrl } from '@/lib/notes-types';
import VideoNotesPanel from '@/components/notes/VideoNotesPanel';
import { getUserId } from '@/lib/session';

type Stage = 'idle' | 'processing' | 'ready';

const PROCESSING_STEPS = [
  'Reading your document',
  'Building learning cards',
  'Indexing for Q&A',
  'Mapping skills to careers',
];

interface Material {
  material_id: string;
  title: string;
  page_count: number;
  unit: 'page' | 'slide';
  content_type: 'document' | 'video';
  video_url?: string | null;
}

type InputMode = 'file' | 'text' | 'video';

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Unknown error.';
}

/**
 * Reads duration from the file locally. The server has no cheap way to know it,
 * and duration is what decides whether a lecture needs splitting into segments.
 */
function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';

    const finish = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };

    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? Math.round(video.duration) : null);
    video.onerror = () => finish(null);
    video.src = url;

    // Never let metadata probing hold up the upload flow.
    window.setTimeout(() => finish(null), 5000);
  });
}

/** Throws the API's own error message so the UI can show something actionable. */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request to ${url} failed.`);
  return data as T;
}

export default function UploadPage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);
  const [cards, setCards] = useState<LearningCard[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [mode, setMode] = useState<InputMode>('file');
  const [pastedText, setPastedText] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [notices, setNotices] = useState<string[]>([]);
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);

  const runPipeline = useCallback(async (uploadRequest: () => Promise<Response>) => {
    setStage('processing');
    setStep(0);
    setError(null);
    setNotices([]);
    setCards([]);
    setSkills([]);

    const collected: string[] = [];

    try {
      const userId = getUserId();
      const uploadResponse = await uploadRequest();
      const uploaded = await uploadResponse.json().catch(() => ({}));
      if (!uploadResponse.ok) throw new Error(uploaded.error || 'Upload failed.');

      const nextMaterial: Material = {
        material_id: uploaded.material_id,
        title: uploaded.title,
        page_count: uploaded.page_count ?? 0,
        unit: uploaded.unit === 'slide' ? 'slide' : 'page',
        content_type: uploaded.content_type === 'video' ? 'video' : 'document',
        video_url: uploaded.video_url ?? null,
      };
      setMaterial(nextMaterial);

      // Video material takes a different path entirely: VideoNotesPanel drives
      // its own multi-step pipeline, so this one ends here.
      if (nextMaterial.content_type === 'video') {
        setStage('ready');
        return;
      }

      setStep(1);

      // Cards are what the student sees first, so they are awaited before the
      // slower indexing and skill passes.
      // A card failure must not discard a material that is already stored and
      // chunked — the student can still use the chat and the skill profile.
      try {
        const cardResult = await postJson<{ cards: LearningCard[]; degraded?: boolean; notice?: string }>(
          '/api/generate-cards',
          { material_id: nextMaterial.material_id, user_id: userId },
        );
        setCards(cardResult.cards);
        if (cardResult.degraded && cardResult.notice) collected.push(cardResult.notice);
      } catch (cardError) {
        collected.push(`Learning cards could not be generated. ${errorText(cardError)}`);
      }
      setStep(2);

      // Indexing and skill extraction are independent — run them together.
      // Neither is allowed to fail the upload: chat falls back to keyword
      // retrieval without embeddings, and the cards are already on screen.
      const [embeddingResult, skillResult] = await Promise.allSettled([
        postJson('/api/generate-embeddings', { material_id: nextMaterial.material_id, user_id: userId }),
        postJson<{ skills: string[] }>('/api/extract-skills', {
          material_id: nextMaterial.material_id,
          user_id: userId,
        }),
      ]);
      setStep(3);

      if (skillResult.status === 'fulfilled') {
        setSkills(skillResult.value.skills);
      } else {
        // Without this the skills panel would simply be missing and the roadmap
        // would stay empty with no explanation of why.
        collected.push(
          `Skills could not be extracted from this upload, so your career roadmap won't change. ${errorText(skillResult.reason)}`,
        );
      }

      if (embeddingResult.status === 'rejected') {
        collected.push('Search indexing failed, so chat answers will use keyword matching instead of semantic search.');
      }

      setNotices(collected);
      setStage('ready');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
      setStage('idle');
    }
  }, []);

  /**
   * Uploads a video straight to Supabase Storage, then registers it.
   *
   * The bytes deliberately bypass our own API routes: Vercel caps function
   * request bodies at 4.5 MB, which no lecture recording fits inside.
   */
  const handleVideoFile = useCallback(async (file: File) => {
    setStage('processing');
    setStep(0);
    setError(null);
    setNotices([]);

    try {
      const userId = getUserId();

      const ticket = await postJson<{ path: string; signedUrl: string; token: string }>(
        '/api/upload-url',
        { filename: file.name, mime_type: file.type, size_bytes: file.size, user_id: userId },
      );

      const put = await fetch(ticket.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'video/mp4' },
        body: file,
      });
      if (!put.ok) throw new Error('The video upload failed. Check your connection and try again.');
      setStep(1);

      const duration = await readVideoDuration(file);

      const registered = await postJson<{ material_id: string; title: string; video_url: string }>(
        '/api/upload',
        {
          storage_path: ticket.path,
          duration_seconds: duration,
          title: file.name.replace(/\.[^.]+$/, ''),
          user_id: userId,
        },
      );

      setMaterial({
        material_id: registered.material_id,
        title: registered.title,
        page_count: 0,
        unit: 'page',
        content_type: 'video',
        video_url: registered.video_url,
      });
      setStage('ready');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not upload that video.');
      setStage('idle');
      setMode('video');
    }
  }, []);

  const handleFile = useCallback((file: File) => {
    // MIME detection routes a dropped video to the notes pipeline even if the
    // student never touched the mode tabs.
    if (isVideoMimeType(file.type) || isVideoFilename(file.name)) {
      handleVideoFile(file);
      return;
    }

    runPipeline(() => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('user_id', getUserId());
      return fetch('/api/upload', { method: 'POST', body: formData });
    });
  }, [runPipeline, handleVideoFile]);

  const handleYouTube = useCallback(() => {
    runPipeline(() =>
      fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtube_url: youtubeUrl, user_id: getUserId() }),
      }),
    );
  }, [runPipeline, youtubeUrl]);

  const handleText = useCallback(() => {
    runPipeline(() =>
      fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pastedText, user_id: getUserId(), title: 'Pasted notes' }),
      }),
    );
  }, [runPipeline, pastedText]);

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {stage === 'idle' && (
          <div className="max-w-2xl mx-auto slide-up">
            <div className="text-center mb-8">
              <h1 className="text-3xl sm:text-4xl font-bold text-[#dfe2f1] mb-3" style={{ fontFamily: 'var(--font-outfit)' }}>
                Upload your material
              </h1>
              <p className="text-[#c7c4d7]">
                A lecture PDF, a PowerPoint deck, or just paste your notes. We handle the rest.
              </p>
            </div>

            <div className="flex gap-2 mb-5 justify-center flex-wrap">
              {(['file', 'text', 'video'] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setMode(option)}
                  aria-pressed={mode === option}
                  className={`px-4 py-2.5 min-h-11 rounded-lg text-sm font-medium transition-all ${
                    mode === option
                      ? 'bg-[#8083ff]/20 text-[#c0c1ff] border border-[#8083ff]/30'
                      : 'text-[#908fa0] border border-transparent hover:text-[#dfe2f1]'
                  }`}
                >
                  {option === 'file' ? 'Upload file' : option === 'text' ? 'Paste text' : 'Video → Notes'}
                </button>
              ))}
            </div>

            {mode === 'video' ? (
              <div className="glass-panel rounded-2xl p-6">
                <label htmlFor="youtube-url" className="block text-sm text-[#dfe2f1] font-medium mb-2">
                  Paste a YouTube lecture link
                </label>
                <input
                  id="youtube-url"
                  type="url"
                  value={youtubeUrl}
                  onChange={(event) => setYoutubeUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  className="w-full bg-[#262a35] border border-[#464554] rounded-xl px-4 py-3 text-sm text-[#dfe2f1] placeholder:text-[#908fa0]/60"
                />
                <button
                  onClick={handleYouTube}
                  disabled={!parseYouTubeUrl(youtubeUrl)}
                  className="mt-3 w-full py-3 rounded-xl bg-gradient-to-r from-[#8083ff] to-[#4cd7f6] text-[#0f131d] font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                >
                  {parseYouTubeUrl(youtubeUrl) ? 'Turn this lecture into notes' : 'Paste a valid YouTube link'}
                </button>
                <p className="text-[10px] text-[#908fa0] mt-3 leading-relaxed">
                  The video must be public. Long lectures are analysed in 15-minute segments, so a
                  full hour takes a few minutes and several AI calls.
                </p>
              </div>
            ) : mode === 'file' ? (
              <FileUploadZone onFileSelect={handleFile} />
            ) : (
              <div className="glass-panel rounded-2xl p-6">
                <textarea
                  value={pastedText}
                  onChange={(event) => setPastedText(event.target.value)}
                  placeholder="Paste your lecture notes here…"
                  rows={10}
                  className="w-full bg-[#262a35] border border-[#464554] rounded-xl px-4 py-3 text-sm text-[#dfe2f1] placeholder:text-[#908fa0]/60 resize-y"
                />
                <button
                  onClick={handleText}
                  disabled={pastedText.trim().length < 200}
                  className="mt-3 w-full py-3 rounded-xl bg-gradient-to-r from-[#8083ff] to-[#4cd7f6] text-[#0f131d] font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                >
                  {pastedText.trim().length < 200
                    ? `Paste at least ${200 - pastedText.trim().length} more characters`
                    : 'Generate learning cards'}
                </button>
              </div>
            )}

            {error && (
              <div className="mt-5 flex items-start gap-3 p-4 rounded-xl bg-[#ff516a]/10 border border-[#ff516a]/25 fade-in">
                <span className="material-symbols-outlined text-[#ff516a] flex-shrink-0" style={{ fontSize: '20px' }}>
                  error
                </span>
                <div>
                  <p className="text-sm text-[#ffb2b7] font-medium">Upload failed</p>
                  <p className="text-xs text-[#ffb2b7]/80 mt-0.5">{error}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {stage === 'processing' && (
          <div className="py-20">
            <LoadingState steps={PROCESSING_STEPS} currentStep={step} />
          </div>
        )}

        {stage === 'ready' && material && (
          <div className="fade-in">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <div className="min-w-0">
                <p className="text-xs text-[#908fa0] uppercase tracking-wider mb-1">Now studying</p>
                <h1 className="text-2xl font-bold text-[#dfe2f1] truncate" style={{ fontFamily: 'var(--font-outfit)' }}>
                  {material.title}
                </h1>
                <p className="text-xs text-[#908fa0] mt-1">
                  {material.content_type === 'video'
                    ? 'Video lecture · notes generated from the recording'
                    : `${material.page_count} ${material.unit}${material.page_count === 1 ? '' : 's'} · ${cards.length} learning cards`}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStage('idle');
                    setPastedText('');
                    setYoutubeUrl('');
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg glass-panel text-sm text-[#c7c4d7] hover:text-[#dfe2f1] transition-colors"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
                  New upload
                </button>
                <Link
                  href="/roadmap"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-[#8083ff] to-[#4cd7f6] text-[#0f131d] text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>route</span>
                  View roadmap
                </Link>
              </div>
            </div>

            {notices.length > 0 && (
              <div className="space-y-2 mb-6">
                {notices.map((message) => (
                  <div
                    key={message}
                    className="flex items-start gap-3 p-4 rounded-xl bg-amber-400/10 border border-amber-400/25 fade-in"
                  >
                    <span className="material-symbols-outlined text-amber-300 flex-shrink-0" style={{ fontSize: '20px' }}>
                      info
                    </span>
                    <p className="text-xs text-amber-200/90 leading-relaxed">{message}</p>
                  </div>
                ))}
              </div>
            )}

            {skills.length > 0 && (
              <div className="glass-panel rounded-2xl p-5 mb-8">
                <p className="text-xs font-semibold text-[#c0c1ff] mb-3 flex items-center gap-1.5">
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>bolt</span>
                  Skills added to your profile from this upload
                </p>
                <div className="flex flex-wrap gap-2">
                  {skills.map((skill) => (
                    <SkillPill key={skill} skill={skill} variant="have" />
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-2 items-start">
              <div>
                <h2 className="text-sm font-semibold text-[#c7c4d7] mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="material-symbols-outlined text-[#8083ff]" style={{ fontSize: '18px' }}>
                    {material.content_type === 'video' ? 'article' : 'smart_display'}
                  </span>
                  {material.content_type === 'video' ? 'Your notes' : 'Your lecture'}
                  <span className="text-[10px] text-[#908fa0] font-normal">swipe or use arrow keys</span>
                </h2>

                {material.content_type === 'video' && material.video_url ? (
                  <VideoNotesPanel
                    materialId={material.material_id}
                    userId={getUserId()}
                    videoUrl={material.video_url}
                    title={material.title}
                  />
                ) : null}
                {material.content_type === 'video' ? null : cards.length > 0 ? (
                  <LectureCardPanel
                    materialId={material.material_id}
                    materialTitle={material.title}
                    userId={getUserId()}
                    cards={cards}
                  />
                ) : (
                  <div className="glass-panel rounded-2xl p-8 text-center">
                    <span className="material-symbols-outlined text-[#464554] mb-2 block" style={{ fontSize: '36px' }}>
                      style_off
                    </span>
                    <p className="text-sm text-[#c7c4d7]">Cards are unavailable for this upload.</p>
                    <p className="text-xs text-[#908fa0] mt-1">You can still ask questions about it on the right.</p>
                  </div>
                )}
              </div>

              <div>
                <h2 className="text-sm font-semibold text-[#c7c4d7] mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#4cd7f6]" style={{ fontSize: '18px' }}>forum</span>
                  Ask questions
                </h2>
                <ChatPanel
                  materialId={material.material_id}
                  userId={getUserId()}
                  onCitationClick={setOpenCitation}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <SourceViewer citation={openCitation} onClose={() => setOpenCitation(null)} />

      <Footer />
    </div>
  );
}
