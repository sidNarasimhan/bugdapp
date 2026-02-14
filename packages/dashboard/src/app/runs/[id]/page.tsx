'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { api, type TestRun, type Artifact, type AgentRunData } from '@/lib/api';
import { formatDate, formatDuration } from '@/lib/utils';
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Image,
  Video,
  FileText,
  Download,
  Play,
  ExternalLink,
  Ban,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import { AgentReplayTimeline } from '@/components/agent-replay-timeline';
import { ScreenshotPlayer } from '@/components/screenshot-player';

export default function RunDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const queryClient = useQueryClient();
  const [liveRun, setLiveRun] = useState<TestRun | null>(null);

  const cancelMutation = useMutation({
    mutationFn: () => api.cancelRun(id),
    onSuccess: () => {
      setLiveRun(null);
      queryClient.invalidateQueries({ queryKey: ['testRun', id] });
      queryClient.invalidateQueries({ queryKey: ['testRuns'] });
    },
  });

  const { data: run, isLoading } = useQuery({
    queryKey: ['testRun', id],
    queryFn: () => api.getTestRun(id),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === 'RUNNING' || data?.status === 'PENDING') {
        return 3000;
      }
      return false;
    },
  });

  const { data: artifacts = [] } = useQuery({
    queryKey: ['testRunArtifacts', id],
    queryFn: () => api.getTestRunArtifacts(id),
    enabled: !!id && (run?.status === 'PASSED' || run?.status === 'FAILED'),
  });

  // Subscribe to live updates via SSE
  useEffect(() => {
    if (!id || run?.status === 'PASSED' || run?.status === 'FAILED') {
      return;
    }

    const unsubscribe = api.subscribeToRun(id, (updatedRun) => {
      setLiveRun(updatedRun);
    });

    return () => unsubscribe();
  }, [id, run?.status]);

  const currentRun = liveRun || run;

  if (isLoading) {
    return <div className="p-8 text-center text-zinc-400">Loading...</div>;
  }

  if (!currentRun || !currentRun.id) {
    return <div className="p-8 text-center text-zinc-400">Run not found</div>;
  }

  return (
    <div className="p-8">
      <Link
        href="/runs"
        className="inline-flex items-center text-zinc-400 hover:text-white mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Runs
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center">
            {currentRun.recordingName || `Run #${currentRun.id?.slice(0, 8) || 'Unknown'}`}
            <StatusBadge status={currentRun.status || 'PENDING'} className="ml-3" />
          </h1>
          <p className="text-zinc-400 mt-1">
            Started {currentRun.createdAt ? formatDate(currentRun.createdAt) : 'Unknown'}
            {currentRun.headless && ' • Headless mode'}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {(currentRun.status === 'RUNNING' || currentRun.status === 'PENDING') && (
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="flex items-center px-4 py-2 bg-red-600/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-600/30 transition-colors text-sm font-medium disabled:opacity-50"
            >
              <Ban className="h-4 w-4 mr-2" />
              {cancelMutation.isPending ? 'Cancelling...' : 'Cancel Run'}
            </button>
          )}
          {currentRun.durationMs && (
            <div className="text-right">
              <p className="text-sm text-zinc-400">Duration</p>
              <p className="text-xl font-semibold text-white">
                {formatDuration(currentRun.durationMs)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Error Message */}
      {currentRun.error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <h3 className="text-red-400 font-medium mb-2">Error</h3>
          <p className="text-red-300 font-mono text-sm">{currentRun.error}</p>
        </div>
      )}

      {/* Screenshot Replay Player (unified for both SPEC and AGENT modes) */}
      {(currentRun.status === 'PASSED' || currentRun.status === 'FAILED') && (
        <div className="mb-6">
          <h2 className="text-lg font-medium text-white mb-3">Test Replay</h2>
          <ScreenshotPlayer runId={currentRun.id} />
        </div>
      )}

      {/* Agent Details (collapsible) */}
      {currentRun.executionMode === 'AGENT' && currentRun.agentData && (
        <AgentDetailsSection
          agentData={currentRun.agentData}
          runId={currentRun.id}
          passed={currentRun.passed ?? undefined}
        />
      )}

      {/* Running Animation */}
      {(currentRun.status === 'RUNNING' || currentRun.status === 'PENDING') && (
        <div className="mb-6">
          <div className="p-6 bg-zinc-900 rounded-lg border border-zinc-800 text-center">
            <Loader2 className="h-12 w-12 text-white animate-spin mx-auto mb-4" />
            <p className="text-white font-medium">
              {currentRun.status === 'PENDING'
                ? 'Waiting to start...'
                : 'Test is running...'}
            </p>
            <p className="text-sm text-zinc-400 mt-1">
              This page will update automatically
            </p>
            <p className="text-xs text-zinc-500 mt-3">
              Video recording and screenshots will be available after completion
            </p>
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="mt-4 inline-flex items-center px-4 py-2 bg-red-600/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-600/30 transition-colors text-sm font-medium disabled:opacity-50"
            >
              <Ban className="h-4 w-4 mr-2" />
              {cancelMutation.isPending ? 'Cancelling...' : 'Cancel Run'}
            </button>
            {cancelMutation.isError && (
              <p className="mt-2 text-xs text-red-400">
                {(cancelMutation.error as Error).message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Logs */}
      {currentRun.logs && (
        <div className="mb-6">
          <h2 className="text-lg font-medium text-white mb-3">Logs</h2>
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
            <div className="px-4 py-2 bg-zinc-800 border-b border-zinc-700">
              <span className="text-sm text-zinc-300">output.log</span>
            </div>
            <pre className="p-4 text-sm text-zinc-300 font-mono overflow-auto max-h-96">
              {currentRun.logs}
            </pre>
          </div>
        </div>
      )}

      {/* Artifacts */}
      {artifacts.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-white mb-3">Artifacts</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {artifacts.map((artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentDetailsSection({
  agentData,
  runId,
  passed,
}: {
  agentData: AgentRunData;
  runId: string;
  passed?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-6">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="flex items-center gap-2 text-lg font-medium text-white mb-3 hover:text-zinc-300 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        Agent Details
      </button>
      {expanded && (
        <AgentReplayTimeline
          agentData={agentData}
          runId={runId}
          passed={passed}
        />
      )}
    </div>
  );
}

function StatusBadge({
  status,
  className = '',
}: {
  status: string;
  className?: string;
}) {
  const statusConfig: Record<string, {
    icon: typeof Clock;
    color: string;
    bg: string;
    label: string;
    animate?: boolean;
  }> = {
    PENDING: {
      icon: Clock,
      color: 'text-zinc-400',
      bg: 'bg-zinc-500/10',
      label: 'Pending',
    },
    RUNNING: {
      icon: Loader2,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      label: 'Running',
      animate: true,
    },
    PASSED: {
      icon: CheckCircle,
      color: 'text-green-400',
      bg: 'bg-green-500/10',
      label: 'Passed',
    },
    FAILED: {
      icon: XCircle,
      color: 'text-red-400',
      bg: 'bg-red-500/10',
      label: 'Failed',
    },
    CANCELLED: {
      icon: Ban,
      color: 'text-zinc-400',
      bg: 'bg-zinc-500/10',
      label: 'Cancelled',
    },
  };

  const config = statusConfig[status] || statusConfig.PENDING;
  const StatusIcon = config.icon;

  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded text-sm ${config.bg} ${config.color} ${className}`}
    >
      <StatusIcon
        className={`h-4 w-4 mr-1 ${config.animate ? 'animate-spin' : ''}`}
      />
      {config.label}
    </span>
  );
}

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const [showVideo, setShowVideo] = useState(false);

  const iconMap: Record<string, typeof Image> = {
    SCREENSHOT: Image,
    VIDEO: Video,
    TRACE: FileText,
    LOG: FileText,
  };

  const Icon = iconMap[artifact.type] || FileText;

  // Construct the artifact URL (via MinIO or API proxy)
  // Encode each path segment individually to preserve slashes
  const artifactUrl = `/api/artifacts/${artifact.storagePath.split('/').map(encodeURIComponent).join('/')}`;

  return (
    <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
      <div className="flex items-start justify-between">
        <div className="flex items-center">
          <Icon className="h-5 w-5 text-zinc-400 mr-2" />
          <div>
            <p className="text-sm font-medium text-white">{artifact.name}</p>
            <p className="text-xs text-zinc-400">
              {artifact.type}
              {artifact.stepName && ` • ${artifact.stepName}`}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-1">
          {artifact.type === 'TRACE' && (
            <a
              href={`https://trace.playwright.dev`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-zinc-400 hover:text-white transition-colors"
              title="Open in Playwright Trace Viewer"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <a
            href={artifactUrl}
            download={artifact.name}
            className="p-2 text-zinc-400 hover:text-white transition-colors"
            title="Download"
          >
            <Download className="h-4 w-4" />
          </a>
        </div>
      </div>

      {/* Screenshot preview */}
      {artifact.type === 'SCREENSHOT' && (
        <div className="mt-3 bg-zinc-950 rounded overflow-hidden">
          <img
            src={artifactUrl}
            alt={artifact.name}
            className="w-full h-auto"
            onError={(e) => {
              // Fallback to placeholder on error
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      )}

      {/* Video player */}
      {artifact.type === 'VIDEO' && (
        <div className="mt-3">
          {showVideo ? (
            <div className="bg-zinc-950 rounded overflow-hidden">
              <video
                src={artifactUrl}
                controls
                autoPlay
                className="w-full h-auto"
                style={{ maxHeight: '400px' }}
              >
                Your browser does not support the video tag.
              </video>
            </div>
          ) : (
            <button
              onClick={() => setShowVideo(true)}
              className="w-full p-4 bg-zinc-950 rounded flex items-center justify-center hover:bg-zinc-800 transition-colors"
            >
              <Play className="h-8 w-8 text-white mr-2" />
              <span className="text-zinc-300">Play Recording</span>
            </button>
          )}
        </div>
      )}

      {/* Trace viewer link */}
      {artifact.type === 'TRACE' && (
        <div className="mt-3 p-3 bg-zinc-950 rounded text-center">
          <p className="text-xs text-zinc-400 mb-2">
            Download and open at trace.playwright.dev
          </p>
          <a
            href="https://trace.playwright.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-zinc-300 hover:text-zinc-200"
          >
            Open Trace Viewer →
          </a>
        </div>
      )}
    </div>
  );
}
