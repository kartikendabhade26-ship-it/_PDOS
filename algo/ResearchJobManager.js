/**
 * algo/ResearchJobManager.js
 * Manages the background execution queue of research tasks, scheduling, prioritizing,
 * and tracking job progress sequentially in worker threads.
 */

const EventEmitter = require('events');
const { Worker } = require('worker_threads');
const path = require('path');
const { getDB } = require('./db');
const logger = require('./logger');
const manifest = require('./EngineManifest');

class ResearchJobManager extends EventEmitter {
  constructor() {
    super();
    this.activeWorker = null;
    this.activeJobId = null;
  }

  /**
   * Schedule a new job in the database queue.
   */
  addJob({ workspaceId, symbol, taskType, config = {}, priority = 0, parentJob = null }) {
    const db = getDB();
    const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    db.prepare(`
      INSERT INTO research_jobs (job_id, workspace_id, symbol, task_type, status, priority, config, versions, parent_job)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      workspaceId,
      symbol,
      taskType,
      'pending',
      priority,
      JSON.stringify(config),
      JSON.stringify(manifest),
      parentJob
    );

    logger.info('JOB_MANAGER', `Enqueued new job: ${jobId} (Type: ${taskType}, Priority: ${priority})`);
    
    // Asynchronously trigger queue processing
    process.nextTick(() => this.processQueue());
    return jobId;
  }

  /**
   * Fetch current job metadata from database.
   */
  getJob(jobId) {
    const db = getDB();
    const job = db.prepare(`SELECT * FROM research_jobs WHERE job_id = ?`).get(jobId);
    if (job) {
      try { job.config = JSON.parse(job.config || '{}'); } catch(e) {}
      try { job.versions = JSON.parse(job.versions || '{}'); } catch(e) {}
      try { job.results = JSON.parse(job.results || '{}'); } catch(e) {}
    }
    return job;
  }

  /**
   * Request a job cancellation.
   */
  cancelJob(jobId) {
    const db = getDB();
    db.prepare(`UPDATE research_jobs SET cancel_requested = 1 WHERE job_id = ?`).run(jobId);
    logger.info('JOB_MANAGER', `Cancellation requested for job: ${jobId}`);

    if (this.activeJobId === jobId && this.activeWorker) {
      logger.warn('JOB_MANAGER', `Terminating active worker thread for cancelled job: ${jobId}`);
      this.activeWorker.terminate().then(() => {
        this.handleJobFinish(jobId, 'cancelled', { error: 'Job cancelled by user request' });
      });
    }
  }

  /**
   * Sequential queue loop processor.
   */
  processQueue() {
    if (this.activeWorker) {
      // Worker already running, wait for it to finish.
      return;
    }

    const db = getDB();
    // Retrieve next pending job prioritized
    const nextJob = db.prepare(`
      SELECT * FROM research_jobs 
      WHERE status = 'pending' 
      ORDER BY priority DESC, created_at ASC 
      LIMIT 1
    `).get();

    if (!nextJob) {
      return;
    }

    const jobId = nextJob.job_id;
    this.activeJobId = jobId;
    const attempts = (nextJob.attempts || 0) + 1;

    // Transition state to running
    db.prepare(`
      UPDATE research_jobs 
      SET status = 'running', attempts = ?, started_at = CURRENT_TIMESTAMP 
      WHERE job_id = ?
    `).run(attempts, jobId);

    logger.info('JOB_MANAGER', `Starting execution of job: ${jobId} (Attempt: ${attempts})`);
    this.emit('job_started', { jobId });

    // Spawn background worker thread
    const workerPath = path.join(__dirname, 'jobWorker.js');
    const worker = new Worker(workerPath, {
      workerData: {
        jobId,
        workspaceId: nextJob.workspace_id,
        symbol: nextJob.symbol,
        taskType: nextJob.task_type,
        config: JSON.parse(nextJob.config || '{}')
      }
    });

    this.activeWorker = worker;

    worker.on('message', (msg) => {
      if (msg.type === 'progress') {
        const progressPct = parseFloat(msg.progress) || 0.0;
        const results = msg.results || {};
        
        try {
          db.prepare(`
            UPDATE research_jobs 
            SET progress_pct = ?, results = ? 
            WHERE job_id = ?
          `).run(progressPct, JSON.stringify(results), jobId);
        } catch (dbErr) {
          logger.warn('JOB_MANAGER', `Failed to write progress to DB for ${jobId} (busy/locked) - proceeding`, dbErr);
        }

        this.emit('job_progress', { jobId, progressPct, results });
      } else if (msg.type === 'complete') {
        this.handleJobFinish(jobId, 'completed', { results: msg.results });
      } else if (msg.type === 'error') {
        this.handleJobFinish(jobId, 'failed', { error: msg.error });
      }
    });

    worker.on('error', (err) => {
      logger.error('JOB_MANAGER', `Worker thread crash on job: ${jobId}`, err);
      this.handleJobFinish(jobId, 'failed', { error: err.message });
    });

    worker.on('exit', (code) => {
      if (code !== 0 && this.activeJobId === jobId) {
        logger.warn('JOB_MANAGER', `Worker thread exited with non-zero exit code: ${code}`);
        this.handleJobFinish(jobId, 'failed', { error: `Worker exited with code ${code}` });
      }
    });
  }

  /**
   * Conclude job and update DB status.
   */
  handleJobFinish(jobId, status, { results = null, error = null } = {}, retries = 5) {
    if (this.activeJobId === jobId) {
      this.activeWorker = null;
      this.activeJobId = null;
    }

    const db = getDB();
    const finalResults = results ? JSON.stringify(results) : null;
    const errorMsg = error || null;

    try {
      db.prepare(`
        UPDATE research_jobs 
        SET status = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP, progress_pct = 100.0
        ${results ? ', results = ?' : ''}
        WHERE job_id = ?
      `).run(...[status, errorMsg, ...(results ? [finalResults] : []), jobId]);
    } catch (dbErr) {
      if (retries > 0) {
        logger.warn('JOB_MANAGER', `Database locked finalizing job ${jobId} - retrying in 200ms... (Remaining: ${retries})`, dbErr);
        setTimeout(() => this.handleJobFinish(jobId, status, { results, error }, retries - 1), 200);
        return;
      } else {
        logger.error('JOB_MANAGER', `Database lock persisted finalizing job ${jobId} - status not saved`, dbErr);
      }
    }

    logger.info('JOB_MANAGER', `Job ${jobId} finished with status: ${status}`);
    this.emit(status === 'completed' ? 'job_completed' : status === 'cancelled' ? 'job_cancelled' : 'job_failed', { jobId, error: errorMsg });

    // Trigger next job sequentially
    process.nextTick(() => this.processQueue());
  }
}

// Singleton instance
const manager = new ResearchJobManager();
module.exports = manager;
