'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Recording } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Plus, ExternalLink, Trash2, FileCode } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

export default function RecordingsPage() {
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: recordings = [], isLoading } = useQuery({
    queryKey: ['recordings'],
    queryFn: () => api.getRecordings(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteRecording(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] });
      setDeleteId(null);
    },
  });

  const generateMutation = useMutation({
    mutationFn: (recordingId: string) => api.generateTestSpec(recordingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testSpecs'] });
    },
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-white">Recordings</h1>
        <Link
          href="/recordings/new"
          className="flex items-center px-4 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors"
        >
          <Plus className="h-5 w-5 mr-2" />
          Upload Recording
        </Link>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-zinc-400">Loading...</div>
      ) : recordings.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-zinc-400 mb-4">No recordings yet</div>
          <Link
            href="/recordings/new"
            className="text-white hover:underline"
          >
            Upload your first recording
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {recordings.map((recording) => (
            <RecordingCard
              key={recording.id}
              recording={recording}
              onDelete={() => setDeleteId(recording.id)}
              onGenerate={() => generateMutation.mutate(recording.id)}
              isGenerating={generateMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-zinc-900 p-6 rounded-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-medium text-white mb-4">
              Delete Recording
            </h3>
            <p className="text-zinc-400 mb-6">
              Are you sure you want to delete this recording? This action cannot
              be undone.
            </p>
            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 text-zinc-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteId)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordingCard({
  recording,
  onDelete,
  onGenerate,
  isGenerating,
}: {
  recording: Recording;
  onDelete: () => void;
  onGenerate: () => void;
  isGenerating: boolean;
}) {
  return (
    <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <Link
            href={`/recordings/${recording.id}`}
            className="text-lg font-medium text-white hover:text-white transition-colors"
          >
            {recording.name}
          </Link>
          <p className="text-sm text-zinc-400 mt-1">
            {recording.stepCount} steps
            {recording.walletName && ` | ${recording.walletName}`}
            {recording.chainId && ` | Chain ${recording.chainId}`}
          </p>
          <div className="flex items-center mt-2 text-sm text-zinc-400">
            <ExternalLink className="h-4 w-4 mr-1" />
            <a
              href={recording.dappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white truncate max-w-xs"
            >
              {recording.dappUrl}
            </a>
          </div>
          <p className="text-xs text-zinc-500 mt-2">
            Created {formatDate(recording.createdAt)}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Link
            href={`/recordings/${recording.id}`}
            className="flex items-center px-3 py-1.5 bg-zinc-800 text-white text-sm rounded hover:bg-zinc-700 transition-colors"
          >
            Edit Steps
          </Link>
          <button
            onClick={onGenerate}
            disabled={isGenerating}
            className="flex items-center px-3 py-1.5 bg-white text-black text-sm rounded hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            <FileCode className="h-4 w-4 mr-1" />
            {isGenerating ? 'Generating...' : 'Generate Test'}
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 text-zinc-400 hover:text-red-400 transition-colors"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
