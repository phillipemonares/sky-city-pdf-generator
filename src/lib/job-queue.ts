import { pool } from './db';
import { randomUUID } from 'crypto';
import mysql from 'mysql2/promise';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface Job<T = any> {
  id: string;
  queue_name: string;
  job_type: string;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  payload: T;
  result?: any;
  error_message?: string | null;
  run_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface JobOptions {
  queue_name?: string;
  priority?: number;
  max_attempts?: number;
  delay?: number; // Delay in milliseconds
  run_at?: Date;
}

/**
 * Add a job to the queue
 */
export async function addJob<T = any>(
  jobType: string,
  payload: T,
  options: JobOptions = {}
): Promise<string> {
  const connection = await pool.getConnection();
  
  try {
    const jobId = randomUUID();
    const queueName = options.queue_name || 'default';
    const priority = options.priority || 0;
    const maxAttempts = options.max_attempts || 3;
    
    // Calculate run_at time
    let runAt: Date | null = options.run_at || null;
    if (options.delay && !runAt) {
      runAt = new Date(Date.now() + options.delay);
    }

    await connection.execute(
      `INSERT INTO jobs (id, queue_name, job_type, status, priority, max_attempts, payload, run_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [
        jobId,
        queueName,
        jobType,
        priority,
        maxAttempts,
        JSON.stringify(payload),
        runAt,
      ]
    );

    return jobId;
  } finally {
    connection.release();
  }
}

/**
 * Get the next job from the queue (for processing)
 */
export async function getNextJob(queueName: string = 'default'): Promise<Job | null> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    // Find and lock the next available job
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT * FROM jobs
       WHERE queue_name = ? 
         AND status = 'pending'
         AND (run_at IS NULL OR run_at <= NOW())
       ORDER BY priority DESC, created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [queueName]
    );

    if (rows.length === 0) {
      await connection.commit();
      return null;
    }

    const row = rows[0];
    const job: Job = {
      id: row.id,
      queue_name: row.queue_name,
      job_type: row.job_type,
      status: row.status,
      priority: row.priority,
      attempts: row.attempts,
      max_attempts: row.max_attempts,
      payload: JSON.parse(row.payload),
      result: row.result ? JSON.parse(row.result) : undefined,
      error_message: row.error_message,
      run_at: row.run_at ? new Date(row.run_at) : null,
      started_at: row.started_at ? new Date(row.started_at) : null,
      completed_at: row.completed_at ? new Date(row.completed_at) : null,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };

    // Mark job as processing
    await connection.execute(
      `UPDATE jobs 
       SET status = 'processing', 
           attempts = attempts + 1,
           started_at = NOW()
       WHERE id = ?`,
      [job.id]
    );

    await connection.commit();
    return job;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Mark a job as completed
 */
export async function completeJob(jobId: string, result?: any): Promise<void> {
  const connection = await pool.getConnection();
  
  try {
    await connection.execute(
      `UPDATE jobs 
       SET status = 'completed',
           result = ?,
           completed_at = NOW()
       WHERE id = ?`,
      [result ? JSON.stringify(result) : null, jobId]
    );
  } finally {
    connection.release();
  }
}

/**
 * Mark a job as failed
 */
export async function failJob(jobId: string, error: Error | string, retry: boolean = true): Promise<void> {
  const connection = await pool.getConnection();
  
  try {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Get current job state
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT attempts, max_attempts FROM jobs WHERE id = ?`,
      [jobId]
    );

    if (rows.length === 0) {
      return;
    }

    const attempts = rows[0].attempts;
    const maxAttempts = rows[0].max_attempts;

    // If we can retry and haven't exceeded max attempts, mark as pending again
    if (retry && attempts < maxAttempts) {
      // Exponential backoff: wait 2^attempts seconds before retry
      const delaySeconds = Math.pow(2, attempts);
      const runAt = new Date(Date.now() + delaySeconds * 1000);
      
      await connection.execute(
        `UPDATE jobs 
         SET status = 'pending',
             error_message = ?,
             run_at = ?,
             started_at = NULL
         WHERE id = ?`,
        [errorMessage, runAt, jobId]
      );
    } else {
      // Mark as failed permanently
      await connection.execute(
        `UPDATE jobs 
         SET status = 'failed',
             error_message = ?,
             completed_at = NOW()
         WHERE id = ?`,
        [errorMessage, jobId]
      );
    }
  } finally {
    connection.release();
  }
}

/**
 * Get job by ID
 */
export async function getJob(jobId: string): Promise<Job | null> {
  const connection = await pool.getConnection();
  
  try {
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT * FROM jobs WHERE id = ?`,
      [jobId]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      queue_name: row.queue_name,
      job_type: row.job_type,
      status: row.status,
      priority: row.priority,
      attempts: row.attempts,
      max_attempts: row.max_attempts,
      payload: JSON.parse(row.payload),
      result: row.result ? JSON.parse(row.result) : undefined,
      error_message: row.error_message,
      run_at: row.run_at ? new Date(row.run_at) : null,
      started_at: row.started_at ? new Date(row.started_at) : null,
      completed_at: row.completed_at ? new Date(row.completed_at) : null,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  } finally {
    connection.release();
  }
}

/**
 * Cancel a job
 */
export async function cancelJob(jobId: string): Promise<void> {
  const connection = await pool.getConnection();
  
  try {
    await connection.execute(
      `UPDATE jobs 
       SET status = 'cancelled',
           completed_at = NOW()
       WHERE id = ? AND status IN ('pending', 'processing')`,
      [jobId]
    );
  } finally {
    connection.release();
  }
}

/**
 * Get job statistics for a queue
 */
export async function getQueueStats(queueName: string = 'default'): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}> {
  const connection = await pool.getConnection();
  
  try {
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT status, COUNT(*) as count
       FROM jobs
       WHERE queue_name = ?
       GROUP BY status`,
      [queueName]
    );

    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };

    for (const row of rows) {
      const status = row.status as JobStatus;
      if (status in stats) {
        stats[status] = row.count;
      }
    }

    return stats;
  } finally {
    connection.release();
  }
}

/**
 * Clean up old completed/failed jobs (optional maintenance)
 */
export async function cleanupOldJobs(
  queueName: string = 'default',
  olderThanDays: number = 7
): Promise<number> {
  const connection = await pool.getConnection();
  
  try {
    const [result] = await connection.execute<mysql.ResultSetHeader>(
      `DELETE FROM jobs
       WHERE queue_name = ?
         AND status IN ('completed', 'failed')
         AND completed_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [queueName, olderThanDays]
    );

    return result.affectedRows;
  } finally {
    connection.release();
  }
}
