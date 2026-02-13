'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { api, type TestRun } from '@/lib/api';
import { formatDate, formatDuration } from '@/lib/utils';
import { useState, Suspense } from 'react';
import {
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  RefreshCw,
  Activity,
  TrendingUp,
  AlertTriangle,
  Ban,
} from 'lucide-react';
import Link from 'next/link';

export default function RunsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-zinc-400">Loading...</div>}>
      <RunsContent />
    </Suspense>
  );
}

type StatusFilter = 'ALL' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'RUNNING' | 'PENDING';

function RunsContent() {
  const searchParams = useSearchParams();
  const testSpecId = searchParams.get('testSpecId');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  const {
    data: runs = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['testRuns', testSpecId],
    queryFn: () => api.getTestRuns(testSpecId || undefined),
    refetchInterval: (query) => {
      const data = query.state.data as TestRun[] | undefined;
      if (data?.some((r) => r.status === 'RUNNING' || r.status === 'PENDING')) {
        return 3000;
      }
      return false;
    },
  });

  // Compute stats from runs
  const passed = runs.filter((r) => r.status === 'PASSED').length;
  const failed = runs.filter((r) => r.status === 'FAILED').length;
  const cancelled = runs.filter((r) => r.status === 'CANCELLED').length;
  const running = runs.filter((r) => r.status === 'RUNNING').length;
  const pending = runs.filter((r) => r.status === 'PENDING').length;
  const passRate = runs.length > 0 ? Math.round((passed / runs.length) * 100) : 0;

  // Filter
  const filteredRuns = statusFilter === 'ALL'
    ? runs
    : runs.filter((r) => r.status === statusFilter);

  const filterButtons: { value: StatusFilter; label: string; count: number; color: string }[] = [
    { value: 'ALL', label: 'All', count: runs.length, color: 'text-zinc-300' },
    { value: 'PASSED', label: 'Passed', count: passed, color: 'text-green-400' },
    { value: 'FAILED', label: 'Failed', count: failed, color: 'text-red-400' },
    { value: 'CANCELLED', label: 'Cancelled', count: cancelled, color: 'text-zinc-400' },
    { value: 'RUNNING', label: 'Running', count: running, color: 'text-blue-400' },
    { value: 'PENDING', label: 'Pending', count: pending, color: 'text-zinc-400' },
  ];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Run History</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {runs.length} total runs
            {testSpecId && ' (filtered by spec)'}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center px-3 py-2 text-zinc-400 hover:text-white transition-colors"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </button>
      </div>

      {/* Stats Summary */}
      {runs.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            label="Pass Rate"
            value={`${passRate}%`}
            icon={TrendingUp}
            color={passRate >= 80 ? 'text-green-400' : passRate >= 50 ? 'text-amber-400' : 'text-red-400'}
          />
          <StatCard label="Passed" value={passed} icon={CheckCircle} color="text-green-400" />
          <StatCard label="Failed" value={failed} icon={XCircle} color="text-red-400" />
          <StatCard
            label="Active"
            value={running + pending}
            icon={running > 0 ? Loader2 : Activity}
            color={running > 0 ? 'text-blue-400' : 'text-zinc-500'}
            animate={running > 0}
          />
        </div>
      )}

      {/* Status Filter */}
      <div className="flex items-center gap-1 mb-4 bg-zinc-900 border border-zinc-800 rounded-lg p-1 w-fit">
        {filterButtons.map((btn) => (
          <button
            key={btn.value}
            onClick={() => setStatusFilter(btn.value)}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              statusFilter === btn.value
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            {btn.label}
            {btn.count > 0 && (
              <span className={`ml-1.5 ${statusFilter === btn.value ? btn.color : 'text-zinc-500'}`}>
                {btn.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Runs List */}
      {isLoading ? (
        <div className="text-center py-12 text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
          Loading...
        </div>
      ) : filteredRuns.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          {runs.length === 0
            ? 'No test runs yet. Generate a spec and run it from a project page.'
            : `No ${statusFilter.toLowerCase()} runs.`}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRuns.map((run) => (
            <RunCard key={run.id} run={run} testSpecId={testSpecId} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  animate,
}: {
  label: string;
  value: number | string;
  icon: typeof Clock;
  color: string;
  animate?: boolean;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-3.5 w-3.5 ${color} ${animate ? 'animate-spin' : ''}`} />
        <span className="text-xs text-zinc-500">{label}</span>
      </div>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function RunCard({ run, testSpecId }: { run: TestRun; testSpecId: string | null }) {
  const queryClient = useQueryClient();
  const cancelMutation = useMutation({
    mutationFn: () => api.cancelRun(run.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testRuns', testSpecId] });
    },
  });

  const isActive = run.status === 'RUNNING' || run.status === 'PENDING';

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
    TIMEOUT: {
      icon: AlertTriangle,
      color: 'text-orange-400',
      bg: 'bg-orange-500/10',
      label: 'Timeout',
    },
    CANCELLED: {
      icon: Ban,
      color: 'text-zinc-400',
      bg: 'bg-zinc-500/10',
      label: 'Cancelled',
    },
  };

  const status = statusConfig[run.status] || statusConfig.PENDING;
  const StatusIcon = status.icon;

  return (
    <Link
      href={`/runs/${run.id}`}
      className="flex items-center p-4 bg-zinc-900 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors"
    >
      <StatusIcon
        className={`h-5 w-5 ${status.color} ${status.animate ? 'animate-spin' : ''} flex-shrink-0`}
      />
      <div className="ml-3 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-white truncate">
            {run.recordingName || `Run #${run.id.slice(0, 8)}`}
          </h3>
          {run.headless && (
            <span className="text-xs px-1.5 py-0 rounded bg-zinc-800 text-zinc-500">headless</span>
          )}
        </div>
        <p className="text-xs text-zinc-500 mt-0.5">
          {formatDate(run.createdAt)}
          {run.durationMs ? ` · ${formatDuration(run.durationMs)}` : ''}
          {run.streamingMode && run.streamingMode !== 'NONE' ? ` · ${run.streamingMode}` : ''}
        </p>
      </div>

      {run.error && (
        <p className="text-xs text-red-400 max-w-xs truncate mr-3 hidden md:block">
          {run.error}
        </p>
      )}

      {isActive && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            cancelMutation.mutate();
          }}
          disabled={cancelMutation.isPending}
          className="flex items-center px-2 py-1 mr-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors disabled:opacity-50"
        >
          <Ban className="h-3 w-3 mr-1" />
          {cancelMutation.isPending ? '...' : 'Cancel'}
        </button>
      )}

      <span className={`text-xs px-2 py-1 rounded flex-shrink-0 ${status.bg} ${status.color}`}>
        {status.label}
      </span>
    </Link>
  );
}
