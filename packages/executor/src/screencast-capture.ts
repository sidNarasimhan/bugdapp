/**
 * High-quality screencast capture via Chrome DevTools Protocol.
 *
 * Playwright's trace screencast uses quality ~50 at ~800x450.
 * This module captures at quality=80 at 1280x720 for sharp replay.
 *
 * Frames are saved to a temp directory, then bundled into screencast.zip
 * with a manifest.json containing timestamps and frame order.
 */

import type { Page, CDPSession } from 'playwright-core';
import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import AdmZip from 'adm-zip';

interface ScreencastFrame {
  index: number;
  filename: string;
  timestamp: number;
}

interface ScreencastManifest {
  frameCount: number;
  frames: ScreencastFrame[];
  startTimestamp: number;
  endTimestamp: number;
  width: number;
  height: number;
  quality: number;
}

export interface ScreencastCapture {
  /** Stop capturing and bundle frames into screencast.zip */
  stop(): Promise<string | null>;
  /** Whether capture started successfully */
  readonly active: boolean;
}

/**
 * Start a high-quality CDP screencast on the given page.
 *
 * @param page - Playwright page to capture
 * @param outputDir - Directory where screencast.zip will be saved
 * @param options - Quality and resolution options
 * @returns ScreencastCapture handle to stop and bundle
 */
export async function startScreencastCapture(
  page: Page,
  outputDir: string,
  options: { quality?: number; maxWidth?: number; maxHeight?: number } = {},
): Promise<ScreencastCapture> {
  const quality = options.quality ?? 80;
  const maxWidth = options.maxWidth ?? 1280;
  const maxHeight = options.maxHeight ?? 720;

  const framesDir = join(outputDir, '_screencast_frames');
  const frames: ScreencastFrame[] = [];
  let frameIndex = 0;
  let cdpSession: CDPSession | null = null;
  let active = false;

  try {
    // Clean up any leftover frames dir
    if (existsSync(framesDir)) {
      rmSync(framesDir, { recursive: true, force: true });
    }
    mkdirSync(framesDir, { recursive: true });

    cdpSession = await page.context().newCDPSession(page);

    cdpSession.on('Page.screencastFrame', async (params: any) => {
      try {
        const { data, metadata, sessionId } = params;
        const filename = `frame-${String(frameIndex).padStart(5, '0')}.jpg`;
        const buffer = Buffer.from(data, 'base64');
        writeFileSync(join(framesDir, filename), buffer);

        frames.push({
          index: frameIndex,
          filename,
          timestamp: metadata.timestamp * 1000, // Convert to ms
        });
        frameIndex++;

        // Acknowledge frame to continue receiving
        await cdpSession!.send('Page.screencastFrameAck', { sessionId });
      } catch {
        // Non-fatal — frame dropped
      }
    });

    await cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality,
      maxWidth,
      maxHeight,
      everyNthFrame: 3, // Every 3rd frame — smooth playback, ~3x smaller zip
    });

    active = true;
    console.log(`[ScreencastCapture] Started: quality=${quality}, ${maxWidth}x${maxHeight}`);
  } catch (err) {
    console.warn(`[ScreencastCapture] Failed to start: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    get active() { return active; },

    async stop(): Promise<string | null> {
      if (!active || !cdpSession) return null;
      active = false;

      try {
        await cdpSession.send('Page.stopScreencast');
        await cdpSession.detach();
      } catch {
        // Session may already be closed
      }

      if (frames.length === 0) {
        // No frames captured — clean up and return null
        if (existsSync(framesDir)) {
          rmSync(framesDir, { recursive: true, force: true });
        }
        return null;
      }

      // Bundle into screencast.zip
      const zipPath = join(outputDir, 'screencast.zip');
      try {
        const zip = new AdmZip();

        // Add manifest
        const manifest: ScreencastManifest = {
          frameCount: frames.length,
          frames,
          startTimestamp: frames[0].timestamp,
          endTimestamp: frames[frames.length - 1].timestamp,
          width: maxWidth,
          height: maxHeight,
          quality,
        };
        zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));

        // Add frame files
        const fileList = readdirSync(framesDir).filter(f => f.endsWith('.jpg')).sort();
        for (const file of fileList) {
          zip.addLocalFile(join(framesDir, file), 'frames/');
        }

        zip.writeZip(zipPath);
        console.log(`[ScreencastCapture] Saved ${frames.length} frames to screencast.zip (${(zip.toBuffer().length / 1024 / 1024).toFixed(1)}MB)`);
      } catch (err) {
        console.error(`[ScreencastCapture] Failed to create zip: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      } finally {
        // Clean up temp frames
        if (existsSync(framesDir)) {
          rmSync(framesDir, { recursive: true, force: true });
        }
      }

      return zipPath;
    },
  };
}
