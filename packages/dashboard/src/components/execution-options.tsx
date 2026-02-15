'use client';

import { useState } from 'react';
import { Play, Eye } from 'lucide-react';

export type ExecutionMode = 'run' | 'live';

interface ExecutionOptionsProps {
  onRun: (mode: ExecutionMode) => void;
  isRunning?: boolean;
  disabled?: boolean;
}

export function ExecutionOptions({
  onRun,
  isRunning = false,
  disabled = false,
}: ExecutionOptionsProps) {
  const [selectedMode, setSelectedMode] = useState<ExecutionMode>('run');

  const modes = [
    {
      id: 'run' as const,
      label: 'Run Test',
      description: 'Runs in background. Steps fall back to AI if needed.',
      icon: Play,
    },
    {
      id: 'live' as const,
      label: 'Live View',
      description: 'Watch the test run in real-time via VNC.',
      icon: Eye,
    },
  ];

  const handleRun = () => {
    if (!disabled && !isRunning) {
      onRun(selectedMode);
    }
  };

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
      <div className="space-y-2 mb-4">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const isSelected = selectedMode === mode.id;

          return (
            <label
              key={mode.id}
              className={`
                flex items-start p-3 rounded-lg cursor-pointer transition-colors
                ${isSelected
                  ? 'bg-zinc-700/50 border border-zinc-600'
                  : 'bg-zinc-800/50 border border-transparent hover:bg-zinc-800'}
              `}
            >
              <input
                type="radio"
                name="execution-mode"
                value={mode.id}
                checked={isSelected}
                onChange={() => setSelectedMode(mode.id)}
                className="sr-only"
              />
              <Icon className={`h-5 w-5 mt-0.5 mr-3 ${isSelected ? 'text-zinc-300' : 'text-zinc-400'}`} />
              <div className="flex-1">
                <span className={`block text-sm font-medium ${isSelected ? 'text-white' : 'text-zinc-200'}`}>
                  {mode.label}
                </span>
                <span className="text-xs text-zinc-400">
                  {mode.description}
                </span>
              </div>
              {isSelected && (
                <div className="w-2 h-2 rounded-full bg-white mt-2" />
              )}
            </label>
          );
        })}
      </div>

      <button
        onClick={handleRun}
        disabled={disabled || isRunning}
        className={`
          w-full flex items-center justify-center px-4 py-2.5 rounded-lg font-medium transition-colors
          ${disabled || isRunning
            ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
            : 'bg-white hover:bg-zinc-200 text-black'}
        `}
      >
        <Play className={`h-4 w-4 mr-2 ${isRunning ? 'animate-pulse' : ''}`} />
        {isRunning ? 'Running...' : 'Run Test'}
      </button>
    </div>
  );
}

export default ExecutionOptions;
