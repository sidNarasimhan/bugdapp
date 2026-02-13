'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type PendingClarification } from '@/lib/api';
import { Loader2, MessageSquareWarning, SkipForward } from 'lucide-react';

interface ClarificationPanelProps {
  clarifications: PendingClarification[];
  projectId: string;
}

const typeBadgeColors: Record<string, string> = {
  SELECTOR: 'bg-purple-500/10 text-purple-400',
  WAIT: 'bg-blue-500/10 text-blue-400',
  NETWORK: 'bg-orange-500/10 text-orange-400',
  ACTION: 'bg-cyan-500/10 text-cyan-400',
  GENERAL: 'bg-zinc-700 text-zinc-300',
};

export function ClarificationPanel({ clarifications, projectId }: ClarificationPanelProps) {
  if (clarifications.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-amber-400">
        <MessageSquareWarning className="h-4 w-4" />
        <span>
          {clarifications.length} question{clarifications.length !== 1 ? 's' : ''} need{clarifications.length === 1 ? 's' : ''} your input:
        </span>
      </div>
      {clarifications.map((c, i) => (
        <ClarificationItem
          key={c.id}
          clarification={c}
          index={i + 1}
          projectId={projectId}
        />
      ))}
    </div>
  );
}

function ClarificationItem({
  clarification,
  index,
  projectId,
}: {
  clarification: PendingClarification;
  index: number;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [customAnswer, setCustomAnswer] = useState('');

  const answerMutation = useMutation({
    mutationFn: (answer: string) => api.answerClarification(clarification.id, answer),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  const skipMutation = useMutation({
    mutationFn: () => api.skipClarification(clarification.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });

  const handleAnswer = () => {
    const answer = customAnswer || selectedOption;
    if (answer) {
      answerMutation.mutate(answer);
    }
  };

  const isPending = answerMutation.isPending || skipMutation.isPending;
  const badgeColor = typeBadgeColors[clarification.type] || typeBadgeColors.GENERAL;

  return (
    <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3">
      <div className="flex items-start gap-2 mb-2">
        <span className="text-xs text-zinc-500 font-mono mt-0.5">Q{index}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${badgeColor}`}>
          {clarification.type}
        </span>
        <p className="text-sm text-zinc-200 flex-1">{clarification.question}</p>
      </div>

      {clarification.context && (
        <p className="text-xs text-zinc-500 ml-6 mb-2">{clarification.context}</p>
      )}

      {clarification.options.length > 0 && (
        <div className="ml-6 space-y-1.5 mb-2">
          {clarification.options.map((option) => (
            <label
              key={option}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <input
                type="radio"
                name={`clarification-${clarification.id}`}
                value={option}
                checked={selectedOption === option}
                onChange={() => {
                  setSelectedOption(option);
                  setCustomAnswer('');
                }}
                className="text-blue-500 focus:ring-blue-500 bg-zinc-700 border-zinc-600"
              />
              <code className="text-xs text-zinc-300 group-hover:text-white transition-colors">
                {option}
              </code>
            </label>
          ))}
        </div>
      )}

      <div className="ml-6 mb-2">
        <input
          type="text"
          placeholder="Or type your own answer..."
          value={customAnswer}
          onChange={(e) => {
            setCustomAnswer(e.target.value);
            setSelectedOption('');
          }}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
        />
      </div>

      <div className="ml-6 flex items-center gap-2">
        <button
          onClick={handleAnswer}
          disabled={isPending || (!selectedOption && !customAnswer)}
          className="flex items-center px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {answerMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : null}
          Answer
        </button>
        <button
          onClick={() => skipMutation.mutate()}
          disabled={isPending}
          className="flex items-center px-3 py-1 text-xs text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
        >
          {skipMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <SkipForward className="h-3 w-3 mr-1" />
          )}
          Skip
        </button>
      </div>

      {answerMutation.isError && (
        <p className="ml-6 mt-1 text-xs text-red-400">
          {(answerMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
