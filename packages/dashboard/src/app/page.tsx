'use client';

import { useQuery } from '@tanstack/react-query';
import { api, type PlatformStats } from '@/lib/api';
import { formatDate, formatDuration } from '@/lib/utils';
import {
  CheckCircle,
  XCircle,
  Clock,
  Play,
  Plus,
  FolderKanban,
  ArrowRight,
  Activity,
  FileCode,
  Disc,
  TrendingUp,
  Loader2,
  AlertTriangle,
  Ban,
} from 'lucide-react';
import Link from 'next/link';

export default function Dashboard() {
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects(),
  });

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.getStats(),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.runs.running > 0 || data.runs.pending > 0)) {
        return 3000;
      }
      return 15000; // light poll every 15s
    },
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <Link
          href="/projects/new"
          className="flex items-center px-4 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors text-sm font-medium"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Project
        </Link>
      </div>

      {/* Live Stats */}
      {stats && <StatsGrid stats={stats} />}

      {/* Active Runs Banner */}
      {stats && (stats.runs.running > 0 || stats.runs.pending > 0) && (
        <div className="mb-6 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-blue-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              {stats.runs.running} running, {stats.runs.pending} pending
            </span>
            <Link href="/runs" className="ml-auto text-xs underline hover:text-white">
              View runs
            </Link>
          </div>
        </div>
      )}

      {/* Projects */}
      {projects.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-12 text-center mb-8">
          <FolderKanban className="h-10 w-10 text-zinc-600 mx-auto mb-4" />
          <h2 className="text-lg font-medium text-white mb-2">No projects yet</h2>
          <p className="text-zinc-400 text-sm mb-6">
            Create a project to start recording and testing dApp interactions.
          </p>
          <Link
            href="/projects/new"
            className="inline-flex items-center px-4 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors text-sm font-medium"
          >
            Create your first project
          </Link>
        </div>
      ) : (
        <div className="mb-8">
          <h2 className="text-sm font-medium text-white mb-3">Projects</h2>
          <div className="grid gap-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="flex items-center justify-between p-4 bg-zinc-900 border border-zinc-800 rounded-lg hover:border-zinc-700 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-medium text-white group-hover:text-zinc-50 truncate">
                      {project.name}
                    </h3>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                    <span>{project.recordingCount || 0} recordings</span>
                    <span>{project.suiteRunCount || 0} suite runs</span>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-medium text-white">Recent Activity</h2>
          <Link href="/runs" className="text-xs text-zinc-400 hover:text-white transition-colors">
            View all runs
          </Link>
        </div>
        <div className="divide-y divide-zinc-800">
          {!stats?.recentRuns || stats.recentRuns.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-sm">
              No test runs yet. Record a dApp interaction and generate a test.
            </div>
          ) : (
            stats.recentRuns.map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex items-center px-4 py-3 hover:bg-zinc-800/50 transition-colors"
              >
                <RunStatusIcon status={run.status} />
                <div className="ml-3 flex-1 min-w-0">
                  <p className="text-sm text-white truncate">
                    {run.recordingName || `Run #${run.id.slice(0, 8)}`}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {formatDate(run.createdAt)}
                    {run.durationMs ? ` · ${formatDuration(run.durationMs)}` : ''}
                  </p>
                </div>
                {run.error && (
                  <AlertTriangle className="h-3 w-3 text-red-400 mr-2 flex-shrink-0" />
                )}
                <span className={`text-xs px-2 py-0.5 rounded ${
                  run.status === 'PASSED' ? 'bg-green-500/10 text-green-400' :
                  run.status === 'FAILED' ? 'bg-red-500/10 text-red-400' :
                  run.status === 'RUNNING' ? 'bg-blue-500/10 text-blue-400' :
                  'bg-zinc-800 text-zinc-400'
                }`}>
                  {run.status}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatsGrid({ stats }: { stats: PlatformStats }) {
  const cards = [
    {
      label: 'Projects',
      value: stats.projects,
      icon: FolderKanban,
      color: 'text-zinc-300',
    },
    {
      label: 'Recordings',
      value: stats.recordings,
      icon: Disc,
      color: 'text-zinc-300',
    },
    {
      label: 'Test Specs',
      value: stats.specs,
      icon: FileCode,
      color: 'text-zinc-300',
    },
    {
      label: 'Total Runs',
      value: stats.runs.total,
      icon: Activity,
      color: 'text-zinc-300',
      subtitle: stats.runs.total > 0
        ? `${stats.runs.passed} passed · ${stats.runs.failed} failed`
        : undefined,
    },
    {
      label: 'Pass Rate',
      value: `${stats.runs.passRate}%`,
      icon: TrendingUp,
      color: stats.runs.passRate >= 80 ? 'text-green-400' :
             stats.runs.passRate >= 50 ? 'text-amber-400' :
             stats.runs.total === 0 ? 'text-zinc-500' : 'text-red-400',
    },
    {
      label: 'Active',
      value: stats.runs.running + stats.runs.pending,
      icon: stats.runs.running > 0 ? Loader2 : Clock,
      color: stats.runs.running > 0 ? 'text-blue-400' : 'text-zinc-500',
      animate: stats.runs.running > 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-3"
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`h-3.5 w-3.5 ${card.color} ${(card as any).animate ? 'animate-spin' : ''}`} />
              <span className="text-xs text-zinc-500">{card.label}</span>
            </div>
            <p className={`text-lg font-semibold ${card.color}`}>
              {card.value}
            </p>
            {card.subtitle && (
              <p className="text-xs text-zinc-500 mt-0.5">{card.subtitle}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RunStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'PASSED':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'FAILED':
      return <XCircle className="h-4 w-4 text-red-500" />;
    case 'RUNNING':
      return <Play className="h-4 w-4 text-blue-500 animate-pulse" />;
    case 'CANCELLED':
      return <Ban className="h-4 w-4 text-zinc-500" />;
    default:
      return <Clock className="h-4 w-4 text-zinc-500" />;
  }
}
