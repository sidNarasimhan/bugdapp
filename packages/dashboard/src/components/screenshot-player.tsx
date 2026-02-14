'use client';

import { useQuery } from '@tanstack/react-query';
import { api, type FrameItem } from '@/lib/api';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  ImageOff,
} from 'lucide-react';

interface ScreenshotPlayerProps {
  runId: string;
}

const SPEEDS = [1, 2, 4, 8, 16] as const;
type Speed = (typeof SPEEDS)[number];
const TICK_MS = 100; // Fixed tick rate — speed controls how many frames to skip per tick

export function ScreenshotPlayer({ runId }: ScreenshotPlayerProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['frames', runId],
    queryFn: () => api.getFrames(runId),
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(4);
  const [imageLoaded, setImageLoaded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const frames = data?.frames ?? [];
  const frameCount = frames.length;

  // Preload upcoming frames (accounting for speed/skip)
  useEffect(() => {
    if (frameCount === 0) return;
    for (let i = 1; i <= 10; i++) {
      const idx = currentIndex + i * speed;
      if (idx < frameCount) {
        const img = new Image();
        img.src = frames[idx].url;
      }
    }
  }, [currentIndex, frames, frameCount, speed]);

  // Playback interval
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (isPlaying && frameCount > 0) {
      intervalRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          const next = prev + speed;
          if (next >= frameCount - 1) {
            setIsPlaying(false);
            return frameCount - 1;
          }
          return next;
        });
      }, TICK_MS);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, speed, frameCount]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Don't capture if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          setIsPlaying((p) => !p);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setIsPlaying(false);
          setCurrentIndex((p) => Math.max(0, p - 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setIsPlaying(false);
          setCurrentIndex((p) => Math.min(frameCount - 1, p + 1));
          break;
        case 's':
        case 'S':
          setSpeed((prev) => {
            const idx = SPEEDS.indexOf(prev);
            return SPEEDS[(idx + 1) % SPEEDS.length];
          });
          break;
        case 'Home':
          e.preventDefault();
          setIsPlaying(false);
          setCurrentIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setIsPlaying(false);
          setCurrentIndex(Math.max(0, frameCount - 1));
          break;
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [frameCount]);

  const togglePlay = useCallback(() => {
    if (currentIndex >= frameCount - 1) {
      // Restart from beginning
      setCurrentIndex(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((p) => !p);
    }
  }, [currentIndex, frameCount]);

  const cycleSpeed = useCallback(() => {
    setSpeed((prev) => {
      const idx = SPEEDS.indexOf(prev);
      return SPEEDS[(idx + 1) % SPEEDS.length];
    });
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-12 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-zinc-400 animate-spin" />
        <span className="ml-3 text-zinc-400">Loading frames...</span>
      </div>
    );
  }

  // Error / no frames
  if (error || frameCount === 0) {
    return (
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-12 flex flex-col items-center justify-center text-zinc-500">
        <ImageOff className="h-8 w-8 mb-2" />
        <span>No screenshots available</span>
      </div>
    );
  }

  const currentFrame = frames[currentIndex];
  const progress = frameCount > 1 ? currentIndex / (frameCount - 1) : 0;

  return (
    <div
      ref={containerRef}
      className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden"
      tabIndex={0}
    >
      {/* Image display */}
      <div className="relative bg-black aspect-video flex items-center justify-center">
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 text-zinc-600 animate-spin" />
          </div>
        )}
        <img
          src={currentFrame.url}
          alt={currentFrame.label || `Frame ${currentIndex + 1}`}
          className="max-w-full max-h-full object-contain"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageLoaded(true)}
          key={currentFrame.url}
        />

        {/* Action label overlay */}
        {currentFrame.label && (
          <div className="absolute bottom-3 left-3 right-3 flex justify-center pointer-events-none">
            <span className="px-3 py-1.5 bg-black/70 backdrop-blur-sm text-white text-sm rounded-full max-w-[80%] truncate">
              {currentFrame.label}
            </span>
          </div>
        )}
      </div>

      {/* Timeline scrubber */}
      <div className="px-3 pt-2">
        <input
          type="range"
          min={0}
          max={frameCount - 1}
          value={currentIndex}
          onChange={(e) => {
            setIsPlaying(false);
            setCurrentIndex(Number(e.target.value));
          }}
          className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
            [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer
            [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:bg-white
            [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          style={{
            background: `linear-gradient(to right, #a78bfa ${progress * 100}%, #3f3f46 ${progress * 100}%)`,
          }}
        />
      </div>

      {/* Controls */}
      <div className="px-3 pb-3 pt-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {/* First frame */}
          <button
            onClick={() => { setIsPlaying(false); setCurrentIndex(0); }}
            className="p-1.5 text-zinc-400 hover:text-white transition-colors"
            title="First frame (Home)"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>

          {/* Previous frame */}
          <button
            onClick={() => { setIsPlaying(false); setCurrentIndex((p) => Math.max(0, p - 1)); }}
            disabled={currentIndex === 0}
            className="p-1.5 text-zinc-400 hover:text-white transition-colors disabled:opacity-30"
            title="Previous frame (←)"
          >
            <SkipBack className="h-4 w-4" />
          </button>

          {/* Play / Pause */}
          <button
            onClick={togglePlay}
            className="p-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full transition-colors mx-1"
            title="Play/Pause (Space)"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>

          {/* Next frame */}
          <button
            onClick={() => { setIsPlaying(false); setCurrentIndex((p) => Math.min(frameCount - 1, p + 1)); }}
            disabled={currentIndex >= frameCount - 1}
            className="p-1.5 text-zinc-400 hover:text-white transition-colors disabled:opacity-30"
            title="Next frame (→)"
          >
            <SkipForward className="h-4 w-4" />
          </button>

          {/* Last frame */}
          <button
            onClick={() => { setIsPlaying(false); setCurrentIndex(frameCount - 1); }}
            className="p-1.5 text-zinc-400 hover:text-white transition-colors"
            title="Last frame (End)"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>

        {/* Frame counter + speed */}
        <div className="flex items-center gap-3 text-sm">
          <span className="text-zinc-400 tabular-nums">
            {currentIndex + 1} / {frameCount}
          </span>
          <button
            onClick={cycleSpeed}
            className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs font-mono transition-colors"
            title="Cycle speed (S)"
          >
            {speed}x
          </button>
        </div>
      </div>

      {/* Step info for agent mode */}
      {currentFrame.stepDescription && (
        <div className="px-3 pb-2 -mt-1">
          <span className="text-xs text-zinc-500">
            Step {(currentFrame.stepIndex ?? 0) + 1}: {currentFrame.stepDescription}
          </span>
        </div>
      )}
    </div>
  );
}
