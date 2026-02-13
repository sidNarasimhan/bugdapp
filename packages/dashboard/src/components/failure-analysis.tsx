'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type FailureAnalysis as FailureAnalysisType } from '@/lib/api';
import { Loader2, Bot, Wrench } from 'lucide-react';

interface FailureAnalysisProps {
  specId: string;
  specCode: string;
  projectId: string;
  error?: string;
}

const categoryBadgeColors: Record<string, string> = {
  selector: 'bg-purple-500/10 text-purple-400',
  timeout: 'bg-orange-500/10 text-orange-400',
  network: 'bg-red-500/10 text-red-400',
  assertion: 'bg-blue-500/10 text-blue-400',
  unknown: 'bg-zinc-700 text-zinc-300',
};

const categoryLabels: Record<string, string> = {
  selector: 'Selector change',
  timeout: 'Timeout',
  network: 'Network issue',
  assertion: 'Assertion failed',
  unknown: 'Unknown',
};

export function FailureAnalysis({ specId, specCode, projectId, error }: FailureAnalysisProps) {
  const queryClient = useQueryClient();

  const { data: analysis, isLoading, isError, refetch } = useQuery({
    queryKey: ['failure-analysis', specId],
    queryFn: () => api.analyzeFailure(specId),
    staleTime: 5 * 60 * 1000, // 5 min cache
    retry: false,
  });

  const applyFixMutation = useMutation({
    mutationFn: async () => {
      if (!analysis?.suggestedFix) return;
      // Apply the fix by updating the spec code
      // The suggestedFix is a code snippet — if it's a full replacement, use it; otherwise append context
      await api.updateTestSpec(specId, analysis.suggestedFix);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400 py-2">
        <Bot className="h-4 w-4" />
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>AI is analyzing the failure...</span>
      </div>
    );
  }

  if (isError || !analysis) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500 py-2">
        <Bot className="h-4 w-4" />
        <span>AI analysis unavailable.</span>
        <button
          onClick={() => refetch()}
          className="text-xs text-zinc-400 hover:text-white underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const badgeColor = categoryBadgeColors[analysis.category] || categoryBadgeColors.unknown;
  const label = categoryLabels[analysis.category] || 'Unknown';

  return (
    <div className="bg-zinc-800/30 border border-zinc-700 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-blue-400" />
        <span className="text-sm font-medium text-zinc-200">AI Analysis</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${badgeColor}`}>
          {label}
        </span>
      </div>

      <p className="text-sm text-zinc-300 leading-relaxed">
        {analysis.diagnosis}
      </p>

      {analysis.suggestedFix && (
        <div className="space-y-2">
          <div className="bg-zinc-900 rounded p-2">
            <p className="text-xs text-zinc-500 mb-1">Suggested fix:</p>
            <code className="text-xs text-green-400 whitespace-pre-wrap break-all">
              {analysis.suggestedFix.length > 300
                ? analysis.suggestedFix.slice(0, 300) + '...'
                : analysis.suggestedFix}
            </code>
          </div>

          <button
            onClick={() => applyFixMutation.mutate()}
            disabled={applyFixMutation.isPending}
            className="flex items-center px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {applyFixMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Wrench className="h-3 w-3 mr-1" />
            )}
            Apply Fix & Re-run
          </button>

          {applyFixMutation.isError && (
            <p className="text-xs text-red-400">
              {(applyFixMutation.error as Error).message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
