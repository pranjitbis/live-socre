const { v4: uuidv4 } = require('uuid');
const logger = require('../logger');
const cache = require('../cache');

class QueueService {
  constructor() {
    this.runningJobs = new Map();
    this.jobHistory = new Map();
    this.maxConcurrent = 5;
  }

  async addJob(type, data) {
    const jobId = uuidv4();
    const job = {
      id: jobId,
      type,
      data,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (this.isJobRunning(type)) {
      logger.warn(`Duplicate job of type ${type} detected, skipping...`);
      return jobId;
    }

    await cache.set(`job:${jobId}`, job, 3600);

    this.runningJobs.set(jobId, {
      ...job,
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    logger.info(`Job ${jobId} of type ${type} started`);
    return jobId;
  }

  async completeJob(jobId) {
    const job = this.runningJobs.get(jobId);
    if (job) {
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      this.runningJobs.delete(jobId);
      this.jobHistory.set(jobId, job);
      await cache.set(`job:${jobId}`, job, 86400);
      logger.info(`Job ${jobId} completed`);
    }
  }

  async failJob(jobId, error) {
    const job = this.runningJobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.error = error.message || 'Unknown error';
      job.failedAt = new Date().toISOString();
      this.runningJobs.delete(jobId);
      this.jobHistory.set(jobId, job);
      await cache.set(`job:${jobId}`, job, 86400);
      logger.error(`Job ${jobId} failed:`, error);
    }
  }

  isJobRunning(type) {
    for (const [id, job] of this.runningJobs) {
      if (job.type === type) {
        return true;
      }
    }
    return false;
  }

  getRunningJobs() {
    return Array.from(this.runningJobs.values());
  }

  getJobHistory() {
    return Array.from(this.jobHistory.values());
  }

  async getJob(jobId) {
    if (this.runningJobs.has(jobId)) {
      return this.runningJobs.get(jobId);
    }
    if (this.jobHistory.has(jobId)) {
      return this.jobHistory.get(jobId);
    }
    return await cache.get(`job:${jobId}`);
  }

  async cleanupOldJobs() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    
    for (const [id, job] of this.jobHistory) {
      const createdAt = new Date(job.createdAt).getTime();
      if (now - createdAt > maxAge) {
        this.jobHistory.delete(id);
        await cache.del(`job:${id}`);
      }
    }
  }

  getQueueStats() {
    return {
      running: this.runningJobs.size,
      history: this.jobHistory.size,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

module.exports = new QueueService();