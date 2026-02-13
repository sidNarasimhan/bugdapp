'use client';

import { Suspense, useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Upload, ArrowLeft, AlertCircle } from 'lucide-react';
import Link from 'next/link';

export default function NewRecordingPage() {
  return (
    <Suspense fallback={<div className="p-8 text-zinc-400">Loading...</div>}>
      <NewRecordingContent />
    </Suspense>
  );
}

function NewRecordingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const projectId = searchParams.get('projectId');

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
  });

  const [name, setName] = useState('');
  const [dappUrl, setDappUrl] = useState('');
  const [description, setDescription] = useState('');
  const [jsonData, setJsonData] = useState<object | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const createMutation = useMutation({
    mutationFn: () => {
      // Build the recording object with required fields
      const recordingData = {
        ...jsonData,
        name: name || (jsonData as { name?: string })?.name || 'Unnamed Recording',
        startUrl: dappUrl || (jsonData as { startUrl?: string })?.startUrl || '',
      };
      return api.createRecording({
        name,
        jsonData: recordingData,
        ...(projectId ? { projectId } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] });
      if (projectId) {
        queryClient.invalidateQueries({ queryKey: ['project', projectId] });
        router.push(`/projects/${projectId}`);
      } else {
        router.push('/recordings');
      }
    },
  });

  const handleFile = (file: File) => {
    setJsonError(null);

    if (!file.name.endsWith('.json')) {
      setJsonError('Please upload a JSON file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        setJsonData(data);

        // Try to extract name and URL from recording
        if (!name && data.name) {
          setName(data.name);
        }
        if (!dappUrl && data.url) {
          setDappUrl(data.url);
        }
        if (!dappUrl && data.dappUrl) {
          setDappUrl(data.dappUrl);
        }
      } catch {
        setJsonError('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const isValid = name && dappUrl && jsonData;

  return (
    <div className="p-8">
      <Link
        href="/recordings"
        className="inline-flex items-center text-zinc-400 hover:text-white mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Recordings
      </Link>

      <h1 className="text-2xl font-bold text-white mb-8">Upload Recording</h1>

      {project && (
        <div className="mb-6 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-blue-400">
          This recording will be added to project: <strong>{project.name}</strong>
        </div>
      )}

      <div className="max-w-2xl">
        {/* File Upload */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive
              ? 'border-zinc-500 bg-zinc-800/50'
              : jsonData
              ? 'border-green-500 bg-green-500/10'
              : 'border-zinc-700 hover:border-zinc-600'
          }`}
        >
          <input
            type="file"
            accept=".json"
            onChange={handleFileInput}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />

          <Upload
            className={`h-12 w-12 mx-auto mb-4 ${
              jsonData ? 'text-green-500' : 'text-zinc-400'
            }`}
          />

          {jsonData ? (
            <div>
              <p className="text-green-500 font-medium">Recording loaded</p>
              <p className="text-sm text-zinc-400 mt-1">
                {Object.keys(jsonData).length} top-level keys found
              </p>
            </div>
          ) : (
            <div>
              <p className="text-white font-medium">
                Drop your recording JSON here
              </p>
              <p className="text-sm text-zinc-400 mt-1">
                or click to browse files
              </p>
            </div>
          )}
        </div>

        {jsonError && (
          <div className="flex items-center mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
            <span className="text-red-400">{jsonError}</span>
          </div>
        )}

        {/* Form Fields */}
        <div className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-zinc-300 mb-1"
            >
              Name *
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Uniswap Token Swap"
              className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500"
            />
          </div>

          <div>
            <label
              htmlFor="dappUrl"
              className="block text-sm font-medium text-zinc-300 mb-1"
            >
              dApp URL *
            </label>
            <input
              type="url"
              id="dappUrl"
              value={dappUrl}
              onChange={(e) => setDappUrl(e.target.value)}
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
              placeholder="Optional description of this test scenario"
              className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500 resize-none"
            />
          </div>
        </div>

        {/* Submit Button */}
        <div className="mt-8">
          <button
            onClick={() => createMutation.mutate()}
            disabled={!isValid || createMutation.isPending}
            className="w-full px-4 py-3 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? 'Uploading...' : 'Upload Recording'}
          </button>

          {createMutation.isError && (
            <p className="mt-2 text-sm text-red-400">
              Failed to upload: {(createMutation.error as Error).message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
