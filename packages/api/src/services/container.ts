import Docker from 'dockerode';
import { prisma } from '../db.js';

// Docker configuration
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const EXECUTOR_IMAGE = process.env.EXECUTOR_IMAGE || 'web3-test-executor:latest';
const NETWORK_NAME = process.env.DOCKER_NETWORK || 'web3-test-network';

// VNC port range
const VNC_PORT_START = parseInt(process.env.VNC_PORT_START || '5901', 10);
const VNC_PORT_END = parseInt(process.env.VNC_PORT_END || '5910', 10);
const WEBSOCKIFY_PORT_START = parseInt(process.env.WEBSOCKIFY_PORT_START || '6081', 10);

// Track allocated ports
const allocatedPorts = new Set<number>();

/**
 * Container orchestration service for managing executor containers
 */
class ContainerService {
  private docker: Docker | null = null;
  private isAvailable = false;
  private connectionChecked = false;

  /**
   * Initialize Docker connection
   */
  private async initialize(): Promise<boolean> {
    if (this.connectionChecked) {
      return this.isAvailable;
    }

    this.connectionChecked = true;

    try {
      this.docker = new Docker({ socketPath: DOCKER_SOCKET });

      // Test connection
      await this.docker.ping();

      this.isAvailable = true;
      console.log('[ContainerService] Connected to Docker');
      return true;
    } catch (error) {
      console.warn('[ContainerService] Docker not available:', error instanceof Error ? error.message : error);
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * Allocate a free VNC port
   */
  private allocatePort(startPort: number, endPort: number): number | null {
    for (let port = startPort; port <= endPort; port++) {
      if (!allocatedPorts.has(port)) {
        allocatedPorts.add(port);
        return port;
      }
    }
    return null;
  }

  /**
   * Release a port back to the pool
   */
  private releasePort(port: number): void {
    allocatedPorts.delete(port);
  }

  /**
   * Spawn an executor container for a test run with VNC streaming
   */
  async spawnExecutorContainer(runId: string): Promise<{
    success: boolean;
    containerId?: string;
    vncPort?: number;
    websockifyPort?: number;
    error?: string;
  }> {
    await this.initialize();

    if (!this.isAvailable || !this.docker) {
      return { success: false, error: 'Docker not available' };
    }

    // Allocate ports
    const vncPort = this.allocatePort(VNC_PORT_START, VNC_PORT_END);
    if (!vncPort) {
      return { success: false, error: 'No available VNC ports' };
    }

    const websockifyPort = WEBSOCKIFY_PORT_START + (vncPort - VNC_PORT_START);

    try {
      // Create container
      const container = await this.docker.createContainer({
        Image: EXECUTOR_IMAGE,
        name: `executor-${runId}`,
        Env: [
          `RUN_ID=${runId}`,
          'MODE=vnc',
          `VNC_PORT=5900`,
          `WEBSOCKIFY_PORT=6080`,
          `DATABASE_URL=${process.env.DATABASE_URL}`,
          `REDIS_HOST=${process.env.REDIS_HOST || 'redis'}`,
          `REDIS_PORT=${process.env.REDIS_PORT || '6379'}`,
          `MINIO_ENDPOINT=${process.env.MINIO_ENDPOINT || 'minio'}`,
          `MINIO_PORT=${process.env.MINIO_PORT || '9000'}`,
          `MINIO_ACCESS_KEY=${process.env.MINIO_ACCESS_KEY || 'minioadmin'}`,
          `MINIO_SECRET_KEY=${process.env.MINIO_SECRET_KEY || 'minioadmin123'}`,
        ],
        HostConfig: {
          PortBindings: {
            '5900/tcp': [{ HostPort: String(vncPort) }],
            '6080/tcp': [{ HostPort: String(websockifyPort) }],
          },
          NetworkMode: NETWORK_NAME,
          ShmSize: 2 * 1024 * 1024 * 1024, // 2GB shared memory for Chrome
          AutoRemove: true, // Remove container when stopped
        },
        Labels: {
          'web3-test': 'executor',
          'run-id': runId,
        },
      });

      // Start container
      await container.start();

      const containerId = container.id;

      // Update run record with container info
      await prisma.testRun.update({
        where: { id: runId },
        data: {
          containerId,
          vncPort: websockifyPort, // Store websockify port for client connection
        },
      });

      console.log(`[ContainerService] Spawned container ${containerId.slice(0, 12)} for run ${runId} (VNC: ${vncPort}, WS: ${websockifyPort})`);

      return {
        success: true,
        containerId,
        vncPort,
        websockifyPort,
      };
    } catch (error) {
      // Release allocated ports on failure
      this.releasePort(vncPort);

      const message = error instanceof Error ? error.message : 'Failed to spawn container';
      console.error('[ContainerService] Error spawning container:', message);
      return { success: false, error: message };
    }
  }

  /**
   * Stop and remove an executor container
   */
  async stopContainer(containerId: string): Promise<boolean> {
    await this.initialize();

    if (!this.isAvailable || !this.docker) {
      return false;
    }

    try {
      const container = this.docker.getContainer(containerId);

      // Get container info to release port
      const info = await container.inspect();
      const portBindings = info.HostConfig?.PortBindings?.['5900/tcp'];
      if (portBindings && portBindings[0]?.HostPort) {
        this.releasePort(parseInt(portBindings[0].HostPort, 10));
      }

      // Stop container (will auto-remove due to AutoRemove flag)
      await container.stop();

      console.log(`[ContainerService] Stopped container ${containerId.slice(0, 12)}`);
      return true;
    } catch (error) {
      // Container might already be stopped/removed
      console.warn('[ContainerService] Error stopping container:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  /**
   * Get container status
   */
  async getContainerStatus(containerId: string): Promise<{
    running: boolean;
    status?: string;
    startedAt?: string;
  }> {
    await this.initialize();

    if (!this.isAvailable || !this.docker) {
      return { running: false };
    }

    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();

      return {
        running: info.State?.Running || false,
        status: info.State?.Status,
        startedAt: info.State?.StartedAt,
      };
    } catch (error) {
      return { running: false };
    }
  }

  /**
   * List all executor containers
   */
  async listExecutorContainers(): Promise<Array<{
    id: string;
    runId: string;
    status: string;
    created: string;
  }>> {
    await this.initialize();

    if (!this.isAvailable || !this.docker) {
      return [];
    }

    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: ['web3-test=executor'],
        },
      });

      return containers.map((c) => ({
        id: c.Id.slice(0, 12),
        runId: c.Labels?.['run-id'] || 'unknown',
        status: c.State || 'unknown',
        created: new Date(c.Created * 1000).toISOString(),
      }));
    } catch (error) {
      console.error('[ContainerService] Error listing containers:', error);
      return [];
    }
  }

  /**
   * Clean up old/orphaned containers
   */
  async cleanupContainers(maxAgeMinutes = 60): Promise<number> {
    await this.initialize();

    if (!this.isAvailable || !this.docker) {
      return 0;
    }

    let cleaned = 0;
    const cutoff = Date.now() - maxAgeMinutes * 60 * 1000;

    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: ['web3-test=executor'],
        },
      });

      for (const c of containers) {
        if (c.Created * 1000 < cutoff) {
          try {
            const container = this.docker.getContainer(c.Id);
            await container.stop().catch(() => {}); // Ignore if already stopped
            await container.remove({ force: true });
            cleaned++;
          } catch {
            // Ignore individual cleanup errors
          }
        }
      }

      if (cleaned > 0) {
        console.log(`[ContainerService] Cleaned up ${cleaned} old containers`);
      }

      return cleaned;
    } catch (error) {
      console.error('[ContainerService] Error during cleanup:', error);
      return cleaned;
    }
  }

  /**
   * Check if Docker is available
   */
  async isDockerAvailable(): Promise<boolean> {
    await this.initialize();
    return this.isAvailable;
  }
}

export const containerService = new ContainerService();
