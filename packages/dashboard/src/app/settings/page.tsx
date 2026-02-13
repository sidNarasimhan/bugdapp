'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Key, Plus, Trash2, Copy, CheckCircle, XCircle, Loader2, Server, AlertTriangle } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  isExpired: boolean;
}

// Delete All Button Component
function DeleteAllButton({
  label,
  description,
  onDelete,
  queryKey,
}: {
  label: string;
  description: string;
  onDelete: () => Promise<{ deleted: number; message: string }>;
  queryKey: string;
}) {
  const queryClient = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: onDelete,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      queryClient.invalidateQueries({ queryKey: ['recordings'] });
      queryClient.invalidateQueries({ queryKey: ['testSpecs'] });
      queryClient.invalidateQueries({ queryKey: ['testRuns'] });
      setShowConfirm(false);
      alert(data.message);
    },
    onError: (error) => {
      alert(`Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  if (showConfirm) {
    return (
      <div className="flex items-center justify-between p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
        <div className="flex items-center">
          <AlertTriangle className="h-5 w-5 text-red-400 mr-2" />
          <span className="text-red-400 text-sm">Are you sure? This cannot be undone.</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowConfirm(false)}
            disabled={deleteMutation.isPending}
            className="px-3 py-1 text-sm bg-zinc-700 text-white rounded hover:bg-zinc-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors flex items-center"
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Confirm Delete'
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg">
      <div>
        <p className="text-white font-medium">{label}</p>
        <p className="text-xs text-zinc-400">{description}</p>
      </div>
      <button
        onClick={() => setShowConfirm(true)}
        className="px-3 py-1 text-sm bg-red-600/20 text-red-400 border border-red-500/30 rounded hover:bg-red-600/30 transition-colors"
      >
        Delete All
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [apiUrl, setApiUrl] = useState(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001');
  const [defaultHeadless, setDefaultHeadless] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Fetch API keys
  const { data: apiKeysData, isLoading: keysLoading } = useQuery({
    queryKey: ['apiKeys'],
    queryFn: async () => {
      const response = await fetch(`${apiUrl}/api/api-keys`);
      if (!response.ok) throw new Error('Failed to fetch API keys');
      return response.json() as Promise<{ keys: ApiKey[] }>;
    },
  });

  // Fetch container status
  const { data: containerStatus, isLoading: containerLoading } = useQuery({
    queryKey: ['containerStatus'],
    queryFn: () => api.getContainerStatus(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Create API key mutation
  const createKeyMutation = useMutation({
    mutationFn: async (params: { name: string; expiresInDays?: number }) => {
      const response = await fetch(`${apiUrl}/api/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) throw new Error('Failed to create API key');
      return response.json();
    },
    onSuccess: (data) => {
      setCreatedKey(data.key);
      setNewKeyName('');
      setNewKeyExpiry('');
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
    },
  });

  // Delete API key mutation
  const deleteKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`${apiUrl}/api/api-keys/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete API key');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
    },
  });

  const handleCreateKey = () => {
    if (!newKeyName.trim()) return;
    const expiresInDays = newKeyExpiry ? parseInt(newKeyExpiry, 10) : undefined;
    createKeyMutation.mutate({ name: newKeyName.trim(), expiresInDays });
  };

  const handleCopyKey = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-white mb-8">Settings</h1>

      <div className="max-w-3xl space-y-6">
        {/* API Keys for Extension */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
          <div className="flex items-center mb-4">
            <Key className="h-5 w-5 text-zinc-300 mr-2" />
            <h2 className="text-lg font-medium text-white">
              API Keys
            </h2>
          </div>
          <p className="text-sm text-zinc-400 mb-4">
            Create API keys to authenticate the browser extension when uploading recordings.
          </p>

          {/* Create new key form */}
          <div className="bg-zinc-800/50 rounded-lg p-4 mb-4">
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Key name (e.g., My Extension)"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-400 focus:outline-none focus:border-zinc-500"
              />
              <select
                value={newKeyExpiry}
                onChange={(e) => setNewKeyExpiry(e.target.value)}
                className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-500"
              >
                <option value="">Never expires</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </select>
              <button
                onClick={handleCreateKey}
                disabled={!newKeyName.trim() || createKeyMutation.isPending}
                className="px-4 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {createKeyMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-1" />
                    Create
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Show newly created key */}
          {createdKey && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4">
              <p className="text-sm text-green-400 mb-2 flex items-center">
                <CheckCircle className="h-4 w-4 mr-2" />
                API key created! Copy it now - you won't be able to see it again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-zinc-950 px-3 py-2 rounded text-sm text-zinc-300 font-mono overflow-x-auto">
                  {createdKey}
                </code>
                <button
                  onClick={handleCopyKey}
                  className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  {copiedKey ? (
                    <CheckCircle className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4 text-zinc-400" />
                  )}
                </button>
              </div>
              <button
                onClick={() => setCreatedKey(null)}
                className="mt-2 text-xs text-zinc-400 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Existing keys list */}
          {keysLoading ? (
            <div className="text-center py-4 text-zinc-400">
              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
            </div>
          ) : apiKeysData?.keys && apiKeysData.keys.length > 0 ? (
            <div className="space-y-2">
              {apiKeysData.keys.map((key) => (
                <div
                  key={key.id}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    key.isExpired ? 'bg-red-500/10 border border-red-500/30' : 'bg-zinc-800/50'
                  }`}
                >
                  <div>
                    <div className="flex items-center">
                      <span className="text-white font-medium">{key.name}</span>
                      {key.isExpired && (
                        <span className="ml-2 px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded">
                          Expired
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-400 mt-1">
                      <code className="bg-zinc-900 px-1 rounded">{key.keyPrefix}...</code>
                      {key.lastUsedAt && ` • Last used ${formatDate(key.lastUsedAt)}`}
                      {key.expiresAt && ` • Expires ${formatDate(key.expiresAt)}`}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteKeyMutation.mutate(key.id)}
                    disabled={deleteKeyMutation.isPending}
                    className="p-2 text-zinc-400 hover:text-red-400 transition-colors"
                    title="Revoke key"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-zinc-400 py-4">
              No API keys created yet
            </p>
          )}
        </div>

        {/* Container Pool Status */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
          <div className="flex items-center mb-4">
            <Server className="h-5 w-5 text-zinc-300 mr-2" />
            <h2 className="text-lg font-medium text-white">
              Executor Status
            </h2>
          </div>

          {containerLoading ? (
            <div className="text-center py-4 text-zinc-400">
              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center">
                <div className={`w-3 h-3 rounded-full mr-3 ${
                  containerStatus?.dockerAvailable ? 'bg-green-500' : 'bg-red-500'
                }`} />
                <span className="text-zinc-300">
                  Docker: {containerStatus?.dockerAvailable ? 'Connected' : 'Not available'}
                </span>
              </div>

              {containerStatus?.containers && containerStatus.containers.length > 0 ? (
                <div className="mt-4">
                  <p className="text-sm text-zinc-400 mb-2">Active containers:</p>
                  <div className="space-y-2">
                    {containerStatus.containers.map((c) => (
                      <div key={c.id} className="flex items-center justify-between bg-zinc-800/50 p-2 rounded text-sm">
                        <span className="text-zinc-300 font-mono">{c.id}</span>
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          c.status === 'running' ? 'bg-green-500/20 text-green-400' : 'bg-zinc-700 text-zinc-400'
                        }`}>
                          {c.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : containerStatus?.dockerAvailable ? (
                <p className="text-sm text-zinc-400">No active executor containers</p>
              ) : (
                <p className="text-sm text-amber-400">
                  Live browser viewing requires Docker. Start Docker to enable VNC streaming.
                </p>
              )}
            </div>
          )}
        </div>

        {/* API Configuration */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
          <h2 className="text-lg font-medium text-white mb-4">
            API Configuration
          </h2>

          <div>
            <label
              htmlFor="apiUrl"
              className="block text-sm font-medium text-zinc-300 mb-1"
            >
              Backend API URL
            </label>
            <input
              type="url"
              id="apiUrl"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500"
            />
            <p className="mt-1 text-xs text-zinc-400">
              The URL of the backend API server
            </p>
          </div>
        </div>

        {/* Test Execution Defaults */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
          <h2 className="text-lg font-medium text-white mb-4">
            Test Execution Defaults
          </h2>

          <div className="space-y-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={defaultHeadless}
                onChange={(e) => setDefaultHeadless(e.target.checked)}
                className="rounded bg-zinc-800 border-zinc-700 text-white focus:ring-zinc-500"
              />
              <span className="ml-2 text-zinc-300">
                Run tests in headless mode by default
              </span>
            </label>

            <label className="flex items-center">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded bg-zinc-800 border-zinc-700 text-white focus:ring-zinc-500"
              />
              <span className="ml-2 text-zinc-300">
                Auto-refresh running tests
              </span>
            </label>
          </div>
        </div>

        {/* Danger Zone - Delete All */}
        <div className="bg-zinc-900 rounded-lg border border-red-500/30 p-6">
          <h2 className="text-lg font-medium text-red-400 mb-4">
            Danger Zone
          </h2>
          <p className="text-sm text-zinc-400 mb-4">
            These actions are irreversible. All associated data will be permanently deleted.
          </p>

          <div className="space-y-3">
            <DeleteAllButton
              label="Delete All Test Runs"
              description="Remove all test runs and their artifacts"
              onDelete={() => api.deleteAllTestRuns()}
              queryKey="testRuns"
            />
            <DeleteAllButton
              label="Delete All Test Specs"
              description="Remove all test specs and their runs"
              onDelete={() => api.deleteAllTestSpecs()}
              queryKey="testSpecs"
            />
            <DeleteAllButton
              label="Delete All Recordings"
              description="Remove all recordings, specs, and runs"
              onDelete={() => api.deleteAllRecordings()}
              queryKey="recordings"
            />
          </div>
        </div>

        {/* About */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
          <h2 className="text-lg font-medium text-white mb-4">About</h2>

          <div className="space-y-2 text-sm text-zinc-400">
            <p>
              <span className="text-zinc-300">Version:</span> 2.0.0
            </p>
            <p>
              <span className="text-zinc-300">Platform:</span> Web3 Test
              Dashboard
            </p>
            <p>
              <span className="text-zinc-300">Features:</span> Recording upload, test generation, headless &amp; headed execution, live VNC streaming
            </p>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button className="px-6 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors">
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
