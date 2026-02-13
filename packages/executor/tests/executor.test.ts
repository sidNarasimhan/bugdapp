import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  ArtifactCollector,
  createArtifactCollector,
  collectArtifacts,
  type Artifact,
} from '../src/artifact-collector.js';

import {
  TestRunner,
  createRunner,
  type RunnerOptions,
  type RunResult,
} from '../src/runner.js';

import {
  DEFAULT_WALLET_CONFIG,
  type WalletConfig,
} from '../src/wallet-setup.js';

// Worker module is not imported directly to avoid Prisma initialization issues
// These tests focus on the core utilities that don't require database/redis

describe('ArtifactCollector', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `test-artifacts-${randomBytes(4).toString('hex')}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should collect screenshots', () => {
    // Create test screenshot file
    const screenshotPath = join(testDir, 'step1.png');
    writeFileSync(screenshotPath, Buffer.from('fake-png-data'));

    const collector = createArtifactCollector({
      outputDir: join(testDir, 'output'),
    });

    const artifacts = collector.collect(testDir);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('screenshot');
    expect(artifacts[0].name).toBe('step1.png');
    expect(artifacts[0].mimeType).toBe('image/png');
  });

  it('should collect videos', () => {
    const videoPath = join(testDir, 'test-video.webm');
    writeFileSync(videoPath, Buffer.from('fake-video-data'));

    const collector = createArtifactCollector({
      outputDir: join(testDir, 'output'),
    });

    const artifacts = collector.collect(testDir);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('video');
    expect(artifacts[0].mimeType).toBe('video/webm');
  });

  it('should collect trace files', () => {
    const tracePath = join(testDir, 'trace.zip');
    writeFileSync(tracePath, Buffer.from('fake-trace-data'));

    const collector = createArtifactCollector({
      outputDir: join(testDir, 'output'),
    });

    const artifacts = collector.collect(testDir);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('trace');
  });

  it('should collect HAR files', () => {
    const harPath = join(testDir, 'network.har');
    writeFileSync(harPath, Buffer.from('{"log":{}}'));

    const collector = createArtifactCollector({
      outputDir: join(testDir, 'output'),
    });

    const artifacts = collector.collect(testDir);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('har');
    expect(artifacts[0].mimeType).toBe('application/json');
  });

  it('should collect log files', () => {
    const logPath = join(testDir, 'output.log');
    writeFileSync(logPath, 'test log content');

    const collector = createArtifactCollector({
      outputDir: join(testDir, 'output'),
    });

    const artifacts = collector.collect(testDir);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('log');
    expect(artifacts[0].mimeType).toBe('text/plain');
  });

  it('should recursively scan directories', () => {
    const subDir = join(testDir, 'subdir');
    mkdirSync(subDir, { recursive: true });

    writeFileSync(join(testDir, 'root.png'), Buffer.from('data'));
    writeFileSync(join(subDir, 'nested.png'), Buffer.from('data'));

    const collector = createArtifactCollector({
      outputDir: join(testDir, 'output'),
    });

    const artifacts = collector.collect(testDir);

    expect(artifacts).toHaveLength(2);
  });

  it('should filter by artifact type options', () => {
    writeFileSync(join(testDir, 'image.png'), Buffer.from('data'));
    writeFileSync(join(testDir, 'video.webm'), Buffer.from('data'));

    const collector = createArtifactCollector({
      outputDir: join(testDir, 'output'),
      includeScreenshots: true,
      includeVideo: false,
    });

    const artifacts = collector.collect(testDir);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('screenshot');
  });

  it('should extract step name from filename', () => {
    writeFileSync(join(testDir, 'step_3_click.png'), Buffer.from('data'));

    const collector = createArtifactCollector({
      outputDir: join(testDir, 'output'),
    });

    const artifacts = collector.collect(testDir);

    expect(artifacts[0].stepName).toBe('Step 3');
  });

  it('should get artifacts by type', () => {
    writeFileSync(join(testDir, 'a.png'), Buffer.from('data'));
    writeFileSync(join(testDir, 'b.png'), Buffer.from('data'));
    writeFileSync(join(testDir, 'c.webm'), Buffer.from('data'));

    const collector = createArtifactCollector({
      outputDir: join(testDir, 'output'),
    });

    collector.collect(testDir);

    const screenshots = collector.getByType('screenshot');
    expect(screenshots).toHaveLength(2);

    const videos = collector.getByType('video');
    expect(videos).toHaveLength(1);
  });

  it('should calculate total size', () => {
    writeFileSync(join(testDir, 'a.png'), Buffer.alloc(100));
    writeFileSync(join(testDir, 'b.png'), Buffer.alloc(200));

    const collector = createArtifactCollector({
      outputDir: join(testDir, 'output'),
    });

    collector.collect(testDir);

    expect(collector.getTotalSize()).toBe(300);
  });

  it('should generate summary', () => {
    writeFileSync(join(testDir, 'a.png'), Buffer.alloc(100));
    writeFileSync(join(testDir, 'b.webm'), Buffer.alloc(200));
    writeFileSync(join(testDir, 'c.log'), Buffer.alloc(50));

    const collector = createArtifactCollector({
      outputDir: join(testDir, 'output'),
    });

    collector.collect(testDir);

    const summary = collector.getSummary();

    expect(summary.total).toBe(3);
    expect(summary.byType.screenshot).toBe(1);
    expect(summary.byType.video).toBe(1);
    expect(summary.byType.log).toBe(1);
    expect(summary.totalSizeBytes).toBe(350);
  });

  it('should return empty array for non-existent directory', () => {
    const artifacts = collectArtifacts('/non/existent/path', testDir);
    expect(artifacts).toEqual([]);
  });
});

describe('TestRunner', () => {
  it('should create runner with default options', () => {
    const runner = createRunner();
    expect(runner).toBeInstanceOf(TestRunner);
  });

  it('should create runner with custom options', () => {
    const options: RunnerOptions = {
      headless: true,
      timeout: 60000,
      debug: true,
    };

    const runner = createRunner(options);
    expect(runner).toBeInstanceOf(TestRunner);
  });

  it('should generate playwright config with correct settings', () => {
    const runner = createRunner({
      headless: true,
      timeout: 120000,
    });

    // Access private method via any cast for testing
    const config = (runner as any).generatePlaywrightConfig('/tmp/artifacts');

    expect(config).toContain('headless: true');
    expect(config).toContain('timeout: 120000');
    expect(config).toContain("screenshot: 'on'");
    expect(config).toContain("video: 'on'");
    expect(config).toContain("trace: 'on'");
  });
});

describe('WalletConfig', () => {
  it('should have default wallet config', () => {
    expect(DEFAULT_WALLET_CONFIG).toBeDefined();
    expect(DEFAULT_WALLET_CONFIG.seedPhrase).toBeDefined();
    expect(DEFAULT_WALLET_CONFIG.password).toBeDefined();
  });

  it('should use test wallet seed phrase', () => {
    // Standard test seed phrase
    expect(DEFAULT_WALLET_CONFIG.seedPhrase).toBe(
      'test test test test test test test test test test test junk'
    );
  });
});

// Worker/Queue tests are skipped in unit tests as they require Redis
// Integration tests would cover the worker functionality
