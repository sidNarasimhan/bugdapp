/**
 * Settings page script for Web3 Test Recorder
 */

import { getApiSettings, saveApiSettings, testApiConnection } from '../lib/api-client';

// Elements
let apiUrlInput: HTMLInputElement;
let apiKeyInput: HTMLInputElement;
let saveBtn: HTMLButtonElement;
let testBtn: HTMLButtonElement;
let statusMessage: HTMLElement;
let connectionDot: HTMLElement;
let connectionText: HTMLElement;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Get elements
  apiUrlInput = document.getElementById('api-url') as HTMLInputElement;
  apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
  saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  testBtn = document.getElementById('test-btn') as HTMLButtonElement;
  statusMessage = document.getElementById('status-message')!;
  connectionDot = document.getElementById('connection-dot')!;
  connectionText = document.getElementById('connection-text')!;

  // Load current settings
  await loadSettings();

  // Event listeners
  saveBtn.addEventListener('click', handleSave);
  testBtn.addEventListener('click', handleTest);
});

/**
 * Load settings from storage
 */
async function loadSettings() {
  const settings = await getApiSettings();
  apiUrlInput.value = settings.apiUrl || '';
  apiKeyInput.value = settings.apiKey || '';
}

/**
 * Handle save button click
 */
async function handleSave() {
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    await saveApiSettings({
      apiUrl: apiUrlInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
    });

    showStatus('Settings saved successfully!', 'success');

    // Auto-test connection after save
    await handleTest();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save settings';
    showStatus(message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Settings';
  }
}

/**
 * Handle test connection button click
 */
async function handleTest() {
  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';
  updateConnectionStatus('testing');

  try {
    const result = await testApiConnection();

    if (result.success) {
      updateConnectionStatus('connected');
      showStatus('Connection successful!', 'success');
    } else {
      updateConnectionStatus('error');
      showStatus(`Connection failed: ${result.message}`, 'error');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection test failed';
    updateConnectionStatus('error');
    showStatus(message, 'error');
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';
  }
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(status: 'testing' | 'connected' | 'error' | 'unknown') {
  connectionDot.classList.remove('connected', 'error');

  switch (status) {
    case 'testing':
      connectionText.textContent = 'Testing...';
      break;
    case 'connected':
      connectionDot.classList.add('connected');
      connectionText.textContent = 'Connected';
      break;
    case 'error':
      connectionDot.classList.add('error');
      connectionText.textContent = 'Connection failed';
      break;
    default:
      connectionText.textContent = 'Not tested';
  }
}

/**
 * Show status message
 */
function showStatus(message: string, type: 'success' | 'error') {
  statusMessage.textContent = message;
  statusMessage.className = `status show ${type}`;

  // Auto-hide success messages
  if (type === 'success') {
    setTimeout(() => {
      statusMessage.classList.remove('show');
    }, 3000);
  }
}
