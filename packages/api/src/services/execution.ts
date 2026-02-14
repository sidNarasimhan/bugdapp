import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { prisma } from '../db.js';

// Redis connection options
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

// Queue name for test runs
const QUEUE_NAME = 'test-runs';

interface TestRunJobData {
  runId: string;
  streamingMode?: 'NONE' | 'VNC' | 'VIDEO';
}

/**
 * Execution service for managing test runs via BullMQ
 */
class ExecutionService {
  private queue: Queue<TestRunJobData> | null = null;
  private redis: Redis | null = null;
  private isQueueAvailable = false;
  private connectionChecked = false;

  constructor() {
    // Don't check availability in constructor - lazy init
  }

  /**
   * Initialize Redis and BullMQ connection
   */
  private async initializeQueue(): Promise<boolean> {
    if (this.connectionChecked) {
      return this.isQueueAvailable;
    }

    this.connectionChecked = true;

    try {
      // Test Redis connection
      this.redis = new Redis({
        host: REDIS_HOST,
        port: REDIS_PORT,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 100, 3000);
        },
      });

      // Test connection with ping
      await this.redis.ping();

      // Create the queue
      this.queue = new Queue<TestRunJobData>(QUEUE_NAME, {
        connection: {
          host: REDIS_HOST,
          port: REDIS_PORT,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: {
            count: 100,
          },
          removeOnFail: {
            count: 100,
          },
        },
      });

      this.isQueueAvailable = true;
      console.log('[ExecutionService] Connected to Redis and BullMQ queue');
      return true;
    } catch (error) {
      console.warn('[ExecutionService] Redis not available, queue disabled:', error instanceof Error ? error.message : error);
      this.isQueueAvailable = false;
      return false;
    }
  }

  /**
   * Queue a test run for execution
   */
  async queueRun(
    runId: string,
    options: { streamingMode?: 'NONE' | 'VNC' | 'VIDEO' } = {}
  ): Promise<{ queued: boolean; message: string; jobId?: string }> {
    // Try to initialize queue if not already done
    await this.initializeQueue();

    if (!this.isQueueAvailable || !this.queue) {
      // Update run status to indicate queue not available
      await prisma.testRun.update({
        where: { id: runId },
        data: {
          status: 'PENDING',
          streamingMode: options.streamingMode || 'NONE',
        },
      });

      return {
        queued: false,
        message: 'Queue not available. Run is pending manual execution. Start the executor worker to process jobs.',
      };
    }

    // Update run with streaming mode
    await prisma.testRun.update({
      where: { id: runId },
      data: {
        status: 'PENDING',
        streamingMode: options.streamingMode || 'NONE',
      },
    });

    // Add job to queue
    const job = await this.queue.add(
      'execute',
      {
        runId,
        streamingMode: options.streamingMode || 'NONE',
      },
      {
        jobId: `run-${runId}`,
        priority: options.streamingMode === 'VNC' ? 1 : 2, // VNC jobs get higher priority
      }
    );

    console.log(`[ExecutionService] Queued run ${runId} as job ${job.id}`);

    return {
      queued: true,
      message: 'Run queued for execution',
      jobId: job.id,
    };
  }

  /**
   * Get the status of the execution queue
   */
  async getQueueStatus(): Promise<{
    available: boolean;
    pendingJobs: number;
    activeJobs: number;
    completedJobs: number;
    failedJobs: number;
  }> {
    await this.initializeQueue();

    if (!this.isQueueAvailable || !this.queue) {
      return {
        available: false,
        pendingJobs: 0,
        activeJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
      };
    }

    try {
      const [waiting, active, completed, failed] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
      ]);

      return {
        available: true,
        pendingJobs: waiting,
        activeJobs: active,
        completedJobs: completed,
        failedJobs: failed,
      };
    } catch (error) {
      console.error('[ExecutionService] Error getting queue status:', error);
      return {
        available: false,
        pendingJobs: 0,
        activeJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
      };
    }
  }

  /**
   * Get job details by run ID
   */
  async getJobStatus(runId: string): Promise<{
    state: string;
    progress: number;
    attemptsMade: number;
    failedReason?: string;
  } | null> {
    await this.initializeQueue();

    if (!this.queue) {
      return null;
    }

    try {
      const job = await this.queue.getJob(`run-${runId}`);
      if (!job) {
        return null;
      }

      const state = await job.getState();
      return {
        state,
        progress: typeof job.progress === 'number' ? job.progress : 0,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
      };
    } catch (error) {
      console.error('[ExecutionService] Error getting job status:', error);
      return null;
    }
  }

  /**
   * Cancel a pending or running job
   */
  async cancelRun(runId: string): Promise<boolean> {
    await this.initializeQueue();

    if (!this.queue) {
      return false;
    }

    try {
      // Try all possible job ID formats (spec runs, agent runs)
      const jobIds = [`run-${runId}`, `agent-${runId}`];
      let found = false;

      for (const jobId of jobIds) {
        const job = await this.queue.getJob(jobId);
        if (!job) continue;

        found = true;
        const state = await job.getState();

        if (state === 'waiting' || state === 'delayed') {
          await job.remove();
          console.log(`[ExecutionService] Removed ${state} job ${jobId}`);
        } else if (state === 'active') {
          // DB is already marked CANCELLED by the route handler.
          // The worker polls DB status and will abort the running process.
          console.log(`[ExecutionService] Active job ${jobId} — worker will detect CANCELLED status`);
        }
      }

      return found;
    } catch (error) {
      console.error('[ExecutionService] Error canceling job:', error);
      return false;
    }
  }

  /**
   * Queue a suite run for execution
   */
  async queueSuiteRun(
    suiteRunId: string,
    options: { streamingMode?: 'NONE' | 'VNC' | 'VIDEO' } = {}
  ): Promise<{ queued: boolean; message: string; jobId?: string }> {
    await this.initializeQueue();

    if (!this.isQueueAvailable || !this.queue) {
      return {
        queued: false,
        message: 'Queue not available. Suite run is pending manual execution. Start the executor worker to process jobs.',
      };
    }

    const job = await this.queue.add(
      'execute-suite',
      {
        runId: suiteRunId,
        streamingMode: options.streamingMode || 'NONE',
      },
      {
        jobId: `suite-${suiteRunId}`,
        priority: 1,
      }
    );

    console.log(`[ExecutionService] Queued suite run ${suiteRunId} as job ${job.id}`);

    return {
      queued: true,
      message: 'Suite run queued for execution',
      jobId: job.id,
    };
  }

  /**
   * Queue an agent-mode test run for execution
   */
  async queueAgentRun(
    runId: string,
    options: { streamingMode?: 'NONE' | 'VNC' | 'VIDEO' } = {}
  ): Promise<{ queued: boolean; message: string; jobId?: string }> {
    await this.initializeQueue();

    if (!this.isQueueAvailable || !this.queue) {
      await prisma.testRun.update({
        where: { id: runId },
        data: {
          status: 'PENDING',
          streamingMode: options.streamingMode || 'NONE',
        },
      });

      return {
        queued: false,
        message: 'Queue not available. Agent run is pending manual execution.',
      };
    }

    await prisma.testRun.update({
      where: { id: runId },
      data: {
        status: 'PENDING',
        streamingMode: options.streamingMode || 'NONE',
      },
    });

    const job = await this.queue.add(
      'execute-agent',
      {
        runId,
        streamingMode: options.streamingMode || 'NONE',
      },
      {
        jobId: `agent-${runId}`,
        priority: options.streamingMode === 'VNC' ? 1 : 2,
      }
    );

    console.log(`[ExecutionService] Queued agent run ${runId} as job ${job.id}`);

    return {
      queued: true,
      message: 'Agent run queued for execution',
      jobId: job.id,
    };
  }

  /**
   * Execute a run directly (for testing without queue)
   */
  async executeDirectly(runId: string): Promise<void> {
    const run = await prisma.testRun.findUnique({
      where: { id: runId },
      include: { testSpec: true },
    });

    if (!run) {
      throw new Error('Run not found');
    }

    // Mark as running
    await prisma.testRun.update({
      where: { id: runId },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    // Note: Direct execution is handled by importing and calling the executor
    // This is primarily for local development/testing
    console.log(`[ExecutionService] Direct execution requested for run ${runId}`);
    console.log('[ExecutionService] Use the executor worker for actual test execution');
  }

  /**
   * Clean up resources
   */
  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
    if (this.redis) {
      this.redis.disconnect();
    }
  }
}

export const executionService = new ExecutionService();
