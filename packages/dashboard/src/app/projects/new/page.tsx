'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api, type Project } from '@/lib/api';
import { ArrowLeft, Copy, AlertTriangle, CheckCircle } from 'lucide-react';
import Link from 'next/link';

export default function NewProjectPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [homeUrl, setHomeUrl] = useState('');
  const [description, setDescription] = useState('');
  const [createdProject, setCreatedProject] = useState<Project | null>(null);
  const [copiedSeed, setCopiedSeed] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);

  const createMutation = useMutation({
    mutationFn: () =>
      api.createProject({
        name,
        homeUrl,
        description: description || undefined,
      }),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setCreatedProject(project);
    },
  });

  const copySeed = () => {
    if (createdProject?.seedPhrase) {
      navigator.clipboard.writeText(createdProject.seedPhrase);
      setCopiedSeed(true);
      setTimeout(() => setCopiedSeed(false), 2000);
    }
  };

  const copyAddress = () => {
    if (createdProject?.walletAddress) {
      navigator.clipboard.writeText(createdProject.walletAddress);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  const isValid = name && homeUrl;

  // After creation: show wallet info
  if (createdProject) {
    return (
      <div className="p-8">
        <div className="max-w-2xl">
          <div className="flex items-center gap-3 mb-6">
            <CheckCircle className="h-8 w-8 text-green-500" />
            <h1 className="text-2xl font-bold text-white">
              Project Created
            </h1>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-medium text-white mb-4">
              {createdProject.name}
            </h2>

            {/* Wallet Address */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-300 mb-1">
                Wallet Address
              </label>
              <div className="flex items-center gap-2 bg-zinc-800 rounded-lg px-4 py-3">
                <code className="text-sm text-white font-mono flex-1">
                  {createdProject.walletAddress}
                </code>
                <button
                  onClick={copyAddress}
                  className="text-zinc-400 hover:text-white transition-colors"
                >
                  <Copy className="h-4 w-4" />
                </button>
                {copiedAddress && (
                  <span className="text-xs text-green-400">Copied!</span>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                Fund this address with test tokens on your target chain.
              </p>
            </div>

            {/* Seed Phrase - shown only once */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-300 mb-1">
                Seed Phrase
              </label>
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                <div className="flex items-start gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-yellow-400">
                    This is shown only once. Save it securely if you need to recover this wallet.
                  </p>
                </div>
                <div className="flex items-center gap-2 bg-zinc-900 rounded px-4 py-3">
                  <code className="text-sm text-white font-mono flex-1 break-all">
                    {createdProject.seedPhrase}
                  </code>
                  <button
                    onClick={copySeed}
                    className="text-zinc-400 hover:text-white transition-colors shrink-0"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  {copiedSeed && (
                    <span className="text-xs text-green-400">Copied!</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            <Link
              href={`/projects/${createdProject.id}`}
              className="px-4 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors"
            >
              Go to Project
            </Link>
            <Link
              href="/projects"
              className="px-4 py-2 text-zinc-300 hover:text-white transition-colors"
            >
              Back to Projects
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <Link
        href="/projects"
        className="inline-flex items-center text-zinc-400 hover:text-white mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Projects
      </Link>

      <h1 className="text-2xl font-bold text-white mb-8">Create Project</h1>

      <div className="max-w-2xl">
        <div className="space-y-4">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-zinc-300 mb-1"
            >
              Project Name *
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Uniswap V3"
              className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500"
            />
          </div>

          <div>
            <label
              htmlFor="homeUrl"
              className="block text-sm font-medium text-zinc-300 mb-1"
            >
              dApp URL *
            </label>
            <input
              type="url"
              id="homeUrl"
              value={homeUrl}
              onChange={(e) => setHomeUrl(e.target.value)}
              placeholder="e.g., https://app.uniswap.org"
              className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500"
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-zinc-300 mb-1"
            >
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional description of this project"
              className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500 resize-none"
            />
          </div>
        </div>

        <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <p className="text-sm text-blue-400">
            A unique wallet (seed phrase + address) will be generated for this
            project. You can fund it with test tokens to run dApp tests that
            require balances.
          </p>
        </div>

        <div className="mt-8">
          <button
            onClick={() => createMutation.mutate()}
            disabled={!isValid || createMutation.isPending}
            className="w-full px-4 py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Project'}
          </button>

          {createMutation.isError && (
            <p className="mt-2 text-sm text-red-400">
              Failed to create: {(createMutation.error as Error).message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
