'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api, type RecordingStep } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useState, useCallback } from 'react';
import {
  ArrowLeft,
  Save,
  RefreshCw,
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronUp,
  MousePointer,
  Type,
  Navigation,
  Wallet,
  ArrowUpDown,
  AlertCircle,
  CheckCircle,
  FileCode,
} from 'lucide-react';
import Link from 'next/link';

// Step type icons and labels
const STEP_TYPE_CONFIG = {
  click: { icon: MousePointer, label: 'Click', color: 'text-blue-400' },
  input: { icon: Type, label: 'Input', color: 'text-green-400' },
  navigation: { icon: Navigation, label: 'Navigate', color: 'text-purple-400' },
  web3: { icon: Wallet, label: 'Web3', color: 'text-orange-400' },
  scroll: { icon: ArrowUpDown, label: 'Scroll', color: 'text-zinc-400' },
};

interface StepEditorProps {
  step: RecordingStep;
  index: number;
  onUpdate: (index: number, step: RecordingStep) => void;
  onDelete: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  isFirst: boolean;
  isLast: boolean;
}

function StepEditor({
  step,
  index,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: StepEditorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const config = STEP_TYPE_CONFIG[step.type] || STEP_TYPE_CONFIG.click;
  const Icon = config.icon;

  const handleFieldChange = (field: keyof RecordingStep, value: unknown) => {
    onUpdate(index, { ...step, [field]: value });
  };

  const handleMetadataChange = (field: string, value: unknown) => {
    onUpdate(index, {
      ...step,
      metadata: { ...step.metadata, [field]: value },
    });
  };

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
      {/* Step Header */}
      <div
        className="flex items-center px-4 py-3 cursor-pointer hover:bg-zinc-800"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center flex-1">
          <span className="text-zinc-500 font-mono text-sm mr-3 w-6">
            {index + 1}
          </span>
          <Icon className={`h-4 w-4 mr-2 ${config.color}`} />
          <span className="font-medium text-white">{config.label}</span>
          <span className="ml-3 text-zinc-400 text-sm truncate max-w-md">
            {step.type === 'click' ? (step.selector || String(step.metadata?.text || '') || 'Element') : null}
            {step.type === 'input' ? (step.value?.slice(0, 30) || 'Empty') : null}
            {step.type === 'navigation' ? step.url : null}
            {step.type === 'web3' ? step.web3Method : null}
            {step.type === 'scroll' ? `(${step.scrollX ?? 0}, ${step.scrollY ?? 0})` : null}
          </span>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMoveUp(index);
            }}
            disabled={isFirst}
            className="p-1 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move up"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMoveDown(index);
            }}
            disabled={isLast}
            className="p-1 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move down"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(index);
            }}
            className="p-1 text-zinc-400 hover:text-red-400"
            title="Delete step"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-zinc-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-zinc-400" />
          )}
        </div>
      </div>

      {/* Step Details (Expanded) */}
      {isExpanded && (
        <div className="px-4 py-4 border-t border-zinc-800 space-y-4">
          {/* Type Selector */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Type
            </label>
            <select
              value={step.type}
              onChange={(e) => handleFieldChange('type', e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-500"
            >
              <option value="click">Click</option>
              <option value="input">Input</option>
              <option value="navigation">Navigation</option>
              <option value="web3">Web3</option>
              <option value="scroll">Scroll</option>
            </select>
          </div>

          {/* Selector (for click/input) */}
          {(step.type === 'click' || step.type === 'input') && (
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">
                Selector
              </label>
              <input
                type="text"
                value={step.selector || ''}
                onChange={(e) => handleFieldChange('selector', e.target.value)}
                placeholder="CSS selector or XPath"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500 font-mono text-sm"
              />
            </div>
          )}

          {/* Value (for input) */}
          {step.type === 'input' && (
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">
                Value
              </label>
              <input
                type="text"
                value={step.value || ''}
                onChange={(e) => handleFieldChange('value', e.target.value)}
                placeholder="Input value"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500"
              />
            </div>
          )}

          {/* URL (for navigation) */}
          {step.type === 'navigation' && (
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">
                URL
              </label>
              <input
                type="url"
                value={step.url || ''}
                onChange={(e) => handleFieldChange('url', e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500"
              />
            </div>
          )}

          {/* Web3 Method (for web3) */}
          {step.type === 'web3' && (
            <>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Method
                </label>
                <input
                  type="text"
                  value={step.web3Method || ''}
                  onChange={(e) => handleFieldChange('web3Method', e.target.value)}
                  placeholder="eth_sendTransaction, personal_sign, etc."
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Chain ID
                </label>
                <input
                  type="number"
                  value={step.chainId || ''}
                  onChange={(e) => handleFieldChange('chainId', parseInt(e.target.value) || undefined)}
                  placeholder="1, 137, 42161, etc."
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500"
                />
              </div>
            </>
          )}

          {/* Scroll Position (for scroll) */}
          {step.type === 'scroll' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Scroll X
                </label>
                <input
                  type="number"
                  value={step.scrollX || 0}
                  onChange={(e) => handleFieldChange('scrollX', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Scroll Y
                </label>
                <input
                  type="number"
                  value={step.scrollY || 0}
                  onChange={(e) => handleFieldChange('scrollY', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-500"
                />
              </div>
            </div>
          )}

          {/* Metadata (optional fields) */}
          {(step.type === 'click' || step.type === 'input') && (
            <div className="pt-4 border-t border-zinc-700">
              <h4 className="text-sm font-medium text-zinc-300 mb-3">
                Element Metadata (optional)
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Text Content
                  </label>
                  <input
                    type="text"
                    value={(step.metadata?.text as string) || ''}
                    onChange={(e) => handleMetadataChange('text', e.target.value)}
                    placeholder="Button text"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    data-testid
                  </label>
                  <input
                    type="text"
                    value={(step.metadata?.dataTestId as string) || ''}
                    onChange={(e) => handleMetadataChange('dataTestId', e.target.value)}
                    placeholder="test-id"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    ARIA Label
                  </label>
                  <input
                    type="text"
                    value={(step.metadata?.ariaLabel as string) || ''}
                    onChange={(e) => handleMetadataChange('ariaLabel', e.target.value)}
                    placeholder="Accessible name"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Tag Name
                  </label>
                  <input
                    type="text"
                    value={(step.metadata?.tagName as string) || ''}
                    onChange={(e) => handleMetadataChange('tagName', e.target.value)}
                    placeholder="button, input, etc."
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-400 focus:outline-none focus:border-zinc-500 text-sm font-mono"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RecordingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = params.id as string;

  const [editedSteps, setEditedSteps] = useState<RecordingStep[] | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: recording, isLoading } = useQuery({
    queryKey: ['recording', id],
    queryFn: () => api.getRecording(id),
    enabled: !!id,
  });

  // Get the steps to display (edited or original)
  const steps = editedSteps ?? (recording?.jsonData?.steps || []);

  // Initialize edited steps when recording loads
  const initializeSteps = useCallback(() => {
    if (recording?.jsonData?.steps && !editedSteps) {
      setEditedSteps([...recording.jsonData.steps]);
    }
  }, [recording, editedSteps]);

  // Initialize on first load
  if (recording && !editedSteps) {
    initializeSteps();
  }

  const updateMutation = useMutation({
    mutationFn: (params: { steps: RecordingStep[]; autoRegenerate: boolean }) =>
      api.updateRecording(id, params),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['recording', id] });
      queryClient.invalidateQueries({ queryKey: ['testSpecs'] });
      setHasChanges(false);
      if (result.testSpec) {
        // Show success
      }
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: () => api.regenerateSpec(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testSpecs'] });
    },
  });

  // Step manipulation handlers
  const handleUpdateStep = (index: number, updatedStep: RecordingStep) => {
    if (!editedSteps) return;
    const newSteps = [...editedSteps];
    newSteps[index] = updatedStep;
    setEditedSteps(newSteps);
    setHasChanges(true);
  };

  const handleDeleteStep = (index: number) => {
    if (!editedSteps) return;
    const newSteps = editedSteps.filter((_, i) => i !== index);
    setEditedSteps(newSteps);
    setHasChanges(true);
  };

  const handleMoveUp = (index: number) => {
    if (!editedSteps || index === 0) return;
    const newSteps = [...editedSteps];
    [newSteps[index - 1], newSteps[index]] = [newSteps[index], newSteps[index - 1]];
    setEditedSteps(newSteps);
    setHasChanges(true);
  };

  const handleMoveDown = (index: number) => {
    if (!editedSteps || index === editedSteps.length - 1) return;
    const newSteps = [...editedSteps];
    [newSteps[index], newSteps[index + 1]] = [newSteps[index + 1], newSteps[index]];
    setEditedSteps(newSteps);
    setHasChanges(true);
  };

  const handleAddStep = () => {
    if (!editedSteps) return;
    const newStep: RecordingStep = {
      id: `step-${Date.now()}`,
      type: 'click',
      timestamp: Date.now(),
      selector: '',
    };
    setEditedSteps([...editedSteps, newStep]);
    setHasChanges(true);
  };

  const handleSave = (autoRegenerate: boolean = false) => {
    if (!editedSteps) return;
    updateMutation.mutate({ steps: editedSteps, autoRegenerate });
  };

  const handleDiscard = () => {
    if (recording?.jsonData?.steps) {
      setEditedSteps([...recording.jsonData.steps]);
      setHasChanges(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-zinc-400">Loading...</div>
    );
  }

  if (!recording) {
    return (
      <div className="p-8 text-center text-zinc-400">Recording not found</div>
    );
  }

  return (
    <div className="p-8">
      <Link
        href="/recordings"
        className="inline-flex items-center text-zinc-400 hover:text-white mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Recordings
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{recording.name}</h1>
          <p className="text-zinc-400 mt-1">
            {recording.stepCount} steps
            {recording.walletName && ` | ${recording.walletName}`}
            {recording.chainId && ` | Chain ${recording.chainId}`}
          </p>
          <p className="text-sm text-zinc-500 mt-1">
            Created {formatDate(recording.createdAt)}
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {hasChanges && (
            <button
              onClick={handleDiscard}
              className="px-4 py-2 text-zinc-300 hover:text-white transition-colors"
            >
              Discard Changes
            </button>
          )}
          <button
            onClick={() => handleSave(false)}
            disabled={!hasChanges || updateMutation.isPending}
            className="flex items-center px-4 py-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-50"
          >
            <Save className="h-4 w-4 mr-2" />
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={!hasChanges || updateMutation.isPending}
            className="flex items-center px-4 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            <FileCode className="h-4 w-4 mr-2" />
            Save & Regenerate
          </button>
          <button
            onClick={() => regenerateMutation.mutate()}
            disabled={regenerateMutation.isPending || hasChanges}
            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
            title={hasChanges ? 'Save changes first' : 'Regenerate test spec'}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${regenerateMutation.isPending ? 'animate-spin' : ''}`} />
            Regenerate
          </button>
        </div>
      </div>

      {/* Status Messages */}
      {updateMutation.isSuccess && updateMutation.data?.testSpec && (
        <div className="mb-6 p-4 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center">
          <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
          <span className="text-green-400">
            Saved! Test spec regenerated (Status: {updateMutation.data.testSpec.status})
          </span>
        </div>
      )}

      {updateMutation.data?.generationError && (
        <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center">
          <AlertCircle className="h-5 w-5 text-amber-500 mr-2" />
          <span className="text-amber-400">
            Saved, but spec generation failed: {updateMutation.data.generationError}
          </span>
        </div>
      )}

      {regenerateMutation.isSuccess && (
        <div className="mb-6 p-4 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center">
          <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
          <span className="text-green-400">
            Test spec regenerated! Status: {regenerateMutation.data.status}
            {regenerateMutation.data.warnings?.length > 0 && (
              <span className="text-amber-400 ml-2">
                ({regenerateMutation.data.warnings.length} warnings)
              </span>
            )}
          </span>
        </div>
      )}

      {regenerateMutation.isError && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center">
          <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
          <span className="text-red-400">
            Failed to regenerate: {(regenerateMutation.error as Error).message}
          </span>
        </div>
      )}

      {/* Recording Info */}
      <div className="mb-6 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-zinc-400">dApp URL:</span>
            <a
              href={recording.dappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 text-zinc-300 hover:underline"
            >
              {recording.dappUrl}
            </a>
          </div>
          <div>
            <span className="text-zinc-400">Recording ID:</span>
            <span className="ml-2 text-zinc-300 font-mono">{recording.id}</span>
          </div>
        </div>
      </div>

      {/* Steps List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">
            Recorded Steps ({steps.length})
          </h2>
          <button
            onClick={handleAddStep}
            className="flex items-center px-3 py-1.5 bg-zinc-800 text-white text-sm rounded-lg hover:bg-zinc-700 transition-colors"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Step
          </button>
        </div>

        {steps.length === 0 ? (
          <div className="text-center py-12 text-zinc-400">
            <p>No steps recorded</p>
            <button
              onClick={handleAddStep}
              className="mt-4 text-zinc-300 hover:underline"
            >
              Add your first step
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {steps.map((step, index) => (
              <StepEditor
                key={step.id || index}
                step={step}
                index={index}
                onUpdate={handleUpdateStep}
                onDelete={handleDeleteStep}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
                isFirst={index === 0}
                isLast={index === steps.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
