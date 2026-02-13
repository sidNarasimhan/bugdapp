'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api, type SuiteRun, type ProjectRecording, type LatestSpec } from '@/lib/api';
import { formatDate, formatDuration } from '@/lib/utils';
import {
  ArrowLeft,
  Copy,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
  Wallet,
  Plus,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Sparkles,
  Ban,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PipelineStage, computePipelineStages } from '@/components/pipeline-stage';
import { ClarificationPanel } from '@/components/clarification-panel';
import { SpecCodeViewer } from '@/components/spec-code-viewer';
import { FailureAnalysis } from '@/components/failure-analysis';
import { ExecutionOptions, type ExecutionMode } from '@/components/execution-options';

export default function ProjectDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.getProject(id),
    refetchInterval: (query) => {
      // Auto-refetch while any run is active
      const data = query.state.data;
      if (!data?.recordings) return false;
      const hasActiveRun = data.recordings.some((r) =>
        r.latestSpec?.lastRun?.status === 'RUNNING' || r.latestSpec?.lastRun?.status === 'PENDING'
      );
      return hasActiveRun ? 3000 : false;
    },
  });

  const runSuiteMutation = useMutation({
    mutationFn: () => api.runSuite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', id] });
    },
  });

  const copyAddress = () => {
    if (project?.walletAddress) {
      navigator.clipboard.writeText(project.walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
        Loading...
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8 text-center text-zinc-400">Project not found</div>
    );
  }

  const specCount = project.recordings?.filter((r) => r.latestSpec).length || 0;
  const readyCount = project.recordings?.filter(
    (r) => r.latestSpec && (r.latestSpec.status === 'READY' || r.latestSpec.status === 'TESTED')
  ).length || 0;

  // Recordings without a spec
  const newRecordings = project.recordings?.filter((r) => !r.latestSpec) || [];

  return (
    <div className="p-8">
      <Link
        href="/projects"
        className="inline-flex items-center text-zinc-400 hover:text-white mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Projects
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{project.name}</h1>
          {project.description && (
            <p className="text-zinc-400 mt-1">{project.description}</p>
          )}
          <div className="flex items-center gap-4 mt-2 text-sm text-zinc-500">
            <a
              href={project.homeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center hover:text-zinc-300 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              {project.homeUrl}
            </a>
            <div className="flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5" />
              <code className="text-xs font-mono text-zinc-400">
                {project.walletAddress.slice(0, 6)}...{project.walletAddress.slice(-4)}
              </code>
              <button
                onClick={copyAddress}
                className="text-zinc-500 hover:text-white transition-colors"
                title="Copy full address"
              >
                <Copy className="h-3 w-3" />
              </button>
              {copied && <span className="text-xs text-green-400">Copied!</span>}
            </div>
          </div>
        </div>

        <button
          onClick={() => runSuiteMutation.mutate()}
          disabled={runSuiteMutation.isPending || readyCount === 0}
          className="flex items-center px-4 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
        >
          <Play className="h-4 w-4 mr-2" />
          {runSuiteMutation.isPending ? 'Starting...' : `Run All Tests (${readyCount})`}
        </button>
      </div>

      {runSuiteMutation.isError && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {(runSuiteMutation.error as Error).message}
        </div>
      )}

      {runSuiteMutation.isSuccess && (
        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-sm text-green-400">
          Suite run queued successfully!
        </div>
      )}

      {/* New Recording CTA */}
      {newRecordings.length > 0 && (
        <div className="mb-4 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-blue-400">
            <Sparkles className="h-4 w-4" />
            <span>
              {newRecordings.length} new recording{newRecordings.length !== 1 ? 's' : ''} without test specs.
              Expand to generate.
            </span>
          </div>
        </div>
      )}

      {/* Pipeline Cards */}
      <div className="space-y-2 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-white">Test Pipeline</h2>
          <Link
            href={`/recordings/new?projectId=${project.id}`}
            className="flex items-center text-xs text-zinc-400 hover:text-white transition-colors"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Recording
          </Link>
        </div>

        {!project.recordings || project.recordings.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500 text-sm">
            No recordings yet. Upload a recording to get started.
          </div>
        ) : (
          project.recordings.map((recording) => (
            <RecordingPipelineCard
              key={recording.id}
              recording={recording}
              projectId={id}
            />
          ))
        )}
      </div>

      {/* Suite Runs */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-medium text-white">Suite Runs</h2>
        </div>
        <div className="divide-y divide-zinc-800">
          {!project.recentSuiteRuns || project.recentSuiteRuns.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-sm">
              No suite runs yet. Click &quot;Run All Tests&quot; to start.
            </div>
          ) : (
            project.recentSuiteRuns.map((run, idx) => (
              <SuiteRunRow
                key={run.id}
                run={run}
                projectId={project.id}
                number={project.recentSuiteRuns!.length - idx}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Recording Pipeline Card
// ============================================================================

function RecordingPipelineCard({
  recording,
  projectId,
}: {
  recording: ProjectRecording;
  projectId: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const spec = recording.latestSpec;

  const generateMutation = useMutation({
    mutationFn: () => api.generateTestSpec(recording.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  const runMutation = useMutation({
    mutationFn: (mode: ExecutionMode) => {
      if (!spec) throw new Error('No spec');
      const options = {
        headless: mode === 'headless',
        streamingMode: mode === 'live' ? 'VNC' as const : mode === 'headed' || mode === 'agent' ? 'VIDEO' as const : 'NONE' as const,
        ...(mode === 'agent' && { executionMode: 'AGENT' as const }),
      };
      return api.createTestRun(spec.id, options);
    },
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      router.push(`/runs/${run.id}`);
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: () => api.regenerateSpec(recording.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => {
      const runId = spec?.lastRun?.id;
      if (!runId) throw new Error('No active run');
      return api.cancelRun(runId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteRecording(recording.id),
    onSuccess: () => {
      setShowDeleteConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  const stages = computePipelineStages(
    spec ? {
      status: spec.status,
      pendingClarifications: spec.pendingClarifications,
      lastRun: spec.lastRun,
      runCount: spec.runCount,
    } : null,
    generateMutation.isPending
  );

  // Determine overall status
  const statusInfo = getRecordingStatus(spec);
  const patterns = getPatterns(spec);
  const canRun = spec && (spec.status === 'READY' || spec.status === 'TESTED');
  const lastRun = spec?.lastRun;
  const isRunning = lastRun?.status === 'RUNNING' || lastRun?.status === 'PENDING';

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      {/* Collapsed header */}
      <div
        className="flex items-center px-4 py-3 cursor-pointer hover:bg-zinc-800/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full mr-3 flex-shrink-0 ${statusInfo.dotColor}`} />

        {/* Recording name and meta */}
        <div className="flex-1 min-w-0 mr-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-white truncate">
              {recording.name}
            </p>
            <span className={`text-xs px-1.5 py-0.5 rounded ${statusInfo.badgeBg} ${statusInfo.badgeColor}`}>
              {statusInfo.label}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-zinc-500">
              {recording.stepCount} steps
            </span>
            {patterns.length > 0 && (
              <div className="flex items-center gap-1">
                {patterns.map((p) => (
                  <span key={p} className="text-xs px-1 py-0 rounded bg-zinc-800 text-zinc-400">
                    {p}
                  </span>
                ))}
              </div>
            )}
            {lastRun && !isRunning && (
              <span className="text-xs text-zinc-500">
                {lastRun.status === 'PASSED' ? 'Passed' : lastRun.status === 'FAILED' ? 'Failed' : lastRun.status}
                {lastRun.durationMs ? ` ${formatDuration(lastRun.durationMs)}` : ''}
                {' ago'}
              </span>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {canRun && !isRunning && (
            <button
              onClick={() => runMutation.mutate('headed')}
              disabled={runMutation.isPending}
              className="flex items-center px-2.5 py-1 text-xs bg-white text-black rounded hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              <Play className="h-3 w-3 mr-1" />
              Run
            </button>
          )}
          {isRunning && (
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="flex items-center px-2 py-1 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              <Ban className="h-3 w-3 mr-1" />
              {cancelMutation.isPending ? '...' : 'Cancel'}
            </button>
          )}
        </div>

        {/* Expand chevron */}
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-zinc-500 ml-2 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-zinc-500 ml-2 flex-shrink-0" />
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-zinc-800 pt-3 space-y-4">
          {/* Pipeline visualization */}
          <PipelineStage stages={stages} />

          {/* Content adapts to pipeline stage */}
          <ExpandedContent
            recording={recording}
            spec={spec}
            projectId={projectId}
            isGenerating={generateMutation.isPending}
            onGenerate={() => generateMutation.mutate()}
            onRegenerate={() => regenerateMutation.mutate()}
            onRun={(mode) => runMutation.mutate(mode)}
            onCancel={(runId) => cancelMutation.mutate()}
            onDelete={() => setShowDeleteConfirm(true)}
            isRunning={runMutation.isPending}
            isRegenerating={regenerateMutation.isPending}
            generateError={generateMutation.error}
          />

          {/* Delete recording */}
          <div className="pt-3 border-t border-zinc-800">
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center text-xs text-zinc-500 hover:text-red-400 transition-colors"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Delete Recording
              </button>
            ) : (
              <div className="flex items-center gap-3 p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
                <p className="text-xs text-red-400 flex-1">
                  Delete this recording and all its specs, runs, and artifacts?
                </p>
                <button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Confirm Delete'}
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-3 py-1 text-xs text-zinc-400 border border-zinc-700 rounded hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
            {deleteMutation.isError && (
              <p className="mt-2 text-xs text-red-400">
                {(deleteMutation.error as Error).message}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Expanded Content - adapts based on pipeline stage
// ============================================================================

function ExpandedContent({
  recording,
  spec,
  projectId,
  isGenerating,
  onGenerate,
  onRegenerate,
  onRun,
  onCancel,
  onDelete,
  isRunning,
  isRegenerating,
  generateError,
}: {
  recording: ProjectRecording;
  spec: LatestSpec | null | undefined;
  projectId: string;
  isGenerating: boolean;
  onGenerate: () => void;
  onRegenerate: () => void;
  onRun: (mode: ExecutionMode) => void;
  onCancel: (runId: string) => void;
  onDelete: () => void;
  isRunning: boolean;
  isRegenerating: boolean;
  generateError: Error | null;
}) {
  // (a) No spec yet
  if (!spec && !isGenerating) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-zinc-400">
          Generate a test spec from this recording. The AI will analyze the{' '}
          {recording.stepCount} recorded steps and create a Playwright test.
        </p>
        <button
          onClick={onGenerate}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Generate Test Spec
        </button>
        {generateError && (
          <p className="text-xs text-red-400">{(generateError as Error).message}</p>
        )}
      </div>
    );
  }

  // (b) Generating
  if (isGenerating) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-blue-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>AI is analyzing your recording and generating a test spec...</span>
        </div>
      </div>
    );
  }

  if (!spec) return null;

  const lastRun = spec.lastRun;
  const isActive = lastRun?.status === 'RUNNING' || lastRun?.status === 'PENDING';

  // (c) NEEDS_REVIEW with clarifications
  if (spec.status === 'NEEDS_REVIEW' && spec.pendingClarifications.length > 0) {
    return (
      <div className="space-y-4">
        <ClarificationPanel
          clarifications={spec.pendingClarifications}
          projectId={projectId}
        />

        <SpecCodeViewer
          specId={spec.id}
          code={spec.code}
          projectId={projectId}
        />

        <button
          onClick={onRegenerate}
          disabled={isRegenerating}
          className="flex items-center px-3 py-1.5 text-xs text-zinc-400 hover:text-white border border-zinc-700 rounded hover:border-zinc-600 transition-colors disabled:opacity-50"
        >
          {isRegenerating ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <RefreshCw className="h-3 w-3 mr-1" />
          )}
          Regenerate
        </button>
      </div>
    );
  }

  // (d) READY — can run
  if (spec.status === 'READY' || (spec.status === 'NEEDS_REVIEW' && spec.pendingClarifications.length === 0)) {
    return (
      <div className="space-y-4">
        <SpecCodeViewer
          specId={spec.id}
          code={spec.code}
          projectId={projectId}
        />

        <ExecutionOptions
          onRun={onRun}
          isRunning={isRunning}
        />

        <button
          onClick={onRegenerate}
          disabled={isRegenerating}
          className="flex items-center px-3 py-1.5 text-xs text-zinc-400 hover:text-white border border-zinc-700 rounded hover:border-zinc-600 transition-colors disabled:opacity-50"
        >
          {isRegenerating ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <RefreshCw className="h-3 w-3 mr-1" />
          )}
          Regenerate
        </button>
      </div>
    );
  }

  // (e) Running
  if (isActive) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-blue-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Running test... This will update automatically.</span>
        </div>
        <div className="flex items-center gap-3">
          {lastRun && (
            <Link
              href={`/runs/${lastRun.id}`}
              className="text-xs text-zinc-400 hover:text-white underline"
            >
              View live run details
            </Link>
          )}
          {lastRun && onCancel && (
            <button
              onClick={() => onCancel(lastRun.id)}
              className="flex items-center text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              <Ban className="h-3 w-3 mr-1" />
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  // (f) TESTED / PASSED
  if (spec.status === 'TESTED' && lastRun?.status === 'PASSED') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-green-400">
          <CheckCircle className="h-4 w-4" />
          <span>
            Passed{lastRun.durationMs ? ` in ${formatDuration(lastRun.durationMs)}` : ''}
            {' — '}{formatDate(lastRun.createdAt)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/runs/${lastRun.id}`}
            className="px-3 py-1.5 text-xs bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 transition-colors"
          >
            View Details
          </Link>
          <button
            onClick={() => onRun('headed')}
            disabled={isRunning}
            className="flex items-center px-3 py-1.5 text-xs bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 transition-colors disabled:opacity-50"
          >
            <Play className="h-3 w-3 mr-1" />
            Run Again
          </button>
        </div>

        <SpecCodeViewer
          specId={spec.id}
          code={spec.code}
          projectId={projectId}
        />
      </div>
    );
  }

  // (g) FAILED — with AI analysis
  if (lastRun?.status === 'FAILED' || lastRun?.status === 'TIMEOUT') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-red-400">
          <XCircle className="h-4 w-4" />
          <span>
            Failed{lastRun.durationMs ? ` after ${formatDuration(lastRun.durationMs)}` : ''}
          </span>
        </div>

        {lastRun.error && (
          <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
            <code className="text-xs text-red-400 font-mono break-all">
              {lastRun.error.length > 200 ? lastRun.error.slice(0, 200) + '...' : lastRun.error}
            </code>
          </div>
        )}

        <FailureAnalysis
          specId={spec.id}
          specCode={spec.code}
          projectId={projectId}
          error={lastRun.error}
        />

        <div className="flex items-center gap-2">
          <Link
            href={`/runs/${lastRun.id}`}
            className="px-3 py-1.5 text-xs bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 transition-colors"
          >
            View Full Details
          </Link>
          <button
            onClick={() => onRun('headed')}
            disabled={isRunning}
            className="flex items-center px-3 py-1.5 text-xs bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 transition-colors disabled:opacity-50"
          >
            <Play className="h-3 w-3 mr-1" />
            Run Again
          </button>
        </div>

        <SpecCodeViewer
          specId={spec.id}
          code={spec.code}
          projectId={projectId}
        />
      </div>
    );
  }

  // Default: show code and run options
  return (
    <div className="space-y-4">
      <SpecCodeViewer
        specId={spec.id}
        code={spec.code}
        projectId={projectId}
      />

      <ExecutionOptions
        onRun={onRun}
        isRunning={isRunning}
        disabled={spec.status === 'DRAFT'}
      />

      <button
        onClick={onRegenerate}
        disabled={isRegenerating}
        className="flex items-center px-3 py-1.5 text-xs text-zinc-400 hover:text-white border border-zinc-700 rounded hover:border-zinc-600 transition-colors disabled:opacity-50"
      >
        {isRegenerating ? (
          <Loader2 className="h-3 w-3 animate-spin mr-1" />
        ) : (
          <RefreshCw className="h-3 w-3 mr-1" />
        )}
        Regenerate
      </button>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function getRecordingStatus(spec: LatestSpec | null | undefined) {
  if (!spec) {
    return {
      label: 'No Spec',
      dotColor: 'bg-zinc-600',
      badgeBg: 'bg-zinc-800',
      badgeColor: 'text-zinc-400',
    };
  }

  const lastRun = spec.lastRun;

  if (lastRun?.status === 'RUNNING' || lastRun?.status === 'PENDING') {
    return {
      label: 'Running',
      dotColor: 'bg-blue-500 animate-pulse',
      badgeBg: 'bg-blue-500/10',
      badgeColor: 'text-blue-400',
    };
  }

  if (spec.status === 'TESTED' && lastRun?.status === 'PASSED') {
    return {
      label: 'Passed',
      dotColor: 'bg-green-500',
      badgeBg: 'bg-green-500/10',
      badgeColor: 'text-green-400',
    };
  }

  if (lastRun?.status === 'FAILED' || lastRun?.status === 'TIMEOUT') {
    return {
      label: 'Failed',
      dotColor: 'bg-red-500',
      badgeBg: 'bg-red-500/10',
      badgeColor: 'text-red-400',
    };
  }

  if (spec.status === 'NEEDS_REVIEW') {
    return {
      label: `Review (${spec.pendingClarifications.length}Q)`,
      dotColor: 'bg-amber-500',
      badgeBg: 'bg-amber-500/10',
      badgeColor: 'text-amber-400',
    };
  }

  if (spec.status === 'READY' || spec.status === 'TESTED') {
    return {
      label: 'Ready',
      dotColor: 'bg-blue-500',
      badgeBg: 'bg-blue-500/10',
      badgeColor: 'text-blue-400',
    };
  }

  return {
    label: spec.status,
    dotColor: 'bg-zinc-600',
    badgeBg: 'bg-zinc-800',
    badgeColor: 'text-zinc-400',
  };
}

function getPatterns(spec: LatestSpec | null | undefined): string[] {
  if (!spec?.patterns) return [];
  try {
    // patterns is a JSON field — could be an array of strings or an object
    if (Array.isArray(spec.patterns)) {
      return spec.patterns.map((p: unknown) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object' && 'type' in p) return (p as { type: string }).type;
        return String(p);
      }).slice(0, 3);
    }
    if (typeof spec.patterns === 'object') {
      // Could be { detected: ['wallet_connect', ...] }
      const obj = spec.patterns as Record<string, unknown>;
      if (Array.isArray(obj.detected)) {
        return obj.detected.map(String).slice(0, 3);
      }
      // Just show the keys
      return Object.keys(obj).slice(0, 3);
    }
  } catch {
    // ignore
  }
  return [];
}

// ============================================================================
// Suite Run Row (unchanged from before)
// ============================================================================

function SuiteRunRow({
  run,
  projectId,
  number,
}: {
  run: SuiteRun;
  projectId: string;
  number: number;
}) {
  const statusConfig: Record<string, { color: string; bg: string }> = {
    PASSED: { color: 'text-green-400', bg: 'bg-green-500/10' },
    FAILED: { color: 'text-red-400', bg: 'bg-red-500/10' },
    RUNNING: { color: 'text-blue-400', bg: 'bg-blue-500/10' },
    CANCELLED: { color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
    PENDING: { color: 'text-zinc-400', bg: 'bg-zinc-800' },
  };
  const status = statusConfig[run.status] || statusConfig.PENDING;

  return (
    <Link
      href={`/projects/${projectId}/suite-runs/${run.id}`}
      className="flex items-center px-4 py-3 hover:bg-zinc-800/50 transition-colors"
    >
      <StatusIcon status={run.status} />
      <div className="ml-3 flex-1 min-w-0">
        <p className="text-sm font-medium text-white">
          #{number}
        </p>
        <p className="text-xs text-zinc-500">
          {run.passedTests}/{run.totalTests} passed
          {run.durationMs ? ` · ${formatDuration(run.durationMs)}` : ''}
          {' · '}{formatDate(run.createdAt)}
        </p>
      </div>
      <span className={`text-xs px-2 py-0.5 rounded ${status.bg} ${status.color}`}>
        {run.status}
      </span>
    </Link>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'PASSED':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'FAILED':
      return <XCircle className="h-4 w-4 text-red-500" />;
    case 'RUNNING':
      return <Play className="h-4 w-4 text-blue-500 animate-pulse" />;
    default:
      return <Clock className="h-4 w-4 text-zinc-500" />;
  }
}
