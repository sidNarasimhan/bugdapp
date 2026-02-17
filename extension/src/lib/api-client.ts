/**
 * API Client for Web3 Test Platform
 * Handles communication between the extension and the backend API
 */

// Storage keys
const STORAGE_KEY_API_URL = 'apiUrl';
const STORAGE_KEY_API_KEY = 'apiKey';

// Default API URL
const DEFAULT_API_URL = 'http://127.0.0.1:3001';

export interface UploadResult {
  success: boolean;
  recordingId?: string;
  error?: string;
  testSpec?: {
    id: string;
    status: string;
    hasCode: boolean;
  };
  generationError?: string;
}

export interface UploadOptions {
  autoGenerate?: boolean;
  projectId?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
}

export interface ApiSettings {
  apiUrl: string;
  apiKey: string;
}

/**
 * Get API settings from storage
 */
export async function getApiSettings(): Promise<ApiSettings> {
  const result = await chrome.storage.sync.get([STORAGE_KEY_API_URL, STORAGE_KEY_API_KEY]);
  let apiUrl = result[STORAGE_KEY_API_URL] || DEFAULT_API_URL;
  // Auto-fix: localhost doesn't resolve on some Windows setups (IPv6 issue)
  apiUrl = apiUrl.replace('://localhost:', '://127.0.0.1:');
  return {
    apiUrl,
    apiKey: result[STORAGE_KEY_API_KEY] || '',
  };
}

/**
 * Save API settings to storage
 */
export async function saveApiSettings(settings: Partial<ApiSettings>): Promise<void> {
  const updates: Record<string, string> = {};
  if (settings.apiUrl !== undefined) {
    updates[STORAGE_KEY_API_URL] = settings.apiUrl;
  }
  if (settings.apiKey !== undefined) {
    updates[STORAGE_KEY_API_KEY] = settings.apiKey;
  }
  await chrome.storage.sync.set(updates);
}

/**
 * Check if API is configured (has URL)
 */
export async function isApiConfigured(): Promise<boolean> {
  const settings = await getApiSettings();
  return !!settings.apiUrl;
}

/**
 * Test API connection
 */
export async function testApiConnection(): Promise<{
  success: boolean;
  message: string;
}> {
  const settings = await getApiSettings();

  if (!settings.apiUrl) {
    return { success: false, message: 'API URL not configured' };
  }

  try {
    const response = await fetch(`${settings.apiUrl}/api/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (response.ok) {
      return { success: true, message: 'Connected successfully' };
    } else {
      return { success: false, message: `Server returned ${response.status}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    return { success: false, message };
  }
}

/**
 * Fetch projects from the API
 */
export async function getProjects(): Promise<ProjectInfo[]> {
  const settings = await getApiSettings();
  if (!settings.apiUrl) return [];

  try {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (settings.apiKey) headers['X-API-Key'] = settings.apiKey;

    const response = await fetch(`${settings.apiUrl}/api/projects`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return [];
    const data = await response.json();
    return (data.projects || []).map((p: { id: string; name: string }) => ({
      id: p.id,
      name: p.name,
    }));
  } catch {
    return [];
  }
}

/**
 * Upload a recording to the API
 */
export async function uploadRecording(
  name: string,
  startUrl: string,
  steps: unknown[],
  metadata?: Record<string, unknown>,
  options?: UploadOptions,
  successState?: Record<string, unknown>
): Promise<UploadResult> {
  const settings = await getApiSettings();

  if (!settings.apiUrl) {
    return { success: false, error: 'API URL not configured. Open extension settings to configure.' };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Add API key if configured
    if (settings.apiKey) {
      headers['X-API-Key'] = settings.apiKey;
    }

    const response = await fetch(`${settings.apiUrl}/api/recordings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name,
        jsonData: {
          name,
          startUrl,
          steps,
          metadata: {
            ...metadata,
            source: 'web3-test-extension',
            uploadedAt: new Date().toISOString(),
          },
          ...(successState ? { successState } : {}),
          exportedAt: new Date().toISOString(),
        },
        autoGenerate: options?.autoGenerate ?? true,
        ...(options?.projectId ? { projectId: options.projectId } : {}),
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      return {
        success: false,
        error: error.error || error.message || `Server returned ${response.status}`,
      };
    }

    const result = await response.json();
    return {
      success: true,
      recordingId: result.id,
      testSpec: result.testSpec,
      generationError: result.generationError,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    return { success: false, error: message };
  }
}

/**
 * Check if API upload is available
 */
export async function canUploadToApi(): Promise<boolean> {
  const settings = await getApiSettings();
  if (!settings.apiUrl) {
    return false;
  }

  // Quick check if API is reachable
  try {
    const response = await fetch(`${settings.apiUrl}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });
    return response.ok;
  } catch {
    return false;
  }
}
