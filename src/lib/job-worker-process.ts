import { getNextJob, completeJob, failJob, Job } from './job-queue';
import { processPdfExportJob } from './job-workers';

const QUEUE_NAME = 'pdf-export';
const POLL_INTERVAL = 2000; // Poll every 2 seconds
const MAX_CONCURRENT_JOBS = 1; // Process one export at a time

let isRunning = false;
let activeJobs = new Set<string>();

/**
 * Process a single job
 */
async function processJob(job: Job): Promise<void> {
  activeJobs.add(job.id);
  
  try {
    console.log(`[Worker] Processing job ${job.id} (type: ${job.job_type})`);
    
    // Route to appropriate handler based on job type
    switch (job.job_type) {
      case 'pdf-export':
        await processPdfExportJob(job);
        await completeJob(job.id, { success: true });
        console.log(`[Worker] Job ${job.id} completed successfully`);
        break;
      
      default:
        throw new Error(`Unknown job type: ${job.job_type}`);
    }
  } catch (error) {
    console.error(`[Worker] Job ${job.id} failed:`, error);
    const shouldRetry = job.attempts < job.max_attempts;
    await failJob(job.id, error instanceof Error ? error : new Error(String(error)), shouldRetry);
    
    if (!shouldRetry) {
      console.error(`[Worker] Job ${job.id} failed permanently after ${job.max_attempts} attempts`);
    }
  } finally {
    activeJobs.delete(job.id);
  }
}

/**
 * Worker main loop
 */
async function workerLoop(): Promise<void> {
  if (isRunning) {
    return;
  }

  isRunning = true;
  console.log(`[Worker] Starting worker for queue: ${QUEUE_NAME}`);

  while (isRunning) {
    try {
      // Only process if we're not at max concurrent jobs
      if (activeJobs.size < MAX_CONCURRENT_JOBS) {
        const job = await getNextJob(QUEUE_NAME);
        
        if (job) {
          // Process job asynchronously (don't await)
          processJob(job).catch(error => {
            console.error(`[Worker] Unhandled error processing job ${job.id}:`, error);
          });
        }
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    } catch (error) {
      console.error('[Worker] Error in worker loop:', error);
      // Wait a bit longer on error before retrying
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL * 2));
    }
  }

  console.log('[Worker] Worker stopped');
}

/**
 * Start the worker
 */
export function startWorker(): void {
  if (isRunning) {
    console.log('[Worker] Worker is already running');
    return;
  }

  workerLoop().catch(error => {
    console.error('[Worker] Fatal error in worker:', error);
    process.exit(1);
  });
}

/**
 * Stop the worker
 */
export function stopWorker(): Promise<void> {
  console.log('[Worker] Stopping worker...');
  isRunning = false;
  
  // Wait for active jobs to complete (with timeout)
  const maxWaitTime = 60000; // 60 seconds
  const startTime = Date.now();
  
  return new Promise<void>((resolve) => {
    const checkInterval = setInterval(() => {
      if (activeJobs.size === 0 || Date.now() - startTime > maxWaitTime) {
        clearInterval(checkInterval);
        console.log('[Worker] Worker stopped');
        resolve();
      }
    }, 1000);
  });
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Worker] Received SIGTERM, shutting down gracefully...');
  await stopWorker();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Worker] Received SIGINT, shutting down gracefully...');
  await stopWorker();
  process.exit(0);
});

// Start worker if this file is run directly
if (require.main === module) {
  startWorker();
}















