'use client';

import { Check, Loader2, AlertTriangle, X } from 'lucide-react';

export type StageStatus = 'done' | 'active' | 'warning' | 'error' | 'pending';

interface Stage {
  label: string;
  status: StageStatus;
}

interface PipelineStageProps {
  stages: Stage[];
}

function StageIcon({ status }: { status: StageStatus }) {
  switch (status) {
    case 'done':
      return <Check className="h-3 w-3 text-green-400" />;
    case 'active':
      return <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />;
    case 'warning':
      return <AlertTriangle className="h-3 w-3 text-amber-400" />;
    case 'error':
      return <X className="h-3 w-3 text-red-400" />;
    default:
      return <div className="h-1.5 w-1.5 rounded-full bg-zinc-600" />;
  }
}

const statusColors: Record<StageStatus, string> = {
  done: 'text-green-400',
  active: 'text-blue-400',
  warning: 'text-amber-400',
  error: 'text-red-400',
  pending: 'text-zinc-600',
};

const connectorColors: Record<StageStatus, string> = {
  done: 'bg-green-400/30',
  active: 'bg-blue-400/30',
  warning: 'bg-amber-400/30',
  error: 'bg-red-400/30',
  pending: 'bg-zinc-700',
};

export function PipelineStage({ stages }: PipelineStageProps) {
  return (
    <div className="flex items-center gap-1">
      {stages.map((stage, i) => (
        <div key={stage.label} className="flex items-center">
          <div className="flex items-center gap-1">
            <div className="flex items-center justify-center w-4 h-4">
              <StageIcon status={stage.status} />
            </div>
            <span className={`text-xs font-medium ${statusColors[stage.status]}`}>
              {stage.label}
            </span>
          </div>
          {i < stages.length - 1 && (
            <div className={`w-4 h-px mx-1 ${connectorColors[stages[i + 1].status === 'pending' ? 'pending' : stage.status]}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// Helper to compute pipeline stages from recording data
export function computePipelineStages(spec: {
  status: string;
  pendingClarifications: unknown[];
  lastRun: { status: string } | null;
  runCount: number;
} | null | undefined, isGenerating?: boolean): Stage[] {
  // No spec at all
  if (!spec) {
    return [
      { label: 'Record', status: 'done' },
      { label: 'Analyze', status: 'pending' },
      { label: 'Generate', status: 'pending' },
      { label: 'Review', status: 'pending' },
      { label: 'Test', status: 'pending' },
    ];
  }

  if (isGenerating) {
    return [
      { label: 'Record', status: 'done' },
      { label: 'Analyze', status: 'done' },
      { label: 'Generate', status: 'active' },
      { label: 'Review', status: 'pending' },
      { label: 'Test', status: 'pending' },
    ];
  }

  const hasCode = spec.status !== 'DRAFT';
  const needsReview = spec.status === 'NEEDS_REVIEW' && spec.pendingClarifications.length > 0;
  const isReady = spec.status === 'READY';
  const isTested = spec.status === 'TESTED';
  const lastRun = spec.lastRun;
  const isRunning = lastRun?.status === 'RUNNING' || lastRun?.status === 'PENDING';
  const passed = lastRun?.status === 'PASSED';
  const failed = lastRun?.status === 'FAILED' || lastRun?.status === 'TIMEOUT';

  // Test stage
  let testStatus: StageStatus = 'pending';
  if (isRunning) testStatus = 'active';
  else if (passed) testStatus = 'done';
  else if (failed) testStatus = 'error';
  else if (isReady || isTested) testStatus = 'pending';

  // Review stage
  let reviewStatus: StageStatus = 'pending';
  if (needsReview) reviewStatus = 'warning';
  else if (isReady || isTested) reviewStatus = 'done';
  else if (hasCode) reviewStatus = 'done';

  return [
    { label: 'Record', status: 'done' },
    { label: 'Analyze', status: hasCode ? 'done' : 'pending' },
    { label: 'Generate', status: hasCode ? 'done' : 'pending' },
    { label: 'Review', status: reviewStatus },
    { label: 'Test', status: testStatus },
  ];
}
