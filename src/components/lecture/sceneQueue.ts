'use client';

/**
 * Serialises scene-generation requests for one browser session.
 *
 * Swiping through six cards would otherwise fire six concurrent Gemini calls
 * and trip the per-minute limit instantly. This runs one at a time, leaves a
 * short gap between calls, and drops any request the viewer has already
 * navigated away from — there is no point spending quota on a card nobody is
 * looking at.
 */

const GAP_BETWEEN_CALLS_MS = 1200;

interface QueuedJob<T> {
  key: string;
  run: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  controller: AbortController;
  /** Returns false when the viewer has moved on and the job should be dropped. */
  isStillWanted: () => boolean;
}

let queue: QueuedJob<unknown>[] = [];
let active = false;

export class DroppedFromQueueError extends Error {
  constructor() {
    super('Request superseded');
    this.name = 'DroppedFromQueueError';
  }
}

export function enqueueSceneRequest<T>(
  key: string,
  run: (signal: AbortSignal) => Promise<T>,
  isStillWanted: () => boolean,
): { promise: Promise<T>; cancel: () => void } {
  const controller = new AbortController();

  const promise = new Promise<T>((resolve, reject) => {
    // A duplicate request for the same card is already pending; drop this one
    // rather than queueing the same work twice.
    const existing = queue.find((job) => job.key === key);
    if (existing) {
      reject(new DroppedFromQueueError());
      return;
    }

    queue.push({
      key,
      run: run as (signal: AbortSignal) => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
      controller,
      isStillWanted,
    });

    void drain();
  });

  return {
    promise,
    cancel: () => {
      controller.abort();
      queue = queue.filter((job) => job.controller !== controller);
    },
  };
}

async function drain(): Promise<void> {
  if (active) return;
  active = true;

  try {
    while (queue.length > 0) {
      const job = queue.shift()!;

      if (!job.isStillWanted() || job.controller.signal.aborted) {
        job.reject(new DroppedFromQueueError());
        continue;
      }

      try {
        job.resolve(await job.run(job.controller.signal));
      } catch (error) {
        job.reject(error);
      }

      // Spacing successive calls keeps a fast swipe from looking like a burst
      // to the per-minute quota.
      if (queue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, GAP_BETWEEN_CALLS_MS));
      }
    }
  } finally {
    active = false;
  }
}
