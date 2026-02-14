import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import AdmZip from 'adm-zip';

// S3/MinIO config (same as artifacts route)
const s3Client = new S3Client({
  endpoint: `http://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || '9000'}`,
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'minioadmin123',
  },
  forcePathStyle: true,
});

const BUCKET_NAME = process.env.MINIO_BUCKET || 'artifacts';

// --- Types ---

export interface ReplayFrame {
  sha1: string;
  timestamp: number;
  width: number;
  height: number;
  pageId: string;
}

export interface ReplayAction {
  callId: string;
  method: string;
  apiName: string;
  label: string;
  params: Record<string, unknown>;
  startTime: number;
  endTime: number;
  pageId: string;
  error?: string;
}

export interface ReplayManifest {
  runId: string;
  pageId: string;
  totalDurationMs: number;
  frameCount: number;
  frames: ReplayFrame[];
  actions: ReplayAction[];
  baseTimestamp: number;
}

// --- In-memory cache ---

interface CacheEntry {
  manifest: ReplayManifest;
  zip: AdmZip;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Screencast cache (high-quality CDP capture)
interface ScreencastManifestFile {
  frameCount: number;
  frames: Array<{ index: number; filename: string; timestamp: number }>;
  startTimestamp: number;
  endTimestamp: number;
  width: number;
  height: number;
  quality: number;
}

interface ScreencastCacheEntry {
  manifest: ScreencastManifestFile;
  zip: AdmZip;
  expiresAt: number;
}

const screencastCache = new Map<string, ScreencastCacheEntry>();

function cleanupCache() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt < now) {
      cache.delete(key);
    }
  }
  for (const [key, entry] of screencastCache) {
    if (entry.expiresAt < now) {
      screencastCache.delete(key);
    }
  }
}

// --- Helpers ---

/** Noise methods to skip entirely */
const NOISE_METHODS = new Set([
  'pw:api', 'hook', 'fixture', 'close', 'newPage',
  'isVisible', 'isHidden', 'isEnabled', 'isDisabled',
  'waitForEventInfo',
]);

/** Extract human-readable text from a Playwright selector */
function labelFromSelector(selector: string): string {
  // has-text("MetaMask")
  const hasText = selector.match(/has-text\("([^"]*)"\)/i);
  if (hasText) return hasText[1];
  // :text("Submit")
  const textPseudo = selector.match(/:text\("([^"]*)"\)/i);
  if (textPseudo) return textPseudo[1];
  // internal:role=button[name="Connect"i]
  const roleName = selector.match(/role=\w+\[name="([^"]+)"/i);
  if (roleName) return roleName[1];
  // data-testid="connect-button" → "connect button"
  const testId = selector.match(/data-testid="([^"]+)"/);
  if (testId) return testId[1].replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  // text="Submit" or text~"Submit"
  const textEq = selector.match(/text[=~]"?([^"]*)"?/i);
  if (textEq) return textEq[1];
  return '';
}

/** Convert trace method + params to a human-readable label */
function humanizeAction(method: string, params: Record<string, unknown>): string {
  const m = method.toLowerCase();

  if (m === 'goto') {
    const url = params.url as string || '';
    if (url.startsWith('chrome-extension://')) return '';
    try {
      const hostname = new URL(url).hostname;
      return `Navigating to ${hostname}`;
    } catch {
      return 'Navigating to page';
    }
  }
  if (m === 'waitfortimeout') return 'Waiting';
  if (m === 'waitforloadstate') return 'Waiting for page to load';
  if (m === 'waitforselector') return 'Waiting for element';
  if (m === 'reload') return 'Reloading page';

  if (m === 'click') {
    const selector = (params.selector as string) || '';
    const label = labelFromSelector(selector);
    return label ? `Clicking "${label}"` : 'Clicking element';
  }
  if (m === 'fill') {
    const selector = (params.selector as string) || '';
    const label = labelFromSelector(selector);
    return label ? `Filling "${label}"` : 'Filling field';
  }
  if (m === 'type') {
    return 'Typing into field';
  }
  if (m === 'press') {
    const key = params.key as string || '';
    return key ? `Pressing ${key}` : 'Pressing key';
  }
  if (m === 'selectoption') return 'Selecting option';
  if (m === 'hover') return 'Hovering over element';
  if (m === 'screenshot') return 'Taking screenshot';
  if (m.includes('expect') || m.includes('assert')) return 'Verifying assertion';
  if (m === 'evaluate' || m === 'evaluateexpression') return 'Evaluating script';

  // Fallback: capitalize method name, split camelCase
  if (!m) return '';
  const cleaned = m.replace(/([A-Z])/g, ' $1').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Download trace.zip buffer from MinIO */
async function downloadTraceZip(storagePath: string): Promise<Buffer> {
  // Strip bucket prefix
  const key = storagePath.startsWith(`${BUCKET_NAME}/`)
    ? storagePath.slice(BUCKET_NAME.length + 1)
    : storagePath;

  const response = await s3Client.send(new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  }));

  // Read stream into buffer
  const chunks: Uint8Array[] = [];
  const body = response.Body as AsyncIterable<Uint8Array>;
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Parse all .trace files from the zip (JSON lines format) */
function parseTraceEvents(zip: AdmZip): unknown[] {
  const events: unknown[] = [];
  for (const entry of zip.getEntries()) {
    if (entry.entryName.endsWith('.trace')) {
      const text = entry.getData().toString('utf-8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          events.push(JSON.parse(trimmed));
        } catch {
          // Skip malformed lines
        }
      }
    }
  }
  return events;
}

/** Detect the dApp page (not MetaMask extension) */
function detectDappPageId(events: unknown[]): string {
  // Strategy 1: Find goto action to non chrome-extension:// URL
  for (const evt of events) {
    const e = evt as Record<string, unknown>;
    const method = (e.method as string) || (e.apiName as string) || '';
    if (e.type === 'before' && (method === 'goto' || method === 'page.goto')) {
      const params = e.params as Record<string, unknown> | undefined;
      const url = params?.url as string || '';
      if (url && !url.startsWith('chrome-extension://')) {
        return (e.pageId as string) || '';
      }
    }
  }

  // Strategy 2: Find pageId with most screencast frames (skip extension pages)
  const frameCounts = new Map<string, number>();
  for (const evt of events) {
    const e = evt as Record<string, unknown>;
    if (e.type === 'screencast-frame') {
      const pid = e.pageId as string;
      frameCounts.set(pid, (frameCounts.get(pid) || 0) + 1);
    }
  }

  let bestPageId = '';
  let maxFrames = 0;
  for (const [pid, count] of frameCounts) {
    if (count > maxFrames) {
      maxFrames = count;
      bestPageId = pid;
    }
  }

  return bestPageId;
}

/** Build the replay manifest from trace events */
function buildManifest(runId: string, events: unknown[], dappPageId: string): ReplayManifest {
  const frames: ReplayFrame[] = [];
  const actionStarts = new Map<string, { apiName: string; method: string; params: Record<string, unknown>; startTime: number; pageId: string }>();
  const actions: ReplayAction[] = [];

  for (const evt of events) {
    const e = evt as Record<string, unknown>;

    // Screencast frames
    if (e.type === 'screencast-frame' && e.pageId === dappPageId) {
      frames.push({
        sha1: e.sha1 as string,
        timestamp: e.timestamp as number,
        width: (e.width as number) || 1280,
        height: (e.height as number) || 720,
        pageId: dappPageId,
      });
    }

    // Action start
    if (e.type === 'before') {
      const callId = e.callId as string;
      const apiName = (e.apiName as string) || '';
      const method = (e.method as string) || apiName;
      const params = (e.params as Record<string, unknown>) || {};
      const startTime = (e.startTime as number) || (e.wallTime as number) || 0;
      const pageId = (e.pageId as string) || '';

      // Skip noise methods
      if (NOISE_METHODS.has(method)) continue;
      if (apiName.startsWith('browserContext.') || apiName.startsWith('browser.')) continue;

      actionStarts.set(callId, { apiName, method, params, startTime, pageId });
    }

    // Action end
    if (e.type === 'after') {
      const callId = e.callId as string;
      const start = actionStarts.get(callId);
      if (start) {
        const endTime = (e.endTime as number) || (e.wallTime as number) || 0;
        const error = e.error as Record<string, unknown> | undefined;
        const label = humanizeAction(start.method, start.params);

        // Skip actions with no meaningful label (chrome-extension gotos, etc.)
        if (!label) {
          actionStarts.delete(callId);
          continue;
        }

        // Only include actions on the dApp page
        if (start.pageId === dappPageId) {
          actions.push({
            callId,
            method: start.method,
            apiName: start.apiName,
            label,
            params: start.params,
            startTime: start.startTime,
            endTime,
            pageId: start.pageId,
            error: error?.message as string | undefined,
          });
        }

        actionStarts.delete(callId);
      }
    }
  }

  // Sort frames by timestamp
  frames.sort((a, b) => a.timestamp - b.timestamp);
  // Sort actions by startTime
  actions.sort((a, b) => a.startTime - b.startTime);

  const baseTimestamp = frames.length > 0 ? frames[0].timestamp : 0;
  const lastFrame = frames[frames.length - 1];
  const totalDurationMs = lastFrame ? lastFrame.timestamp - baseTimestamp : 0;

  return {
    runId,
    pageId: dappPageId,
    totalDurationMs,
    frameCount: frames.length,
    frames,
    actions,
    baseTimestamp,
  };
}

// --- Screencast manifest (high-quality CDP capture) ---

/**
 * Parse screencast.zip (high-quality CDP screencast) and return its manifest.
 * Returns null if the zip doesn't contain a valid manifest.
 */
export async function getScreencastManifest(
  runId: string,
  storagePath: string
): Promise<ScreencastManifestFile | null> {
  cleanupCache();

  const cacheKey = `sc:${runId}:${storagePath}`;
  const cached = screencastCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.manifest;
  }

  try {
    const buffer = await downloadTraceZip(storagePath);
    const zip = new AdmZip(buffer);
    const manifestEntry = zip.getEntry('manifest.json');
    if (!manifestEntry) return null;

    const manifest: ScreencastManifestFile = JSON.parse(manifestEntry.getData().toString('utf-8'));
    if (!manifest.frames || manifest.frames.length === 0) return null;

    screencastCache.set(cacheKey, {
      manifest,
      zip,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return manifest;
  } catch {
    return null;
  }
}

/**
 * Extract a single frame from the cached screencast.zip by filename.
 */
export async function getScreencastFrame(
  runId: string,
  storagePath: string,
  filename: string
): Promise<Buffer | null> {
  const cacheKey = `sc:${runId}:${storagePath}`;
  let cached = screencastCache.get(cacheKey);

  if (!cached || cached.expiresAt < Date.now()) {
    await getScreencastManifest(runId, storagePath);
    cached = screencastCache.get(cacheKey);
  }

  if (!cached) return null;

  const entry = cached.zip.getEntry(`frames/${filename}`);
  return entry ? entry.getData() : null;
}

// --- Public API ---

/**
 * Parse a trace.zip and return the replay manifest
 */
export async function getReplayManifest(runId: string, storagePath: string): Promise<ReplayManifest> {
  cleanupCache();

  const cacheKey = `${runId}:${storagePath}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.manifest;
  }

  const buffer = await downloadTraceZip(storagePath);
  const zip = new AdmZip(buffer);
  const events = parseTraceEvents(zip);
  const dappPageId = detectDappPageId(events);
  const manifest = buildManifest(runId, events, dappPageId);

  cache.set(cacheKey, {
    manifest,
    zip,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return manifest;
}

/**
 * Extract a single frame (JPEG) from the cached trace.zip by sha1
 */
export async function getFrameFromZip(
  runId: string,
  storagePath: string,
  sha1: string
): Promise<Buffer | null> {
  cleanupCache();

  const cacheKey = `${runId}:${storagePath}`;
  let cached = cache.get(cacheKey);

  // If not cached, load the zip first
  if (!cached || cached.expiresAt < Date.now()) {
    await getReplayManifest(runId, storagePath);
    cached = cache.get(cacheKey);
  }

  if (!cached) return null;

  const zip = cached.zip;

  // Try common naming patterns for Playwright trace resources
  const candidates = [
    `resources/${sha1}`,
    `resources/${sha1}.jpeg`,
    `resources/${sha1}.jpg`,
    `resources/${sha1}.png`,
  ];

  for (const name of candidates) {
    const entry = zip.getEntry(name);
    if (entry) {
      return entry.getData();
    }
  }

  return null;
}
