'use client';

import { useState, useCallback } from 'react';
import type { AgentRunData, AgentAction, AgentStepData } from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import {
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Mouse,
  Keyboard,
  Wallet,
  Globe,
  ArrowDown,
  Timer,
  Zap,
  Eye,
  X,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  DollarSign,
  Cpu,
} from 'lucide-react';

interface AgentReplayTimelineProps {
  agentData: AgentRunData;
  runId: string;
  passed?: boolean;
}

export function AgentReplayTimeline({ agentData, runId, passed }: AgentReplayTimelineProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [lightbox, setLightbox] = useState<{ src: string; screenshots: string[]; index: number } | null>(null);

  const toggleStep = useCallback((idx: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }, []);

  const allScreenshots = agentData.steps.flatMap((step) =>
    step.actions.flatMap((a) => [a.screenshotBefore, a.screenshotAfter].filter(Boolean) as string[])
  );

  const openLightbox = useCallback(
    (filename: string) => {
      const idx = allScreenshots.indexOf(filename);
      setLightbox({ src: filename, screenshots: allScreenshots, index: idx >= 0 ? idx : 0 });
    },
    [allScreenshots]
  );

  const closeLightbox = useCallback(() => setLightbox(null), []);

  const navigateLightbox = useCallback((dir: -1 | 1) => {
    setLightbox((prev) => {
      if (!prev) return null;
      const newIdx = prev.index + dir;
      if (newIdx < 0 || newIdx >= prev.screenshots.length) return prev;
      return { ...prev, src: prev.screenshots[newIdx], index: newIdx };
    });
  }, []);

  const totalCalls = agentData.usage.totalApiCalls;
  const totalCost = agentData.usage.estimatedCostUsd;
  const totalDuration = agentData.steps.reduce((sum, s) => sum + s.durationMs, 0);
  const passedSteps = agentData.steps.filter((s) => s.status === 'passed').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Cpu className="h-5 w-5 text-purple-400" />
            <span className="text-white font-medium">Agent Run</span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                passed ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
              }`}
            >
              {passed ? 'PASSED' : 'FAILED'}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-zinc-400">
            <span className="flex items-center gap-1">
              <Zap className="h-3.5 w-3.5" />
              {totalCalls} calls
            </span>
            <span className="flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5" />
              ${totalCost.toFixed(3)}
            </span>
            <span className="flex items-center gap-1">
              <Timer className="h-3.5 w-3.5" />
              {formatDuration(totalDuration)}
            </span>
            <span className="text-zinc-500 text-xs">
              {agentData.model.split('-').slice(-1)[0]}
            </span>
          </div>
        </div>
        <div className="mt-2 text-xs text-zinc-500">
          {passedSteps}/{agentData.steps.length} steps passed
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {agentData.steps.map((step, idx) => (
          <StepCard
            key={step.stepId}
            step={step}
            index={idx}
            expanded={expandedSteps.has(idx)}
            onToggle={() => toggleStep(idx)}
            runId={runId}
            onScreenshotClick={openLightbox}
          />
        ))}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <Lightbox
          src={lightbox.src}
          runId={runId}
          index={lightbox.index}
          total={lightbox.screenshots.length}
          onClose={closeLightbox}
          onPrev={() => navigateLightbox(-1)}
          onNext={() => navigateLightbox(1)}
        />
      )}
    </div>
  );
}

function StepCard({
  step,
  index,
  expanded,
  onToggle,
  runId,
  onScreenshotClick,
}: {
  step: AgentStepData;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  runId: string;
  onScreenshotClick: (filename: string) => void;
}) {
  const isPassed = step.status === 'passed';

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
      {/* Step header */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isPassed ? (
            <CheckCircle className="h-4 w-4 text-green-400 flex-shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
          )}
          <span className="text-sm text-white">
            <span className="text-zinc-500">Step {index + 1}:</span>{' '}
            {step.description}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">
            {step.apiCalls} calls, {formatDuration(step.durationMs)}
          </span>
          {step.actions.length > 0 && (
            <span className="text-xs text-zinc-600">
              {step.actions.length} actions
            </span>
          )}
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-zinc-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-500" />
          )}
        </div>
      </button>

      {/* Step error */}
      {!expanded && step.error && (
        <div className="px-4 pb-3 -mt-1">
          <p className="text-xs text-red-400 truncate">{step.error}</p>
        </div>
      )}

      {/* Expanded: action list */}
      {expanded && (
        <div className="border-t border-zinc-800">
          {step.actions.length === 0 ? (
            <div className="px-4 py-3 text-xs text-zinc-500">
              No tracked actions (only snapshots)
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/50">
              {step.actions.map((action, actionIdx) => (
                <ActionRow
                  key={actionIdx}
                  action={action}
                  runId={runId}
                  onScreenshotClick={onScreenshotClick}
                />
              ))}
            </div>
          )}
          {step.error && (
            <div className="px-4 py-3 bg-red-500/5 border-t border-red-500/10">
              <p className="text-xs text-red-400">{step.error}</p>
            </div>
          )}
          {step.summary && (
            <div className="px-4 py-2 bg-zinc-800/30 border-t border-zinc-800">
              <p className="text-xs text-zinc-400">{step.summary}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionRow({
  action,
  runId,
  onScreenshotClick,
}: {
  action: AgentAction;
  runId: string;
  onScreenshotClick: (filename: string) => void;
}) {
  const toolConfig = getToolConfig(action.tool);
  const Icon = toolConfig.icon;

  return (
    <div className="px-4 py-2.5 flex items-start gap-3 hover:bg-zinc-800/30 transition-colors">
      {/* Tool badge */}
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono flex-shrink-0 ${toolConfig.color}`}
      >
        <Icon className="h-3 w-3" />
        {action.tool}
      </span>

      {/* Description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {action.success ? (
            <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
          ) : (
            <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
          )}
          <span className="text-xs text-zinc-300 truncate">
            {getActionDescription(action)}
          </span>
          <span className="text-xs text-zinc-600 flex-shrink-0">
            {formatDuration(action.durationMs)}
          </span>
        </div>

        {/* Screenshots */}
        {(action.screenshotBefore || action.screenshotAfter) && (
          <div className="flex gap-2 mt-1.5">
            {action.screenshotBefore && (
              <ScreenshotThumb
                filename={action.screenshotBefore}
                label="before"
                runId={runId}
                onClick={() => onScreenshotClick(action.screenshotBefore!)}
              />
            )}
            {action.screenshotAfter && (
              <ScreenshotThumb
                filename={action.screenshotAfter}
                label="after"
                runId={runId}
                onClick={() => onScreenshotClick(action.screenshotAfter!)}
              />
            )}
          </div>
        )}

        {/* Error output for failed actions */}
        {!action.success && (
          <p className="text-xs text-red-400/80 mt-1 truncate">{action.output}</p>
        )}
      </div>
    </div>
  );
}

function ScreenshotThumb({
  filename,
  label,
  runId,
  onClick,
}: {
  filename: string;
  label: string;
  runId: string;
  onClick: () => void;
}) {
  const src = `/api/artifacts/runs/${runId}/screenshot/${encodeURIComponent(filename)}`;

  return (
    <button
      onClick={onClick}
      className="relative group flex-shrink-0 w-24 h-16 rounded overflow-hidden border border-zinc-700 hover:border-zinc-500 transition-colors bg-zinc-950"
    >
      <img
        src={src}
        alt={`${label} screenshot`}
        className="w-full h-full object-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <Eye className="h-4 w-4 text-white" />
      </div>
      <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[10px] text-zinc-400 text-center py-0.5">
        {label}
      </span>
    </button>
  );
}

function Lightbox({
  src,
  runId,
  index,
  total,
  onClose,
  onPrev,
  onNext,
}: {
  src: string;
  runId: string;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const imgSrc = `/api/artifacts/runs/${runId}/screenshot/${encodeURIComponent(src)}`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl max-h-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 p-2 text-zinc-400 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Image */}
        <img
          src={imgSrc}
          alt="Screenshot"
          className="max-w-full max-h-[80vh] rounded-lg"
        />

        {/* Navigation */}
        <div className="flex items-center justify-between mt-3">
          <button
            onClick={onPrev}
            disabled={index <= 0}
            className="p-2 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-sm text-zinc-400">
            {index + 1} / {total}
          </span>
          <button
            onClick={onNext}
            disabled={index >= total - 1}
            className="p-2 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Filename */}
        <p className="text-center text-xs text-zinc-500 mt-1">{src}</p>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function getToolConfig(toolName: string): { icon: typeof Mouse; color: string } {
  if (toolName.startsWith('browser_click')) return { icon: Mouse, color: 'bg-emerald-500/10 text-emerald-400' };
  if (toolName.startsWith('browser_type')) return { icon: Keyboard, color: 'bg-emerald-500/10 text-emerald-400' };
  if (toolName.startsWith('browser_navigate')) return { icon: Globe, color: 'bg-blue-500/10 text-blue-400' };
  if (toolName.startsWith('browser_scroll')) return { icon: ArrowDown, color: 'bg-zinc-500/10 text-zinc-400' };
  if (toolName.startsWith('browser_')) return { icon: Globe, color: 'bg-emerald-500/10 text-emerald-400' };
  if (toolName.startsWith('wallet_') || toolName.startsWith('assert_wallet')) return { icon: Wallet, color: 'bg-purple-500/10 text-purple-400' };
  if (toolName.startsWith('step_') || toolName.startsWith('test_')) return { icon: Zap, color: 'bg-zinc-500/10 text-zinc-400' };
  return { icon: Zap, color: 'bg-zinc-500/10 text-zinc-400' };
}

function getActionDescription(action: AgentAction): string {
  const { tool, input, elementDesc } = action;

  if (tool === 'browser_click') {
    return elementDesc || (input.description as string) || `[${input.ref}]`;
  }
  if (tool === 'browser_type') {
    const target = elementDesc || `[${input.ref}]`;
    return `${target} = "${input.text}"`;
  }
  if (tool === 'browser_navigate') {
    return String(input.url || '');
  }
  if (tool === 'browser_scroll') {
    return `scroll ${input.direction}`;
  }
  if (tool === 'browser_press_key') {
    return `key: ${input.key}`;
  }
  if (tool === 'browser_evaluate') {
    return String(input.expression || '').slice(0, 60);
  }
  if (tool === 'browser_wait') {
    return input.text ? `wait for "${input.text}"` : `sleep`;
  }
  if (tool === 'wallet_approve') return 'Approve wallet connection';
  if (tool === 'wallet_switch_network') return `Switch to ${input.network || 'network'}`;
  if (tool === 'wallet_sign') return 'Sign message';
  if (tool === 'wallet_confirm_transaction') return 'Confirm transaction';
  if (tool === 'assert_wallet_connected') return 'Verify wallet connected';
  if (tool === 'step_complete') return String(input.summary || 'Step complete');
  if (tool === 'step_failed') return String(input.error || 'Step failed');
  if (tool === 'test_complete') return String(input.summary || 'Test complete');

  return action.output.slice(0, 60);
}
