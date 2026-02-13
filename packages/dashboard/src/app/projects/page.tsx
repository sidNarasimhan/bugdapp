'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Project } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Plus, ExternalLink, Trash2, Wallet, Copy } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setDeleteId(null);
    },
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-white">Projects</h1>
        <Link
          href="/projects/new"
          className="flex items-center px-4 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors"
        >
          <Plus className="h-5 w-5 mr-2" />
          New Project
        </Link>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-zinc-400">Loading...</div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-zinc-400 mb-4">No projects yet</div>
          <Link
            href="/projects/new"
            className="text-white hover:underline"
          >
            Create your first project
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDelete={() => setDeleteId(project.id)}
            />
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-zinc-900 p-6 rounded-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-medium text-white mb-4">
              Delete Project
            </h3>
            <p className="text-zinc-400 mb-6">
              Are you sure? Recordings will be kept but unlinked from the
              project. Suite runs will be deleted.
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

function ProjectCard({
  project,
  onDelete,
}: {
  project: Project;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    navigator.clipboard.writeText(project.walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <Link
            href={`/projects/${project.id}`}
            className="text-lg font-medium text-white hover:text-white transition-colors"
          >
            {project.name}
          </Link>
          {project.description && (
            <p className="text-sm text-zinc-400 mt-1">{project.description}</p>
          )}
          <div className="flex items-center mt-2 text-sm text-zinc-400">
            <ExternalLink className="h-4 w-4 mr-1" />
            <a
              href={project.homeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white truncate max-w-xs"
            >
              {project.homeUrl}
            </a>
          </div>

          {/* Wallet address */}
          <div className="flex items-center mt-2 gap-2">
            <Wallet className="h-4 w-4 text-zinc-500" />
            <code className="text-xs text-zinc-400 font-mono">
              {project.walletAddress.slice(0, 6)}...{project.walletAddress.slice(-4)}
            </code>
            <button
              onClick={copyAddress}
              className="text-zinc-500 hover:text-white transition-colors"
              title="Copy address"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            {copied && (
              <span className="text-xs text-green-400">Copied!</span>
            )}
          </div>

          <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
            <span>{project.recordingCount || 0} recordings</span>
            <span>{project.suiteRunCount || 0} suite runs</span>
            <span>Created {formatDate(project.createdAt)}</span>
          </div>
        </div>

        <button
          onClick={onDelete}
          className="p-1.5 text-zinc-400 hover:text-red-400 transition-colors"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
