'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { api, type SuiteRun } from '@/lib/api';
import { formatDate, formatDuration } from '@/lib/utils';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  Play,
  Image,
} from 'lucide-react';
import Link from 'next/link';

export default function SuiteRunDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const suiteRunId = params.suiteRunId as string;

  const { data: suiteRun, isLoading } = useQuery({
    queryKey: ['suiteRun', suiteRunId],
    queryFn: () => api.getSuiteRun(suiteRunId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'PENDING' || status === 'RUNNING' ? 3000 : false;
    },
  });

  if (isLoading) {
    return (
      <div className="p-8 text-center text-zinc-400">Loading...</div>
    );
  }

  if (!suiteRun) {
    return (
      <div className="p-8 text-center text-zinc-400">Suite run not found</div>
    );
  }

  return (
    <div className="p-8">
      <Link
        href={`/projects/${id}`}
        className="inline-flex items-center text-zinc-400 hover:text-white mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Project
      </Link>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <StatusIcon status={suiteRun.status} size="lg" />
          <h1 className="text-2xl font-bold text-white">
            Suite Run
          </h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-zinc-400">
          <span>
            {suiteRun.passedTests}/{suiteRun.totalTests} tests passed
          </span>
          {suiteRun.durationMs && (
            <span>{formatDuration(suiteRun.durationMs)}</span>
          )}
          <span>{formatDate(suiteRun.createdAt)}</span>
        </div>
        {suiteRun.error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
            {suiteRun.error}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {suiteRun.totalTests > 0 && (
        <div className="mb-6">
          <div className="flex gap-1 h-2">
            {Array.from({ length: suiteRun.totalTests }).map((_, i) => {
              let color = 'bg-zinc-700';
              if (i < suiteRun.passedTests) color = 'bg-green-500';
              else if (i < suiteRun.passedTests + suiteRun.failedTests)
                color = 'bg-red-500';
              else if (suiteRun.status === 'RUNNING') color = 'bg-blue-500 animate-pulse';
              return (
                <div
                  key={i}
                  className={`flex-1 rounded ${color}`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Per-test results */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg">
        <div className="p-4 border-b border-zinc-800">
          <h2 className="text-lg font-medium text-white">Test Results</h2>
        </div>
        <div className="divide-y divide-zinc-800">
          {!suiteRun.testRuns || suiteRun.testRuns.length === 0 ? (
            <div className="p-8 text-center text-zinc-400">
              {suiteRun.status === 'PENDING'
                ? 'Waiting to start...'
                : suiteRun.status === 'RUNNING'
                ? 'Running tests...'
                : 'No test results found'}
            </div>
          ) : (
            suiteRun.testRuns.map((testRun, i) => (
              <Link
                key={testRun.id}
                href={`/runs/${testRun.id}`}
                className="flex items-center px-4 py-3 hover:bg-zinc-800/50 transition-colors"
              >
                <StatusIcon status={testRun.status} />
                <div className="ml-3 flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">
                    {(testRun as any).recordingName || `Test ${i + 1}`}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    {testRun.durationMs && (
                      <span>{formatDuration(testRun.durationMs)}</span>
                    )}
                    {testRun.error && (
                      <span className="text-red-400 truncate max-w-xs">
                        {testRun.error}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Artifact indicators */}
                  {testRun.artifacts && testRun.artifacts.length > 0 && (
                    <div className="flex items-center gap-1">
                      {testRun.artifacts.some((a) => a.type === 'SCREENSHOT') && (
                        <Image className="h-3.5 w-3.5 text-zinc-500" />
                      )}
                      <span className="text-xs text-zinc-500">
                        {testRun.artifacts.length}
                      </span>
                    </div>
                  )}
                  <StatusBadge status={testRun.status} />
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({
  status,
  size = 'sm',
}: {
  status: string;
  size?: 'sm' | 'lg';
}) {
  const sizeClass = size === 'lg' ? 'h-7 w-7' : 'h-5 w-5';
  switch (status) {
    case 'PASSED':
      return <CheckCircle className={`${sizeClass} text-green-500`} />;
    case 'FAILED':
      return <XCircle className={`${sizeClass} text-red-500`} />;
    case 'RUNNING':
      return <Play className={`${sizeClass} text-blue-500 animate-pulse`} />;
    default:
      return <Clock className={`${sizeClass} text-zinc-400`} />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; bg: string }> = {
    PASSED: { color: 'text-green-400', bg: 'bg-green-500/10' },
    FAILED: { color: 'text-red-400', bg: 'bg-red-500/10' },
    RUNNING: { color: 'text-blue-400', bg: 'bg-blue-500/10' },
    PENDING: { color: 'text-zinc-400', bg: 'bg-zinc-800' },
  };
  const c = config[status] || config.PENDING;
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${c.bg} ${c.color}`}>
      {status}
    </span>
  );
}
