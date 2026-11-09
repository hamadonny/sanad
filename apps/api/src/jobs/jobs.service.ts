import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env.js';
import { SchedulerService } from './scheduler.service.js';

/**
 * BullMQ wiring (spec §12). One repeatable "tick" job; the worker runs with concurrency 1, and
 * every step inside the tick is idempotent, so retries and overlapping deploys are safe.
 * Disabled unless JOBS_ENABLED=true (tests and the OpenAPI script run without Redis).
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    if (!this.env.JOBS_ENABLED) return;
    // Start in the background: if Redis is down the API must still serve requests (BullMQ keeps
    // retrying the connection and the scheduler starts once Redis is reachable).
    void this.start().catch((e: unknown) =>
      this.logger.error(`scheduler not started: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  private async start(): Promise<void> {
    // In native ESM BullMQ needs ready-made ioredis clients; workers need maxRetriesPerRequest: null.
    let warned = false;
    const connection = () => {
      const r = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
      r.on('error', (e: Error) => {
        if (warned) return;
        warned = true;
        this.logger.warn(
          `Redis unreachable (${e.message}) — jobs wait for it. Try "pnpm infra:up".`,
        );
      });
      return r;
    };
    this.queue = new Queue('sanad', { connection: connection() });
    await this.queue.upsertJobScheduler(
      'tick',
      { every: this.env.JOBS_TICK_SECONDS * 1000 },
      { name: 'tick', opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );
    this.worker = new Worker(
      'sanad',
      async () => {
        const r = await this.scheduler.tick();
        if (r.errors.length > 0) this.logger.warn(`tick finished with ${r.errors.length} error(s)`);
        return { ...r };
      },
      { connection: connection(), concurrency: 1 },
    );
    this.worker.on('failed', (_job, err) => this.logger.error(`tick failed: ${err.message}`));
    this.logger.log(`scheduler tick every ${this.env.JOBS_TICK_SECONDS}s`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
