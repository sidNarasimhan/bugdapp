'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ReplayFrame, type ReplayAction } from '@/lib/api';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  AlertCircle,
  Gauge,
} from 'lucide-react';

interface Props {
  runId: string;
}

type PlayerState = 'loading' | 'error' | 'no-frames' | 'ready' | 'playing' | 'paused';
type Speed = 0.5 | 1 | 2 | 4;

const SPEEDS: Speed[] = [0.5, 1, 2, 4];

export function TestReplayPlayer({ runId }: Props) {
  const { data: manifest, isLoading, error } = useQuery({
    queryKey: ['replayManifest', runId],
    queryFn: () => api.getReplayManifest(runId),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const [playerState, setPlayerState] = useState<PlayerState>('loading');
  const [speed, setSpeed] = useState<Speed>(1);
  const [preloaded, setPreloaded] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState(0);
  // UI state - updated at throttled rate during playback
  const [uiFrameIndex, setUiFrameIndex] = useState(0);

  // Refs for direct DOM manipulation (no React re-renders during playback)
  const imgRef = useRef<HTMLImageElement>(null);
  const actionLabelRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const frameCountRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Blob URL array indexed by frame index for O(1) lookup
  const blobUrls = useRef<string[]>([]);
  const animFrameRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const isPlayingRef = useRef(false);
  const speedRef = useRef<Speed>(1);
  const frameIndexRef = useRef(0);
  const uiUpdateTimer = useRef<ReturnType<typeof setInterval>>(0 as unknown as ReturnType<typeof setInterval>);

  useEffect(() => { speedRef.current = speed; }, [speed]);

  const frames = manifest?.frames ?? [];
  const actions = manifest?.actions ?? [];
  const baseTs = manifest?.baseTimestamp ?? 0;
  const totalMs = manifest?.totalDurationMs ?? 0;

  // --- Format time ---
  const fmtTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  };

  // --- Find action at timestamp ---
  const findAction = useCallback((timestamp: number): ReplayAction | null => {
    for (let i = actions.length - 1; i >= 0; i--) {
      const a = actions[i];
      if (a.startTime <= timestamp && a.endTime >= timestamp) return a;
    }
    for (let i = actions.length - 1; i >= 0; i--) {
      if (actions[i].endTime <= timestamp && timestamp - actions[i].endTime < 2000) return actions[i];
    }
    return null;
  }, [actions]);

  // --- Direct DOM update (no React) ---
  const updateDOM = useCallback((idx: number) => {
    const frame = frames[idx];
    if (!frame) return;

    // Update image src directly
    if (imgRef.current && blobUrls.current[idx]) {
      imgRef.current.src = blobUrls.current[idx];
    }

    // Update action label
    if (actionLabelRef.current) {
      const action = findAction(frame.timestamp);
      if (action) {
        actionLabelRef.current.textContent = action.label;
        actionLabelRef.current.style.display = '';
      } else {
        actionLabelRef.current.style.display = 'none';
      }
    }

    // Update progress bar
    const progress = totalMs > 0 ? (frame.timestamp - baseTs) / totalMs : 0;
    if (progressRef.current) {
      progressRef.current.style.width = `${progress * 100}%`;
    }

    // Update time and frame counter
    if (timeRef.current) {
      timeRef.current.textContent = `${fmtTime(frame.timestamp - baseTs)} / ${fmtTime(totalMs)}`;
    }
    if (frameCountRef.current) {
      frameCountRef.current.textContent = `${idx + 1} / ${frames.length}`;
    }
  }, [frames, baseTs, totalMs, findAction]);

  // --- Preload all frames as blobs ---
  useEffect(() => {
    if (!manifest || frames.length === 0) return;
    let cancelled = false;
    blobUrls.current = new Array(frames.length).fill('');

    async function preloadAll() {
      const batchSize = 30;
      for (let i = 0; i < frames.length; i += batchSize) {
        if (cancelled) return;
        const batch = frames.slice(i, i + batchSize);
        await Promise.all(batch.map(async (frame: ReplayFrame, batchIdx: number) => {
          try {
            const res = await fetch(api.getReplayFrameUrl(runId, frame.sha1));
            if (res.ok) {
              const blob = await res.blob();
              blobUrls.current[i + batchIdx] = URL.createObjectURL(blob);
            }
          } catch { /* skip */ }
        }));
        if (!cancelled) {
          setPreloadProgress(Math.min(1, (i + batchSize) / frames.length));
        }
      }
      if (!cancelled) {
        setPreloaded(true);
        setPlayerState('ready');
        // Show first frame via direct DOM update
        requestAnimationFrame(() => updateDOM(0));
      }
    }

    preloadAll();
    return () => {
      cancelled = true;
      blobUrls.current.forEach((u) => { if (u) URL.revokeObjectURL(u); });
    };
  }, [manifest, runId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      clearInterval(uiUpdateTimer.current);
      isPlayingRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isLoading) { setPlayerState('loading'); return; }
    if (error) { setPlayerState('error'); return; }
    if (manifest && manifest.frameCount === 0) { setPlayerState('no-frames'); return; }
    if (manifest && !preloaded) { setPlayerState('loading'); return; }
  }, [isLoading, error, manifest, preloaded]);

  // --- Playback engine (pure DOM, no React state during play) ---
  const startPlayback = useCallback(() => {
    if (frames.length === 0) return;
    isPlayingRef.current = true;
    setPlayerState('playing');
    lastFrameTimeRef.current = performance.now();

    // Throttled UI state sync (for any React-dependent UI)
    uiUpdateTimer.current = setInterval(() => {
      setUiFrameIndex(frameIndexRef.current);
    }, 250);

    const tick = (now: number) => {
      if (!isPlayingRef.current) return;

      const idx = frameIndexRef.current;
      if (idx >= frames.length - 1) {
        isPlayingRef.current = false;
        clearInterval(uiUpdateTimer.current);
        setPlayerState('paused');
        setUiFrameIndex(idx);
        return;
      }

      const elapsed = (now - lastFrameTimeRef.current) * speedRef.current;
      const gap = frames[idx + 1].timestamp - frames[idx].timestamp;

      if (elapsed >= gap) {
        const nextIdx = idx + 1;
        frameIndexRef.current = nextIdx;
        updateDOM(nextIdx);
        lastFrameTimeRef.current = now;
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
  }, [frames, updateDOM]);

  const stopPlayback = useCallback(() => {
    isPlayingRef.current = false;
    cancelAnimationFrame(animFrameRef.current);
    clearInterval(uiUpdateTimer.current);
    setPlayerState('paused');
    setUiFrameIndex(frameIndexRef.current);
  }, []);

  const goTo = useCallback((idx: number) => {
    stopPlayback();
    const clamped = Math.max(0, Math.min(idx, frames.length - 1));
    frameIndexRef.current = clamped;
    setUiFrameIndex(clamped);
    updateDOM(clamped);
  }, [stopPlayback, frames.length, updateDOM]);

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) {
      stopPlayback();
    } else {
      if (frameIndexRef.current >= frames.length - 1) {
        frameIndexRef.current = 0;
        updateDOM(0);
      }
      startPlayback();
    }
  }, [startPlayback, stopPlayback, frames.length, updateDOM]);

  const cycleSpeed = useCallback(() => {
    setSpeed((prev) => SPEEDS[(SPEEDS.indexOf(prev) + 1) % SPEEDS.length]);
  }, []);

  const seekToFraction = useCallback((fraction: number) => {
    if (frames.length === 0) return;
    const targetTs = baseTs + fraction * totalMs;
    let best = 0;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].timestamp <= targetTs) best = i;
      else break;
    }
    goTo(best);
  }, [frames, baseTs, totalMs, goTo]);

  // --- Keyboard ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case ' ': e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft': e.preventDefault(); goTo(frameIndexRef.current - 1); break;
        case 'ArrowRight': e.preventDefault(); goTo(frameIndexRef.current + 1); break;
        case 's': case 'S': cycleSpeed(); break;
        case 'Home': e.preventDefault(); goTo(0); break;
        case 'End': e.preventDefault(); goTo(frames.length - 1); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlay, goTo, cycleSpeed, frames.length]);

  // --- Action markers ---
  const actionMarkers = useMemo(() => {
    if (totalMs === 0) return [];
    return actions
      .filter((a) => a.startTime >= baseTs)
      .map((a) => ({
        pos: Math.max(0, Math.min(1, (a.startTime - baseTs) / totalMs)),
        err: !!a.error,
        label: a.label,
      }));
  }, [actions, baseTs, totalMs]);

  // --- Render ---

  if (playerState === 'loading') {
    return (
      <div className="w-full bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
        <div className="aspect-video flex flex-col items-center justify-center bg-black">
          <Loader2 className="h-10 w-10 text-blue-400 animate-spin mb-3" />
          <p className="text-zinc-400 text-sm">
            {preloadProgress > 0
              ? `Loading frames... ${Math.round(preloadProgress * 100)}%`
              : 'Loading trace data...'}
          </p>
          {preloadProgress > 0 && (
            <div className="w-48 h-1 bg-zinc-800 rounded-full mt-2 overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${preloadProgress * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (playerState === 'error') {
    return (
      <div className="w-full bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
        <div className="aspect-video flex flex-col items-center justify-center bg-black">
          <AlertCircle className="h-10 w-10 text-red-400 mb-3" />
          <p className="text-red-400 text-sm">Failed to load replay data</p>
          <p className="text-zinc-500 text-xs mt-1">{(error as Error)?.message || 'Unknown error'}</p>
        </div>
      </div>
    );
  }

  if (playerState === 'no-frames') {
    return (
      <div className="w-full bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
        <div className="aspect-video flex flex-col items-center justify-center bg-black">
          <AlertCircle className="h-10 w-10 text-zinc-500 mb-3" />
          <p className="text-zinc-400 text-sm">No screencast frames in trace</p>
        </div>
      </div>
    );
  }

  const isPlaying = playerState === 'playing';

  return (
    <div ref={containerRef} className="w-full bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden" tabIndex={0}>
      {/* Viewport */}
      <div className="relative bg-black flex justify-center">
        <div className="relative" style={{ maxWidth: 1280, width: '100%' }}>
          {/* The image - directly manipulated, not driven by React state */}
          <img
            ref={imgRef}
            alt=""
            className="w-full h-auto block"
            draggable={false}
            style={{ imageRendering: 'auto', aspectRatio: '1280/720', background: '#09090b' }}
          />

          {/* Click overlay */}
          <button
            onClick={togglePlay}
            className="absolute inset-0 cursor-pointer focus:outline-none group"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {!isPlaying && playerState === 'ready' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
                <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <Play className="h-8 w-8 text-white ml-1" />
                </div>
              </div>
            )}
          </button>

          {/* Action label - directly manipulated */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none">
            <div
              ref={actionLabelRef}
              className="px-4 py-2 rounded-full text-sm font-medium backdrop-blur-md bg-zinc-900/70 text-zinc-100 border border-zinc-700/50"
            />
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="px-3 pt-2">
        <div
          className="relative h-3 bg-zinc-800 rounded-full cursor-pointer group"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seekToFraction(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
          }}
        >
          {/* Progress - directly manipulated */}
          <div
            ref={progressRef}
            className="absolute top-0 left-0 h-full bg-blue-500 rounded-full"
            style={{ width: '0%', willChange: 'width' }}
          />
          {actionMarkers.map((m, i) => (
            <div
              key={i}
              className={`absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full ${m.err ? 'bg-red-400' : 'bg-green-400'}`}
              style={{ left: `${m.pos * 100}%` }}
              title={m.label}
            />
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center space-x-1">
          <button onClick={() => goTo(0)} className="p-1.5 text-zinc-400 hover:text-white transition-colors rounded" title="Go to start (Home)">
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button onClick={() => goTo(frameIndexRef.current - 1)} className="p-1.5 text-zinc-400 hover:text-white transition-colors rounded" title="Step back (Left)">
            <SkipBack className="h-4 w-4" />
          </button>
          <button onClick={togglePlay} className="p-2 text-white bg-zinc-700 hover:bg-zinc-600 transition-colors rounded-lg" title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}>
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
          </button>
          <button onClick={() => goTo(frameIndexRef.current + 1)} className="p-1.5 text-zinc-400 hover:text-white transition-colors rounded" title="Step forward (Right)">
            <SkipForward className="h-4 w-4" />
          </button>
          <button onClick={() => goTo(frames.length - 1)} className="p-1.5 text-zinc-400 hover:text-white transition-colors rounded" title="Go to end (End)">
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center space-x-3 text-sm text-zinc-400">
          <span ref={timeRef} className="font-mono tabular-nums">0:00 / {fmtTime(totalMs)}</span>
          <span className="text-zinc-600">|</span>
          <span ref={frameCountRef} className="tabular-nums">1 / {frames.length}</span>
          <span className="text-zinc-600">|</span>
          <button onClick={cycleSpeed} className="flex items-center space-x-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors" title="Change speed (S)">
            <Gauge className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">{speed}x</span>
          </button>
        </div>
      </div>
    </div>
  );
}
