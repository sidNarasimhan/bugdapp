'use client';

import { useQuery } from '@tanstack/react-query';
import { api, type TestSpec } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { FileCode, Play, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import Link from 'next/link';

export default function TestsPage() {
  const { data: testSpecs = [], isLoading } = useQuery({
    queryKey: ['testSpecs'],
    queryFn: () => api.getTestSpecs(),
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-white">Test Specs</h1>
        <Link
          href="/recordings"
          className="text-white hover:underline"
        >
          Generate from recording
        </Link>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-zinc-400">Loading...</div>
      ) : testSpecs.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-zinc-400 mb-4">No test specs yet</div>
          <Link
            href="/recordings"
            className="text-white hover:underline"
          >
            Generate one from a recording
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {testSpecs.map((spec) => (
            <TestSpecCard key={spec.id} spec={spec} />
          ))}
        </div>
      )}
    </div>
  );
}

function TestSpecCard({ spec }: { spec: TestSpec }) {
  const statusConfig = {
    DRAFT: { icon: Clock, color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
    NEEDS_REVIEW: { icon: FileCode, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    READY: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/10' },
    TESTED: { icon: CheckCircle, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  };

  const status = statusConfig[spec.status] || statusConfig.DRAFT;
  const StatusIcon = status.icon;

  return (
    <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center">
            <FileCode className="h-5 w-5 text-zinc-400 mr-2" />
            <h3 className="text-lg font-medium text-white">
              {spec.recordingName || `Test #${spec.id.slice(0, 8)}`}
            </h3>
          </div>

          <div className="flex items-center mt-2 space-x-4">
            <span
              className={`flex items-center px-2 py-1 rounded text-xs ${status.bg} ${status.color}`}
            >
              <StatusIcon className="h-3 w-3 mr-1" />
              {spec.status}
            </span>
            <span className="text-sm text-zinc-400">v{spec.version}</span>
          </div>

          <p className="text-xs text-zinc-500 mt-2">
            Updated {formatDate(spec.updatedAt)}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Link
            href={`/tests/${spec.id}`}
            className="px-3 py-1.5 bg-zinc-800 text-white text-sm rounded hover:bg-zinc-700 transition-colors"
          >
            View Code
          </Link>
          <Link
            href={`/runs?testSpecId=${spec.id}`}
            className="flex items-center px-3 py-1.5 bg-white text-black text-sm rounded hover:bg-zinc-200 transition-colors"
          >
            <Play className="h-4 w-4 mr-1" />
            Run
          </Link>
        </div>
      </div>

      {/* Code Preview */}
      <div className="mt-4 p-3 bg-zinc-950 rounded text-xs font-mono text-zinc-400 overflow-hidden">
        <pre className="truncate">
          {spec.code.split('\n').slice(0, 3).join('\n')}
        </pre>
      </div>
    </div>
  );
}
