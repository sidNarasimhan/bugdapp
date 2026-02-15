'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useState } from 'react';
import {
  ArrowLeft,
  Save,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ExecutionOptions, type ExecutionMode } from '@/components/execution-options';

export default function TestSpecPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = params.id as string;

  const [isEditing, setIsEditing] = useState(false);
  const [editedCode, setEditedCode] = useState('');

  const { data: spec, isLoading } = useQuery({
    queryKey: ['testSpec', id],
    queryFn: () => api.getTestSpec(id),
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: (code: string) => api.updateTestSpec(id, code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testSpec', id] });
      setIsEditing(false);
    },
  });

  const validateMutation = useMutation({
    mutationFn: () => api.validateTestSpec(id),
  });

  const runMutation = useMutation({
    mutationFn: (mode: ExecutionMode) => {
      const options = {
        headless: false,
        streamingMode: mode === 'live' ? 'VNC' as const : 'NONE' as const,
      };
      return api.createTestRun(id, options);
    },
    onSuccess: (run) => {
      router.push(`/runs/${run.id}`);
    },
  });

  const handleRunTest = (mode: ExecutionMode) => {
    runMutation.mutate(mode);
  };

  const handleEdit = () => {
    if (spec) {
      setEditedCode(spec.code);
      setIsEditing(true);
    }
  };

  const handleSave = () => {
    updateMutation.mutate(editedCode);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedCode('');
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-zinc-400">Loading...</div>
    );
  }

  if (!spec) {
    return (
      <div className="p-8 text-center text-zinc-400">Test spec not found</div>
    );
  }

  return (
    <div className="p-8">
      <Link
        href="/tests"
        className="inline-flex items-center text-zinc-400 hover:text-white mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Tests
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {spec.recordingName || `Test #${spec.id.slice(0, 8)}`}
          </h1>
          <p className="text-zinc-400 mt-1">
            Version {spec.version} • Updated {formatDate(spec.updatedAt)}
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {isEditing ? (
            <>
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-zinc-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                <Save className="h-4 w-4 mr-2" />
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => validateMutation.mutate()}
                disabled={validateMutation.isPending}
                className="px-4 py-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-50"
              >
                {validateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Validate'
                )}
              </button>
              <button
                onClick={handleEdit}
                className="px-4 py-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors"
              >
                Edit Code
              </button>
            </>
          )}
        </div>
      </div>

      {/* Validation Result */}
      {validateMutation.data && (
        <div
          className={`mb-6 p-4 rounded-lg border ${
            validateMutation.data.valid
              ? 'bg-green-500/10 border-green-500/20'
              : 'bg-red-500/10 border-red-500/20'
          }`}
        >
          <div className="flex items-center">
            {validateMutation.data.valid ? (
              <>
                <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                <span className="text-green-400">Validation passed</span>
              </>
            ) : (
              <>
                <XCircle className="h-5 w-5 text-red-500 mr-2" />
                <span className="text-red-400">Validation failed</span>
              </>
            )}
          </div>
          {validateMutation.data.errors.length > 0 && (
            <ul className="mt-2 text-sm text-red-400 space-y-1">
              {validateMutation.data.errors.map((err, i) => (
                <li key={i}>• {err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Execution Options */}
      {!isEditing && (
        <div className="mb-6">
          <ExecutionOptions
            onRun={handleRunTest}
            isRunning={runMutation.isPending}
            disabled={spec.status === 'DRAFT'}
          />
          {spec.status === 'DRAFT' && (
            <p className="mt-2 text-sm text-amber-400">
              Test is in DRAFT status. Please add code before running.
            </p>
          )}
          {spec.status === 'NEEDS_REVIEW' && (
            <p className="mt-2 text-sm text-blue-400">
              Auto-generated spec. Review the code before running in production.
            </p>
          )}
        </div>
      )}

      {/* Code Editor/Viewer */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
        <div className="px-4 py-2 bg-zinc-800 border-b border-zinc-700 flex items-center justify-between">
          <span className="text-sm text-zinc-300">test.spec.ts</span>
          <span className="text-xs text-zinc-400">
            {spec.code.split('\n').length} lines
          </span>
        </div>

        {isEditing ? (
          <textarea
            value={editedCode}
            onChange={(e) => setEditedCode(e.target.value)}
            className="w-full h-[600px] p-4 bg-zinc-950 text-zinc-300 font-mono text-sm focus:outline-none resize-none"
            spellCheck={false}
          />
        ) : (
          <div className="max-h-[600px] overflow-auto">
            <SyntaxHighlighter
              language="typescript"
              style={vscDarkPlus}
              customStyle={{
                margin: 0,
                padding: '1rem',
                background: 'transparent',
              }}
              showLineNumbers
            >
              {spec.code}
            </SyntaxHighlighter>
          </div>
        )}
      </div>
    </div>
  );
}
