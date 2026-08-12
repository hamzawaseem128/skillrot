import { NextResponse } from 'next/server';
import { isVideoFilename, isVideoMimeType } from '@/lib/notes-types';
import {
  MAX_VIDEO_BYTES,
  createSignedUploadUrl,
  isVideoStorageConfigured,
} from '@/lib/video-storage';
import { DEMO_USER_ID, handleRouteError, jsonError } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/upload-url — issues a signed Supabase Storage URL for a video.
 *
 * The browser PUTs the file straight to Storage with this. Video bytes never
 * touch a Next.js route because Vercel caps function request bodies at 4.5 MB,
 * which no lecture recording will fit inside.
 */
export async function POST(request: Request) {
  try {
    const { filename, mime_type, size_bytes, user_id } = await request.json();

    if (typeof filename !== 'string' || !filename.trim()) {
      return jsonError('filename is required.');
    }
    if (!isVideoFilename(filename) && !isVideoMimeType(String(mime_type ?? ''))) {
      return jsonError('That file is not a video. Supported: MP4, MOV, WebM, M4V.');
    }

    const size = Number(size_bytes);
    if (Number.isFinite(size) && size > MAX_VIDEO_BYTES) {
      return jsonError(
        `That video is ${(size / 1024 / 1024).toFixed(0)} MB. The limit is ` +
          `${MAX_VIDEO_BYTES / 1024 / 1024} MB — paste a YouTube link instead for longer lectures.`,
        413,
      );
    }

    if (!isVideoStorageConfigured()) {
      return jsonError(
        'Video file uploads need Supabase Storage. Configure Supabase, or paste a YouTube link instead.',
        503,
      );
    }

    const upload = await createSignedUploadUrl(user_id || DEMO_USER_ID, filename);
    return NextResponse.json(upload);
  } catch (error) {
    return handleRouteError('Upload URL', error);
  }
}
