const cron = require('node-cron');
const logger = require('../logger');
const { broadcastToChannel } = require('../websocket');
const { scraperService } = require('../services/scraperService');
const { cache } = require('../cache');

let cronJobs = [];

async function startCronJobs() {
  logger.info('Starting cron jobs...');

  const liveJob = cron.schedule('*/5 * * * * *', async () => {
    try {
      const data = await scraperService.scrapeLive();
      if (data) {
        await cache.set('live_matches', data, 5);
        broadcastToChannel('live_score', data);
      }
    } catch (error) {
      logger.error('Live score cron job error:', error);
    }
  });

  const commentaryJob = cron.schedule('*/10 * * * * *', async () => {
    try {
      const data = await scraperService.scrapeCommentary();
      if (data) {
        await cache.set('commentary', data, 3);
        broadcastToChannel('commentary', data);
      }
    } catch (error) {
      logger.error('Commentary cron job error:', error);
    }
  });

  const fixturesJob = cron.schedule('*/60 * * * * *', async () => {
    try {
      const data = await scraperService.scrapeFixtures();
      if (data) {
        await cache.set('fixtures', data, 60);
        broadcastToChannel('fixtures', data);
      }
    } catch (error) {
      logger.error('Fixtures cron job error:', error);
    }
  });

  const pointsJob = cron.schedule('*/30 * * * *', async () => {
    try {
      const data = await scraperService.scrapePoints();
      if (data) {
        await cache.set('points_table', data, 1800);
        broadcastToChannel('points_table', data);
      }
    } catch (error) {
      logger.error('Points table cron job error:', error);
    }
  });

  const newsJob = cron.schedule('*/30 * * * *', async () => {
    try {
      const data = await scraperService.scrapeNews();
      if (data) {
        await cache.set('news', data, 1800);
        broadcastToChannel('news', data);
      }
    } catch (error) {
      logger.error('News cron job error:', error);
    }
  });

  cronJobs = [liveJob, commentaryJob, fixturesJob, pointsJob, newsJob];

  logger.info(`✅ ${cronJobs.length} cron jobs started successfully`);
  return cronJobs;
}

async function stopCronJobs() {
  logger.info('Stopping cron jobs...');
  cronJobs.forEach((job) => job.stop());
  cronJobs = [];
  logger.info('✅ Cron jobs stopped');
}

function getCronStatus() {
  return {
    total: cronJobs.length,
    running: cronJobs.filter((job) => job.isRunning()).length,
  };
}

module.exports = {
  startCronJobs,
  stopCronJobs,
  getCronStatus,
};
