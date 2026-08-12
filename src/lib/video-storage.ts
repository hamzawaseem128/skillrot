import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import { supabaseServer, isSupabaseConfigured } from './supabase';

/**
 * Moving an uploaded video from the browser to Gemini.
 *
 * The route the bytes take is dictated by Vercel: functions cap request bodies
 * at 4.5 MB, so video can never be POSTed to an API route. Instead the browser
 * uploads straight to Supabase Storage with a signed URL, and the server later
 * pulls it back and forwards it to Gemini's Files API.
 *
 * That server-side hop is what bounds the feature: the whole download-and-
 * forward must finish inside one function invocation, which is why uploads are
 * capped well below what Gemini itself would accept.
 */

export const VIDEO_BUCKET = 'lecture-videos';

/**
 * Deliberately conservative. Gemini's Files API accepts up to 2 GB, but the
 * download → upload round trip has to complete within a 60 s function, so the
 * practical ceiling is far lower than the API's.
 */
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // 60 MB
export const MAX_VIDEO_SECONDS = 25 * 60; // 25 minutes

export function isVideoStorageConfigured(): boolean {
  return isSupabaseConfigured();
}

/** A short-lived URL the browser PUTs the file to, bypassing our functions. */
export async function createSignedUploadUrl(userId: string, filename: string) {
  const safeName = filename.replace(/[^\w.\-]/g, '_').slice(-80);
  const path = `${userId}/${Date.now()}-${safeName}`;

  const { data, error } = await supabaseServer()
    .storage.from(VIDEO_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    throw new Error(
      `Could not create an upload URL: ${error?.message ?? 'unknown error'}. ` +
        `Check that the '${VIDEO_BUCKET}' bucket exists (migration 003).`,
    );
  }

  return { path, signedUrl: data.signedUrl, token: data.token };
}

/**
 * Pulls the video out of Storage and hands it to Gemini's Files API.
 *
 * Returns the file URI once Google reports the file ACTIVE — a video is not
 * usable the instant it uploads, it has to finish server-side processing first.
 */
export async function transferToGemini(
  storagePath: string,
  apiKey: string,
  displayName: string,
): Promise<{ fileUri: string; mimeType: string }> {
  const { data, error } = await supabaseServer().storage.from(VIDEO_BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Could not read the uploaded video: ${error?.message ?? 'not found'}`);
  }

  if (data.size > MAX_VIDEO_BYTES) {
    throw new Error(
      `That video is ${(data.size / 1024 / 1024).toFixed(0)} MB. The limit is ` +
        `${MAX_VIDEO_BYTES / 1024 / 1024} MB — paste a YouTube link instead for longer lectures.`,
    );
  }

  const mimeType = data.type || 'video/mp4';
  const buffer = Buffer.from(await data.arrayBuffer());

  const manager = new GoogleAIFileManager(apiKey);
  const uploaded = await manager.uploadFile(buffer, { mimeType, displayName });

  // Gemini processes video asynchronously; using the URI before it is ACTIVE
  // fails with a confusing "file not found".
  let file = uploaded.file;
  const deadline = Date.now() + 40_000;

  while (file.state === FileState.PROCESSING && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    file = await manager.getFile(file.name);
  }

  if (file.state === FileState.FAILED) {
    throw new Error('Gemini could not process that video file. Try re-encoding it as MP4.');
  }
  if (file.state !== FileState.ACTIVE) {
    throw new Error('The video is still being processed by Gemini. Try again in a moment.');
  }

  return { fileUri: file.uri, mimeType };
}
