// src/cron/liveCron.js
const cache = require('../cache');
const logger = require('../logger');
const queueService = require('../services/queueService');
const config = require('../config');
const CricbuzzHomepageScraper = require('../scraper/cricbuzzHomepage');

const scraper = new CricbuzzHomepageScraper();

const scheduleLiveScraper = async () => {
  const jobId = `live_${Date.now()}`;
  try {
    if (queueService.isJobRunning('live')) {
      logger.debug('Live scraper job already running, skipping...');
      return;
    }

    await queueService.addJob('live', {
      type: 'live',
      timestamp: new Date().toISOString(),
    });

    const result = await scraper.scrape();

    if (result && result.matches && result.matches.length > 0) {
      // Cache all matches
      await cache.set('matches', result.matches, 300);

      // Filter live matches
      const liveMatches = result.matches.filter((m) => m.status === 'LIVE');
      if (liveMatches.length > 0) {
        await cache.set('live', liveMatches, config.cache.ttl.live || 5);

        const websocket = require('../websocket');
        websocket.broadcast('live_score', {
          data: liveMatches,
          source: 'cricbuzz',
          timestamp: new Date().toISOString(),
        });
      }

      // Filter upcoming matches for fixtures
      const upcomingMatches = result.matches.filter((m) => m.status === 'UPCOMING');
      if (upcomingMatches.length > 0) {
        await cache.set('fixtures', upcomingMatches, config.cache.ttl.fixtures || 60);
      }

      logger.info(
        `Scraped ${result.matches.length} matches from Cricbuzz (${liveMatches.length} live, ${upcomingMatches.length} upcoming)`
      );
    } else {
      logger.info('No matches found on Cricbuzz');
    }

    await queueService.completeJob(jobId);
  } catch (error) {
    logger.error('Live scraper scheduling failed:', error);
    try {
      await queueService.failJob(jobId, error);
    } catch (e) {}
  }
};

const scheduleCommentaryScraper = async () => {
  logger.debug('Commentary scraper - using live data from main scraper');
};

const scheduleFixturesScraper = async () => {
  const jobId = `fixtures_${Date.now()}`;
  try {
    if (queueService.isJobRunning('fixtures')) {
      logger.debug('Fixtures scraper job already running, skipping...');
      return;
    }

    await queueService.addJob('fixtures', {
      type: 'fixtures',
      timestamp: new Date().toISOString(),
    });

    const result = await scraper.scrape();

    if (result && result.matches && result.matches.length > 0) {
      const upcomingMatches = result.matches.filter((m) => m.status === 'UPCOMING');
      if (upcomingMatches.length > 0) {
        await cache.set('fixtures', upcomingMatches, config.cache.ttl.fixtures || 60);

        const websocket = require('../websocket');
        websocket.broadcast('fixtures', {
          data: upcomingMatches,
          source: 'cricbuzz',
          timestamp: new Date().toISOString(),
        });

        logger.info(`Fixtures updated: ${upcomingMatches.length} upcoming matches`);
      } else {
        logger.info('No upcoming matches found');
      }
    }

    await queueService.completeJob(jobId);
  } catch (error) {
    logger.error('Fixtures scraper scheduling failed:', error);
    try {
      await queueService.failJob(jobId, error);
    } catch (e) {}
  }
};

const schedulePointsScraper = async () => {
  const jobId = `points_${Date.now()}`;
  try {
    if (queueService.isJobRunning('points')) {
      logger.debug('Points scraper job already running, skipping...');
      return;
    }

    await queueService.addJob('points', {
      type: 'points',
      timestamp: new Date().toISOString(),
    });

    const axios = require('axios');
    const cheerio = require('cheerio');

    try {
      const response = await axios.get('https://www.cricbuzz.com/cricket-points-table', {
        timeout: 10000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (response.status === 200) {
        const $ = cheerio.load(response.data);
        const table = [];
        let tournament = '';

        $('h1, h2').each(function () {
          const text = $(this).text();
          if (text.includes('Points Table') || text.includes('Standings')) {
            tournament = text.trim();
          }
        });

        $('tr').each(function () {
          const cols = $(this).find('td');
          if (cols.length >= 4) {
            const team = $(cols[0]).text().trim();
            if (team && !team.includes('Team') && !team.includes('Pos')) {
              table.push({
                position: table.length + 1,
                team: team,
                played: parseInt($(cols[1]).text().trim()) || 0,
                won: parseInt($(cols[2]).text().trim()) || 0,
                lost: parseInt($(cols[3]).text().trim()) || 0,
                points:
                  parseInt(
                    $(cols[cols.length - 2])
                      .text()
                      .trim()
                  ) || 0,
                netRunRate:
                  parseFloat(
                    $(cols[cols.length - 1])
                      .text()
                      .trim()
                  ) || 0,
              });
            }
          }
        });

        const result = {
          source: 'cricbuzz',
          tournament: tournament || 'Points Table',
          standings: table,
        };

        if (table.length > 0) {
          await cache.set('points_table', result, config.cache.ttl.points || 1800);

          const websocket = require('../websocket');
          websocket.broadcast('points_table', {
            data: result,
            source: 'cricbuzz',
            timestamp: new Date().toISOString(),
          });

          logger.info(`Points table updated: ${table.length} teams`);
        } else {
          logger.info('No points table data found');
        }
      }
    } catch (error) {
      logger.error('Points table scrape failed:', error.message);
    }

    await queueService.completeJob(jobId);
  } catch (error) {
    logger.error('Points scraper scheduling failed:', error);
    try {
      await queueService.failJob(jobId, error);
    } catch (e) {}
  }
};

const scheduleNewsScraper = async () => {
  const jobId = `news_${Date.now()}`;
  try {
    if (queueService.isJobRunning('news')) {
      logger.debug('News scraper job already running, skipping...');
      return;
    }

    await queueService.addJob('news', {
      type: 'news',
      timestamp: new Date().toISOString(),
    });

    const axios = require('axios');
    const cheerio = require('cheerio');

    try {
      const response = await axios.get('https://www.cricbuzz.com/cricket-news', {
        timeout: 10000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (response.status === 200) {
        const $ = cheerio.load(response.data);
        const news = [];

        $('a[href*="/cricket-news/"]').each(function () {
          const $el = $(this);
          const title = $el.text().trim();
          const href = $el.attr('href') || '';
          if (title && title.length > 10) {
            news.push({
              id: `news_${Date.now()}_${news.length}`,
              title: title,
              url: href.startsWith('http') ? href : `https://www.cricbuzz.com${href}`,
              source: 'Cricbuzz',
            });
          }
        });

        if (news.length > 0) {
          await cache.set('news', news.slice(0, 20), config.cache.ttl.news || 1800);

          const websocket = require('../websocket');
          websocket.broadcast('news', {
            data: news.slice(0, 20),
            source: 'cricbuzz',
            timestamp: new Date().toISOString(),
          });

          logger.info(`News updated: ${news.length} articles`);
        } else {
          logger.info('No news articles found');
        }
      }
    } catch (error) {
      logger.error('News scrape failed:', error.message);
    }

    await queueService.completeJob(jobId);
  } catch (error) {
    logger.error('News scraper scheduling failed:', error);
    try {
      await queueService.failJob(jobId, error);
    } catch (e) {}
  }
};

module.exports = {
  scheduleLiveScraper,
  scheduleCommentaryScraper,
  scheduleFixturesScraper,
  schedulePointsScraper,
  scheduleNewsScraper,
};
