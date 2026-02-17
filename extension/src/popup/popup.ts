/**
 * Popup script for Web3 Test Recorder
 * Handles recording toggle, step preview, and test export
 */

import type { RecordedStep } from '../types';
import { uploadRecording, canUploadToApi, getApiSettings, getProjects } from '../lib/api-client';

// State
let isRecording = false;
let recordedSteps: RecordedStep[] = [];
let startUrl: string = '';
let startTime: number = 0;
let walletConnected: boolean = false;
let walletAddress: string | null = null;

// Elements
let toggleBtn: HTMLButtonElement;
let statusIndicator: HTMLElement;
let statusText: HTMLElement;
let recordingInfo: HTMLElement;
let currentUrlEl: HTMLElement;
let stepCountEl: HTMLElement;
let previewSection: HTMLElement;
let stepList: HTMLElement;
let testNameInput: HTMLInputElement;
let saveBtn: HTMLButtonElement;
let uploadBtn: HTMLButtonElement;
let discardBtn: HTMLButtonElement;
let saveStatus: HTMLElement;
let errorMessage: HTMLElement;
let recordingControls: HTMLElement;
let settingsLink: HTMLElement;
let projectSelect: HTMLSelectElement;
let markSuccessBtn: HTMLButtonElement;
let successMarkedIndicator: HTMLElement;
let successGoalTextarea: HTMLTextAreaElement;
let apiAvailable = false;

// Step type icons
const STEP_ICONS: Record<string, string> = {
  click: '\u{1F446}',      // pointing up emoji
  input: '\u{2328}',       // keyboard emoji
  navigation: '\u{1F517}', // link emoji
  web3: '\u{1F510}',       // lock emoji
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Get elements
  toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement;
  statusIndicator = document.getElementById('status-indicator')!;
  statusText = document.getElementById('status-text')!;
  recordingInfo = document.getElementById('recording-info')!;
  currentUrlEl = document.getElementById('current-url')!;
  stepCountEl = document.getElementById('step-count')!;
  previewSection = document.getElementById('preview-section')!;
  stepList = document.getElementById('step-list')!;
  testNameInput = document.getElementById('test-name') as HTMLInputElement;
  saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  discardBtn = document.getElementById('discard-btn') as HTMLButtonElement;
  saveStatus = document.getElementById('save-status')!;
  errorMessage = document.getElementById('error-message')!;
  recordingControls = document.getElementById('recording-controls')!;
  settingsLink = document.getElementById('settings-link')!;
  projectSelect = document.getElementById('project-select') as HTMLSelectElement;
  markSuccessBtn = document.getElementById('mark-success-btn') as HTMLButtonElement;
  successMarkedIndicator = document.getElementById('success-marked-indicator')!;
  successGoalTextarea = document.getElementById('success-goal') as HTMLTextAreaElement;

  // Create upload button if not exists
  uploadBtn = document.getElementById('upload-btn') as HTMLButtonElement;
  if (!uploadBtn) {
    uploadBtn = document.createElement('button');
    uploadBtn.id = 'upload-btn';
    uploadBtn.className = 'btn-upload';
    uploadBtn.textContent = 'Upload & Generate Test';
    uploadBtn.style.display = 'none';
    saveBtn.parentNode?.insertBefore(uploadBtn, saveBtn.nextSibling);
  }

  // Event listeners
  toggleBtn.addEventListener('click', handleToggle);
  saveBtn.addEventListener('click', handleSave);
  uploadBtn.addEventListener('click', handleUpload);
  discardBtn.addEventListener('click', handleDiscard);
  testNameInput.addEventListener('input', validateSaveButton);
  settingsLink?.addEventListener('click', openSettings);
  markSuccessBtn?.addEventListener('click', handleMarkSuccess);

  // Check if API is available
  checkApiAvailability();

  // Load current state
  await loadState();
});

/**
 * Check if API upload is available
 */
async function checkApiAvailability() {
  apiAvailable = await canUploadToApi();
  updateUploadButton();

  // Populate project dropdown if API is available
  if (apiAvailable && projectSelect) {
    try {
      const projects = await getProjects();
      // Clear existing options except the first "(No project)"
      while (projectSelect.options.length > 1) {
        projectSelect.remove(1);
      }
      for (const project of projects) {
        const opt = document.createElement('option');
        opt.value = project.id;
        opt.textContent = project.name;
        projectSelect.appendChild(opt);
      }
    } catch (e) {
      console.error('Failed to load projects:', e);
    }
  }
}

/**
 * Update upload button visibility
 */
function updateUploadButton() {
  if (uploadBtn) {
    uploadBtn.style.display = apiAvailable ? 'block' : 'none';
  }
}

/**
 * Open settings page
 */
function openSettings() {
  chrome.runtime.openOptionsPage();
}

/**
 * Load current state from background
 */
async function loadState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' });

    if (!response.success) {
      console.error('Failed to get recording state:', response.error);
      updateIdleUI();
      return;
    }

    const state = response.state;

    if (state?.isRecording) {
      // Currently recording - show recording UI
      isRecording = true;
      startUrl = state.startUrl || '';
      startTime = state.startTime || Date.now();
      walletConnected = state.walletConnected || false;
      walletAddress = state.walletAddress || null;
      updateRecordingUI();

      // Show success indicator if already marked
      if (response.hasMarkedSuccess && markSuccessBtn && successMarkedIndicator) {
        markSuccessBtn.classList.add('hidden');
        successMarkedIndicator.classList.remove('hidden');
      }
    } else if (response.hasSteps) {
      // Not recording but has steps - show preview
      const stepsResponse = await chrome.runtime.sendMessage({ type: 'GET_RECORDED_STEPS' });
      recordedSteps = stepsResponse.steps || [];
      startUrl = state?.startUrl || '';
      startTime = state?.startTime || 0;
      walletConnected = state?.walletConnected || false;
      walletAddress = state?.walletAddress || null;
      showPreview();
    } else {
      // Idle state
      updateIdleUI();
    }
  } catch (error) {
    console.error('Failed to load state:', error);
    updateIdleUI();
  }
}

/**
 * Handle toggle button click
 */
async function handleToggle() {
  toggleBtn.disabled = true;

  try {
    if (isRecording) {
      // Stop recording
      await chrome.runtime.sendMessage({ type: 'STOP_RECORDING', timestamp: Date.now() });
      isRecording = false;

      // Load recorded steps
      const response = await chrome.runtime.sendMessage({ type: 'GET_RECORDED_STEPS' });
      recordedSteps = response.steps || [];

      showPreview();
    } else {
      // Start recording
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab?.url) {
        showError('Cannot record on this page');
        return;
      }

      // Check if URL is recordable
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        showError('Cannot record on browser pages');
        return;
      }

      startUrl = tab.url;
      startTime = Date.now();

      const response = await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        timestamp: Date.now(),
        tabId: tab.id,
        url: tab.url,
      });

      if (!response.success) {
        showError(response.error || 'Failed to start recording');
        return;
      }

      isRecording = true;
      updateRecordingUI();
    }
  } catch (error) {
    console.error('Toggle failed:', error);
    showError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    toggleBtn.disabled = false;
  }
}

/**
 * Update UI to show recording state
 */
function updateRecordingUI() {
  recordingControls.classList.remove('hidden');
  previewSection.classList.add('hidden');

  toggleBtn.textContent = 'Stop Recording';
  toggleBtn.classList.remove('btn-primary');
  toggleBtn.classList.add('btn-danger');
  statusIndicator.classList.remove('idle');
  statusIndicator.classList.add('recording');
  statusText.textContent = 'Recording...';

  recordingInfo.classList.remove('hidden');
  currentUrlEl.textContent = truncateUrl(startUrl);
  stepCountEl.textContent = '0';

  // Show Mark Success button, hide indicator
  if (markSuccessBtn) {
    markSuccessBtn.classList.remove('hidden');
    markSuccessBtn.disabled = false;
  }
  if (successMarkedIndicator) successMarkedIndicator.classList.add('hidden');

  // Poll for step count updates
  startStepCountPolling();
}

/**
 * Update UI to show idle state
 */
function updateIdleUI() {
  recordingControls.classList.remove('hidden');
  previewSection.classList.add('hidden');

  toggleBtn.textContent = 'Start Recording';
  toggleBtn.classList.remove('btn-danger');
  toggleBtn.classList.add('btn-primary');
  statusIndicator.classList.add('idle');
  statusIndicator.classList.remove('recording');
  statusText.textContent = 'Ready to record';
  recordingInfo.classList.add('hidden');

  // Hide Mark Success button
  if (markSuccessBtn) markSuccessBtn.classList.add('hidden');
  if (successMarkedIndicator) successMarkedIndicator.classList.add('hidden');

  // Stop polling
  stopStepCountPolling();
}

/**
 * Show preview section with recorded steps
 */
function showPreview() {
  recordingControls.classList.add('hidden');
  previewSection.classList.remove('hidden');
  saveStatus.classList.add('hidden');

  // Clear previous input
  testNameInput.value = '';

  renderStepList();
  validateSaveButton();
}

/**
 * Render the step list
 */
function renderStepList() {
  if (recordedSteps.length === 0) {
    stepList.innerHTML = '<div class="empty-state">No steps recorded</div>';
    return;
  }

  stepList.innerHTML = recordedSteps.map((step, index) => `
    <div class="step-item" data-index="${index}">
      <span class="step-icon ${step.type}">${STEP_ICONS[step.type] || '?'}</span>
      <div class="step-details">
        <div class="step-type">${formatStepType(step)}</div>
        <div class="step-info">${formatStepInfo(step)}</div>
      </div>
      <button class="step-delete" data-index="${index}" title="Delete step">&times;</button>
    </div>
  `).join('');

  // Add delete listeners
  stepList.querySelectorAll('.step-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt((e.target as HTMLElement).dataset.index || '0');
      deleteStep(index);
    });
  });
}

/**
 * Format step type for display
 */
function formatStepType(step: RecordedStep): string {
  switch (step.type) {
    case 'click': return 'Click';
    case 'input': return 'Input';
    case 'navigation': return 'Navigate';
    case 'web3': return step.web3Method || 'Web3';
    default: return step.type;
  }
}

/**
 * Format step info for display
 */
function formatStepInfo(step: RecordedStep): string {
  switch (step.type) {
    case 'click':
      return step.selector || step.metadata?.text || 'Element';
    case 'input':
      const preview = step.value?.slice(0, 30) || '';
      return preview + (step.value && step.value.length > 30 ? '...' : '');
    case 'navigation':
      return truncateUrl(step.url || '');
    case 'web3':
      if (step.txHash) return `TX: ${step.txHash.slice(0, 10)}...`;
      return step.web3Method || 'Web3 call';
    default:
      return '';
  }
}

/**
 * Delete a step from the list
 */
function deleteStep(index: number) {
  recordedSteps.splice(index, 1);
  renderStepList();
  validateSaveButton();

  // Update storage via background
  chrome.runtime.sendMessage({
    type: 'DELETE_STEP',
    index,
  });
}

/**
 * Validate if save button should be enabled
 */
function validateSaveButton() {
  const hasName = testNameInput.value.trim().length > 0;
  const hasSteps = recordedSteps.length > 0;
  saveBtn.disabled = !hasName || !hasSteps;
}

/**
 * Handle save button click - exports test as JSON file
 */
async function handleSave() {
  const name = testNameInput.value.trim();
  if (!name || recordedSteps.length === 0) return;

  saveBtn.disabled = true;
  saveBtn.textContent = 'Exporting...';
  saveStatus.classList.add('hidden');

  try {
    // Fetch console logs from background storage
    let consoleLogs: Array<{ level: string; args: string[]; timestamp: number }> = [];
    try {
      const result = await chrome.storage.session.get('consoleLogs');
      consoleLogs = result.consoleLogs || [];
    } catch {
      // No console logs available
    }

    // Fetch success state for export
    let exportSuccessState: Record<string, unknown> | undefined;
    try {
      const ssResponse = await chrome.runtime.sendMessage({
        type: 'GET_SUCCESS_STATE',
        timestamp: Date.now(),
      });
      if (ssResponse?.success && ssResponse.successState) {
        exportSuccessState = { ...ssResponse.successState };
      }
    } catch {
      // No success state available
    }
    const semanticGoal = successGoalTextarea?.value?.trim();
    if (semanticGoal) {
      exportSuccessState = exportSuccessState || {};
      exportSuccessState.semanticGoal = semanticGoal;
    }

    const testData = {
      name,
      startUrl,
      durationMs: startTime > 0 ? Date.now() - startTime : 0,
      steps: recordedSteps,
      walletConnected,
      walletAddress,
      consoleLogs,
      ...(exportSuccessState ? { successState: exportSuccessState } : {}),
      exportedAt: new Date().toISOString(),
    };

    // Create and download JSON file
    const blob = new Blob([JSON.stringify(testData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = `${name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.json`;

    // Use chrome.downloads API
    await chrome.downloads.download({
      url,
      filename,
      saveAs: true,
    });

    showSaveStatus(`Test "${name}" exported successfully!`, 'success');

    // Clear state
    await chrome.runtime.sendMessage({ type: 'CLEAR_RECORDING' });
    recordedSteps = [];

    // Return to idle after delay
    setTimeout(() => {
      updateIdleUI();
    }, 2000);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to export test';
    showSaveStatus(message, 'error');
    saveBtn.disabled = false;
  } finally {
    saveBtn.textContent = 'Export Test';
    validateSaveButton();
  }
}

/**
 * Handle upload button click - uploads to platform API and auto-generates spec
 */
async function handleUpload() {
  const name = testNameInput.value.trim();
  if (!name || recordedSteps.length === 0) return;

  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading & Generating...';
  saveStatus.classList.add('hidden');

  try {
    const selectedProjectId = projectSelect?.value || undefined;

    // Fetch success state from storage and merge in semantic goal
    let successState: Record<string, unknown> | undefined;
    try {
      const ssResponse = await chrome.runtime.sendMessage({
        type: 'GET_SUCCESS_STATE',
        timestamp: Date.now(),
      });
      if (ssResponse?.success && ssResponse.successState) {
        successState = { ...ssResponse.successState };
      }
    } catch {
      // No success state available
    }

    // Add semantic goal from textarea
    const semanticGoal = successGoalTextarea?.value?.trim();
    if (semanticGoal) {
      successState = successState || {};
      successState.semanticGoal = semanticGoal;
    }

    const result = await uploadRecording(
      name,
      startUrl,
      recordedSteps,
      {
        durationMs: startTime > 0 ? Date.now() - startTime : 0,
        stepCount: recordedSteps.length,
        walletConnected,
        walletAddress,
      },
      { autoGenerate: true, projectId: selectedProjectId },
      successState
    );

    if (result.success) {
      let statusMessage = `Uploaded! ID: ${result.recordingId?.slice(0, 8)}...`;

      // Show test spec generation result
      if (result.testSpec) {
        statusMessage += ` Test spec generated (${result.testSpec.status})`;
      } else if (result.generationError) {
        statusMessage += ` (Spec generation failed: ${result.generationError})`;
      }

      showSaveStatus(statusMessage, result.testSpec ? 'success' : 'error');

      // Clear state
      await chrome.runtime.sendMessage({ type: 'CLEAR_RECORDING' });
      recordedSteps = [];

      // Return to idle after delay
      setTimeout(() => {
        updateIdleUI();
      }, 3000);
    } else {
      showSaveStatus(result.error || 'Upload failed', 'error');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to upload';
    showSaveStatus(message, 'error');
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload & Generate Test';
    validateSaveButton();
  }
}

/**
 * Handle discard button click
 */
async function handleDiscard() {
  if (!confirm('Discard all recorded steps?')) return;

  await chrome.runtime.sendMessage({ type: 'CLEAR_RECORDING' });
  recordedSteps = [];
  updateIdleUI();
}

/**
 * Handle "Mark Success" button click — captures current page state as success snapshot
 */
async function handleMarkSuccess() {
  if (!markSuccessBtn) return;

  markSuccessBtn.disabled = true;
  markSuccessBtn.textContent = 'Capturing...';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CAPTURE_SUCCESS_STATE',
      timestamp: Date.now(),
    });

    if (response?.success) {
      markSuccessBtn.classList.add('hidden');
      if (successMarkedIndicator) successMarkedIndicator.classList.remove('hidden');
    } else {
      showError(response?.error || 'Failed to capture success state');
      markSuccessBtn.disabled = false;
    }
  } catch (error) {
    console.error('Failed to mark success:', error);
    showError('Failed to capture success state');
    markSuccessBtn.disabled = false;
  } finally {
    markSuccessBtn.textContent = 'Mark as Success';
  }
}

/**
 * Show save status message
 */
function showSaveStatus(message: string, type: 'success' | 'error') {
  saveStatus.textContent = message;
  saveStatus.className = type;
  saveStatus.classList.remove('hidden');
}

/**
 * Show error message
 */
function showError(message: string) {
  errorMessage.textContent = message;
  errorMessage.classList.remove('hidden');
  setTimeout(() => errorMessage.classList.add('hidden'), 3000);
}

/**
 * Truncate URL for display
 */
function truncateUrl(url: string): string {
  if (url.length <= 40) return url;
  return url.slice(0, 37) + '...';
}

// Poll for step count during recording
let pollInterval: number | null = null;

/**
 * Start polling for step count updates
 */
function startStepCountPolling() {
  if (pollInterval) return;

  pollInterval = window.setInterval(async () => {
    if (!isRecording) {
      stopStepCountPolling();
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' });
      const count = response.stepCount || response.state?.stepCount || 0;
      stepCountEl.textContent = String(count);
    } catch (error) {
      console.error('Failed to poll step count:', error);
    }
  }, 500);
}

/**
 * Stop polling for step count updates
 */
function stopStepCountPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
