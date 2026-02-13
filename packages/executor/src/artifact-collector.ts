import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, extname, basename } from 'path';
import { createHash } from 'crypto';

export interface Artifact {
  id: string;
  type: 'screenshot' | 'video' | 'trace' | 'har' | 'log';
  name: string;
  path: string;
  stepName?: string;
  mimeType: string;
  sizeBytes: number;
  hash: string;
  createdAt: Date;
}

export interface ArtifactCollectorOptions {
  outputDir: string;
  includeScreenshots?: boolean;
  includeVideo?: boolean;
  includeTrace?: boolean;
  includeHar?: boolean;
  includeLogs?: boolean;
}

/**
 * Collects and organizes test artifacts (screenshots, videos, traces, etc.)
 */
export class ArtifactCollector {
  private options: Required<ArtifactCollectorOptions>;
  private artifacts: Artifact[] = [];

  constructor(options: ArtifactCollectorOptions) {
    this.options = {
      includeScreenshots: true,
      includeVideo: true,
      includeTrace: true,
      includeHar: true,
      includeLogs: true,
      ...options,
    };
  }

  /**
   * Scan a directory for artifacts
   */
  collect(sourceDir: string): Artifact[] {
    this.artifacts = [];

    if (!existsSync(sourceDir)) {
      return this.artifacts;
    }

    this.scanDirectory(sourceDir);
    return this.artifacts;
  }

  /**
   * Recursively scan a directory
   */
  private scanDirectory(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        this.scanDirectory(fullPath);
      } else {
        const artifact = this.classifyFile(fullPath);
        if (artifact) {
          this.artifacts.push(artifact);
        }
      }
    }
  }

  /**
   * Classify a file and create an artifact entry
   */
  private classifyFile(filePath: string): Artifact | null {
    const ext = extname(filePath).toLowerCase();
    const name = basename(filePath);
    const stat = statSync(filePath);

    let type: Artifact['type'] | null = null;
    let mimeType = 'application/octet-stream';

    // Screenshots
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      if (!this.options.includeScreenshots) return null;
      type = 'screenshot';
      mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    }
    // Videos
    else if (['.webm', '.mp4'].includes(ext)) {
      if (!this.options.includeVideo) return null;
      type = 'video';
      mimeType = ext === '.webm' ? 'video/webm' : 'video/mp4';
    }
    // Traces
    else if (ext === '.zip' && name.includes('trace')) {
      if (!this.options.includeTrace) return null;
      type = 'trace';
      mimeType = 'application/zip';
    }
    // HAR files
    else if (ext === '.har') {
      if (!this.options.includeHar) return null;
      type = 'har';
      mimeType = 'application/json';
    }
    // Logs
    else if (['.log', '.txt', '.json'].includes(ext)) {
      if (!this.options.includeLogs) return null;
      type = 'log';
      mimeType = ext === '.json' ? 'application/json' : 'text/plain';
    }

    if (!type) return null;

    // Calculate hash
    const content = readFileSync(filePath);
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);

    // Try to extract step name from filename
    const stepMatch = name.match(/step[_-]?(\d+)|(\d+)[_-]?step/i);
    const stepName = stepMatch ? `Step ${stepMatch[1] || stepMatch[2]}` : undefined;

    return {
      id: `${type}-${hash}`,
      type,
      name,
      path: filePath,
      stepName,
      mimeType,
      sizeBytes: stat.size,
      hash,
      createdAt: stat.mtime,
    };
  }

  /**
   * Copy artifacts to the output directory
   */
  copyToOutputDir(): Map<string, string> {
    const pathMap = new Map<string, string>();

    mkdirSync(this.options.outputDir, { recursive: true });

    for (const artifact of this.artifacts) {
      const destPath = join(this.options.outputDir, artifact.name);

      try {
        const content = readFileSync(artifact.path);
        writeFileSync(destPath, content);
        pathMap.set(artifact.id, destPath);
      } catch (error) {
        console.error(`Failed to copy artifact ${artifact.name}:`, error);
      }
    }

    return pathMap;
  }

  /**
   * Get artifacts by type
   */
  getByType(type: Artifact['type']): Artifact[] {
    return this.artifacts.filter(a => a.type === type);
  }

  /**
   * Get all collected artifacts
   */
  getAll(): Artifact[] {
    return [...this.artifacts];
  }

  /**
   * Get total size of all artifacts
   */
  getTotalSize(): number {
    return this.artifacts.reduce((sum, a) => sum + a.sizeBytes, 0);
  }

  /**
   * Generate a summary of collected artifacts
   */
  getSummary(): {
    total: number;
    byType: Record<string, number>;
    totalSizeBytes: number;
  } {
    const byType: Record<string, number> = {};

    for (const artifact of this.artifacts) {
      byType[artifact.type] = (byType[artifact.type] || 0) + 1;
    }

    return {
      total: this.artifacts.length,
      byType,
      totalSizeBytes: this.getTotalSize(),
    };
  }
}

/**
 * Create an artifact collector
 */
export function createArtifactCollector(
  options: ArtifactCollectorOptions
): ArtifactCollector {
  return new ArtifactCollector(options);
}

/**
 * Collect artifacts from a directory
 */
export function collectArtifacts(
  sourceDir: string,
  outputDir: string
): Artifact[] {
  const collector = createArtifactCollector({ outputDir });
  return collector.collect(sourceDir);
}
