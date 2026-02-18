const API_BASE = '/api';

export interface RecordingStep {
  id: string;
  type: 'click' | 'input' | 'navigation' | 'web3' | 'scroll';
  timestamp: number;
  selector?: string;
  value?: string;
  url?: string;
  web3Method?: string;
  web3Params?: unknown;
  web3Result?: unknown;
  chainId?: number;
  scrollX?: number;
  scrollY?: number;
  metadata?: Record<string, unknown>;
}

export interface RecordingJsonData {
  name: string;
  startUrl: string;
  steps: RecordingStep[];
  metadata?: Record<string, unknown>;
  durationMs?: number;
}

export interface Recording {
  id: string;
  name: string;
  dappUrl: string;
  stepCount: number;
  chainId?: number;
  walletName?: string;
  jsonData?: RecordingJsonData;
  metadata?: object;
  createdAt: string;
  updatedAt?: string;
}

export interface TestSpec {
  id: string;
  recordingId: string;
  recordingName?: string | null;
  code: string;
  version: number;
  status: 'DRAFT' | 'NEEDS_REVIEW' | 'READY' | 'TESTED';
  createdAt: string;
  updatedAt: string;
}

export interface AgentAction {
  tool: string;
  input: Record<string, unknown>;
  output: string;
  success: boolean;
  screenshotBefore?: string;
  screenshotAfter?: string;
  elementRef?: string;
  elementDesc?: string;
  durationMs: number;
}

export interface AgentStepData {
  stepId: string;
  description: string;
  status: 'passed' | 'failed' | 'skipped';
  summary?: string;
  error?: string;
  apiCalls: number;
  durationMs: number;
  screenshotPath?: string;
  actions: AgentAction[];
}

export interface AgentRunData {
  steps: AgentStepData[];
  usage: {
    totalApiCalls: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    estimatedCostUsd: number;
  };
  model: string;
  mode?: 'agent' | 'hybrid';
}

export interface TestRun {
  id: string;
  testSpecId: string;
  recordingName?: string | null;
  status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';
  headless: boolean;
  passed?: boolean;
  durationMs?: number;
  error?: string;
  logs?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  artifacts?: Artifact[];
  // Streaming fields
  containerId?: string;
  vncPort?: number;
  streamingMode?: 'NONE' | 'VNC' | 'VIDEO';
  // Agent mode fields
  executionMode?: 'SPEC' | 'AGENT' | 'HYBRID';
  agentData?: AgentRunData | null;
}

export interface Artifact {
  id: string;
  testRunId: string;
  type: 'SCREENSHOT' | 'VIDEO' | 'TRACE' | 'LOG';
  name: string;
  storagePath: string;
  stepName?: string;
  createdAt: string;
}

export interface Clarification {
  id: string;
  testSpecId: string;
  type?: 'SELECTOR' | 'WAIT' | 'NETWORK' | 'ACTION' | 'GENERAL';
  question: string;
  context?: string;
  options?: string[];
  answer?: string;
  status: 'PENDING' | 'ANSWERED' | 'SKIPPED';
  createdAt: string;
}

export interface PendingClarification {
  id: string;
  type: string;
  question: string;
  options: string[];
  context?: string;
}

export interface SpecLastRun {
  id: string;
  status: string;
  durationMs?: number;
  error?: string;
  createdAt: string;
}

export interface LatestSpec {
  id: string;
  status: string;
  code: string;
  patterns?: unknown;
  warnings?: string[];
  pendingClarifications: PendingClarification[];
  lastRun: SpecLastRun | null;
  runCount: number;
}

export interface FailureAnalysis {
  diagnosis: string;
  suggestedFix?: string;
  category: 'selector' | 'timeout' | 'network' | 'assertion' | 'unknown';
  runId: string;
  error?: string;
}

export interface RecentRunStat {
  id: string;
  status: string;
  durationMs?: number;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  recordingName?: string;
  dappUrl?: string;
  testSpecId: string;
}

export interface PlatformStats {
  projects: number;
  recordings: number;
  specs: number;
  runs: {
    total: number;
    passed: number;
    failed: number;
    running: number;
    pending: number;
    passRate: number;
  };
  recentRuns: RecentRunStat[];
}

export interface ProjectRecording extends Recording {
  latestSpec?: LatestSpec | null;
  groupId?: string | null;
}

export interface TestGroup {
  id: string;
  name: string;
  description?: string;
  projectId: string;
  recordingCount: number;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  homeUrl: string;
  description?: string;
  walletAddress: string;
  seedPhrase?: string; // Only present on creation response
  chainId?: number;
  recordingCount?: number;
  suiteRunCount?: number;
  createdAt: string;
  updatedAt?: string;
  recordings?: ProjectRecording[];
  groups?: TestGroup[];
  recentSuiteRuns?: SuiteRun[];
}

// --- Replay types ---

export interface ReplayFrame {
  sha1: string;
  timestamp: number;
  width: number;
  height: number;
  pageId: string;
}

export interface ReplayAction {
  callId: string;
  method: string;
  apiName: string;
  label: string;
  params: Record<string, unknown>;
  startTime: number;
  endTime: number;
  pageId: string;
  error?: string;
}

export interface ReplayManifest {
  runId: string;
  pageId: string;
  totalDurationMs: number;
  frameCount: number;
  frames: ReplayFrame[];
  actions: ReplayAction[];
  baseTimestamp: number;
}

// --- Screenshot Player types ---

export interface FrameItem {
  index: number;
  url: string;
  label: string;
  stepIndex?: number;
  stepDescription?: string;
}

export interface FrameListResponse {
  runId: string;
  frameCount: number;
  frames: FrameItem[];
}

export interface SuiteRun {
  id: string;
  projectId: string;
  project?: { id: string; name: string; walletAddress: string };
  status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';
  specIds: string[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  durationMs?: number;
  error?: string;
  logs?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  testRuns?: Array<TestRun & { artifacts?: Artifact[] }>;
}

class ApiClient {
  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...options?.headers as Record<string, string>,
    };
    // Only set Content-Type for requests with a body
    if (options?.body) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return undefined as T;
    }

    return response.json();
  }

  // Stats
  async getStats(): Promise<PlatformStats> {
    return this.request('/stats');
  }

  // Recordings
  async getRecordings(): Promise<Recording[]> {
    const response = await this.request<{ recordings: Recording[] }>('/recordings');
    return response.recordings;
  }

  async getRecording(id: string): Promise<Recording> {
    return this.request(`/recordings/${id}`);
  }

  async createRecording(
    params: { name?: string; jsonData: object; projectId?: string }
  ): Promise<Recording> {
    return this.request('/recordings', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async deleteRecording(id: string): Promise<void> {
    await this.request(`/recordings/${id}`, { method: 'DELETE' });
  }

  async deleteAllRecordings(): Promise<{ deleted: number; message: string }> {
    return this.request('/recordings/all/recordings', { method: 'DELETE' });
  }

  async deleteAllTestSpecs(): Promise<{ deleted: number; message: string }> {
    return this.request('/tests/all/specs', { method: 'DELETE' });
  }

  async deleteAllTestRuns(): Promise<{ deleted: number; message: string }> {
    return this.request('/runs/all/runs', { method: 'DELETE' });
  }

  async updateRecording(
    id: string,
    params: { name?: string; steps?: RecordingStep[]; autoRegenerate?: boolean; groupId?: string | null }
  ): Promise<Recording & { testSpec?: { id: string; status: string }; generationError?: string }> {
    return this.request(`/recordings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  }

  async regenerateSpec(recordingId: string): Promise<{
    id: string;
    status: string;
    hasCode: boolean;
    warnings: string[];
  }> {
    return this.request(`/recordings/${recordingId}/regenerate`, {
      method: 'POST',
    });
  }

  // Test Specs
  async getTestSpecs(): Promise<TestSpec[]> {
    const response = await this.request<{ tests: TestSpec[] }>('/tests');
    return response.tests;
  }

  async getTestSpec(id: string): Promise<TestSpec> {
    return this.request(`/tests/${id}`);
  }

  async generateTestSpec(recordingId: string): Promise<TestSpec> {
    return this.request('/tests/generate', {
      method: 'POST',
      body: JSON.stringify({ recordingId }),
    });
  }

  async updateTestSpec(id: string, code: string): Promise<TestSpec> {
    return this.request(`/tests/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ code }),
    });
  }

  async validateTestSpec(id: string): Promise<{ valid: boolean; errors: string[] }> {
    return this.request(`/tests/${id}/validate`, { method: 'POST' });
  }

  // Test Runs
  async getTestRuns(testSpecId?: string): Promise<TestRun[]> {
    const query = testSpecId ? `?testSpecId=${testSpecId}` : '';
    const response = await this.request<{ runs: TestRun[] }>(`/runs${query}`);
    return response.runs;
  }

  async getTestRun(id: string): Promise<TestRun> {
    return this.request(`/runs/${id}`);
  }

  async createTestRun(
    testSpecId: string,
    options: { headless?: boolean; streamingMode?: 'NONE' | 'VNC' | 'VIDEO'; executionMode?: 'SPEC' | 'AGENT' | 'HYBRID' } = {}
  ): Promise<TestRun & { queued: boolean; message: string }> {
    const { headless = false, streamingMode = 'NONE', executionMode } = options;
    return this.request('/runs', {
      method: 'POST',
      body: JSON.stringify({ testSpecId, headless, streamingMode, ...(executionMode && { executionMode }) }),
    });
  }

  // Cancel a running or pending test run
  async cancelRun(id: string): Promise<{ id: string; status: string }> {
    return this.request(`/runs/${id}/cancel`, { method: 'POST' });
  }

  // Start a run with live streaming
  async startStreamingRun(testSpecId: string): Promise<{
    runId: string;
    containerId?: string;
    vncPort?: number;
    websockifyPort?: number;
    streamUrl?: string;
  }> {
    return this.request('/stream/start', {
      method: 'POST',
      body: JSON.stringify({ testSpecId }),
    });
  }

  // Stop a streaming run
  async stopStreamingRun(runId: string): Promise<{ success: boolean; message: string }> {
    return this.request(`/runs/${runId}/stop`, {
      method: 'POST',
    });
  }

  // Get container pool status
  async getContainerStatus(): Promise<{
    dockerAvailable: boolean;
    containers: Array<{
      id: string;
      runId: string;
      status: string;
      created: string;
    }>;
  }> {
    return this.request('/containers/status');
  }

  async getTestRunArtifacts(runId: string): Promise<Artifact[]> {
    const response = await this.request<{ artifacts: Artifact[] }>(`/runs/${runId}/artifacts`);
    return response.artifacts;
  }

  // Server-Sent Events for live updates
  subscribeToRun(runId: string, onUpdate: (run: TestRun) => void): () => void {
    const eventSource = new EventSource(`${API_BASE}/runs/${runId}/stream`);

    eventSource.onmessage = (event) => {
      const run = JSON.parse(event.data);
      onUpdate(run);
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => eventSource.close();
  }

  // Clarifications
  async getClarifications(testSpecId: string): Promise<Clarification[]> {
    return this.request(`/clarifications?testSpecId=${testSpecId}`);
  }

  async answerClarification(id: string, answer: string): Promise<Clarification> {
    return this.request(`/clarifications/${id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    });
  }

  async skipClarification(id: string): Promise<{ id: string; status: string }> {
    return this.request(`/clarifications/${id}/skip`, {
      method: 'POST',
    });
  }

  // AI Analysis
  async analyzeFailure(specId: string): Promise<FailureAnalysis> {
    return this.request(`/analysis/${specId}/analyze-failure`, {
      method: 'POST',
    });
  }

  // Projects
  async getProjects(): Promise<Project[]> {
    const response = await this.request<{ projects: Project[] }>('/projects');
    return response.projects;
  }

  async getProject(id: string): Promise<Project> {
    return this.request(`/projects/${id}`);
  }

  async createProject(params: {
    name: string;
    homeUrl: string;
    description?: string;
    chainId?: number;
  }): Promise<Project> {
    return this.request('/projects', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async updateProject(id: string, params: {
    name?: string;
    homeUrl?: string;
    description?: string;
    chainId?: number;
  }): Promise<Project> {
    return this.request(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  }

  async deleteProject(id: string): Promise<void> {
    await this.request(`/projects/${id}`, { method: 'DELETE' });
  }

  async runSuite(projectId: string, options?: {
    headless?: boolean;
    streamingMode?: 'NONE' | 'VNC' | 'VIDEO';
  }): Promise<SuiteRun & { queued: boolean; message: string }> {
    return this.request(`/projects/${projectId}/run-suite`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  async getSuiteRuns(projectId: string): Promise<SuiteRun[]> {
    const response = await this.request<{ suiteRuns: SuiteRun[] }>(`/projects/${projectId}/suite-runs`);
    return response.suiteRuns;
  }

  async getSuiteRun(id: string): Promise<SuiteRun> {
    return this.request(`/suite-runs/${id}`);
  }

  // Groups
  async createGroup(projectId: string, params: { name: string; description?: string }): Promise<TestGroup> {
    return this.request(`/projects/${projectId}/groups`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async updateGroup(id: string, params: { name?: string; description?: string }): Promise<TestGroup> {
    return this.request(`/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  }

  async deleteGroup(id: string): Promise<void> {
    await this.request(`/groups/${id}`, { method: 'DELETE' });
  }

  async runGroupSuite(projectId: string, groupId: string, options?: {
    headless?: boolean;
    streamingMode?: 'NONE' | 'VNC' | 'VIDEO';
  }): Promise<SuiteRun & { queued: boolean; message: string }> {
    return this.request(`/projects/${projectId}/groups/${groupId}/run-suite`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  // Frames (screenshot player)
  async getFrames(runId: string): Promise<FrameListResponse> {
    return this.request(`/runs/${runId}/frames`);
  }

  // Replay
  async getReplayManifest(runId: string): Promise<ReplayManifest> {
    return this.request(`/runs/${runId}/replay`);
  }

  getReplayFrameUrl(runId: string, sha1: string): string {
    return `${API_BASE}/runs/${runId}/replay/frames/${sha1}`;
  }
}

export const api = new ApiClient();
