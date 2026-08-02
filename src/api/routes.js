// src/api/routes.js
const express = require('express');
const router = express.Router();
const { scraperService } = require('../services/scraperService');
const browserManager = require('../scraper/browser');
const logger = require('../logger');

// ============================================================
// HEALTH CHECK ENDPOINTS
// ============================================================

/**
 * @route GET /health
 * @desc Basic health check
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'cricket-scraper-api',
    uptime: process.uptime(),
    requestId: req.requestId,
  });
});

/**
 * @route GET /health/browser
 * @desc Browser health check
 */
router.get('/health/browser', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    const isHealthy = await browserManager.healthCheck();
    const stats = browserManager.getStats ? browserManager.getStats() : {};

    res.json({
      healthy: isHealthy,
      ready: browserManager.isReady || false,
      stats: stats,
      timestamp: new Date().toISOString(),
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Browser health check failed:`, error);
    res.status(500).json({
      healthy: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route GET /health/service
 * @desc Service health check
 */
router.get('/health/service', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    const status = await scraperService.getSourceStatus();

    res.json({
      healthy: true,
      status: status,
      timestamp: new Date().toISOString(),
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Service health check failed:`, error);
    res.status(500).json({
      healthy: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

// ============================================================
// CREX SCRAPE ENDPOINTS
// ============================================================

/**
 * @route GET /api/scrape/live
 * @desc Scrape live matches from CREX
 * @query {boolean} force - Force refresh (default: true)
 */
router.get('/scrape/live', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const force = req.query.force !== 'false';
  let timeoutId = null;

  try {
    logger.info(
      `[${requestId}] Received request to scrape live matches from CREX (force: ${force})`
    );

    const timeout = setTimeout(() => {
      logger.error(`[${requestId}] Live scrape request timed out`);
      res.status(504).json({
        success: false,
        error: 'Request timeout - scraping took too long',
        requestId: requestId,
      });
    }, 300000);
    timeoutId = timeout;

    const result = await scraperService.scrapeLive(force);

    clearTimeout(timeoutId);

    logger.info(`[${requestId}] Live scrape completed successfully`);
    res.json({
      success: result.success,
      source: result.source || 'crex',
      type: 'live',
      total: result.total || 0,
      data: result.data || [],
      timestamp: result.timestamp || new Date().toISOString(),
      duration: result.duration || 0,
      cacheBuster: result.cacheBuster || Date.now(),
      requestId: requestId,
    });
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    logger.error(`[${requestId}] Error scraping live matches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route GET /api/scrape/live/refresh
 * @desc Force refresh live matches (bypass cache)
 */
router.get('/scrape/live/refresh', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    logger.info(`[${requestId}] Force refreshing live matches...`);

    // Clear cache first
    try {
      const { cache } = require('../cache');
      if (cache && typeof cache.del === 'function') {
        await cache.del('crex_live_matches');
        logger.info(`[${requestId}] Cache cleared for live matches`);
      }
    } catch (e) {
      logger.warn(`[${requestId}] Could not clear cache: ${e.message}`);
    }

    const result = await scraperService.scrapeLive(true);

    res.json({
      success: result.success,
      source: result.source || 'crex',
      type: 'live',
      total: result.total || 0,
      data: result.data || [],
      timestamp: result.timestamp || new Date().toISOString(),
      requestId: requestId,
      refreshed: true,
      cacheBuster: result.cacheBuster || Date.now(),
    });
  } catch (error) {
    logger.error(`[${requestId}] Error refreshing live matches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route GET /api/scrape/upcoming
 * @desc Scrape upcoming matches from CREX
 */
router.get('/scrape/upcoming', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    logger.info(`[${requestId}] Received request to scrape upcoming matches from CREX`);

    const result = await scraperService.scrapeUpcoming();

    logger.info(`[${requestId}] Upcoming scrape completed successfully`);
    res.json({
      success: result.success,
      source: result.source || 'crex',
      type: 'upcoming',
      total: result.total || 0,
      data: result.data || [],
      timestamp: result.timestamp || new Date().toISOString(),
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error scraping upcoming matches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route GET /api/scrape/finished
 * @desc Scrape finished matches from CREX
 */
router.get('/scrape/finished', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    logger.info(`[${requestId}] Received request to scrape finished matches from CREX`);

    const result = await scraperService.scrapeFinished();

    logger.info(`[${requestId}] Finished scrape completed successfully`);
    res.json({
      success: result.success,
      source: result.source || 'crex',
      type: 'finished',
      total: result.total || 0,
      data: result.data || [],
      timestamp: result.timestamp || new Date().toISOString(),
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error scraping finished matches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route GET /api/scrape/previous
 * @desc Scrape previous matches from CREX
 */
router.get('/scrape/previous', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    logger.info(`[${requestId}] Received request to scrape previous matches from CREX`);

    const result = await scraperService.scrapePreviousMatches();

    logger.info(`[${requestId}] Previous matches scrape completed successfully`);
    res.json({
      success: result.success,
      source: result.source || 'crex',
      type: 'previous',
      total: result.total || 0,
      data: result.data || [],
      timestamp: result.timestamp || new Date().toISOString(),
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error scraping previous matches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route GET /api/scrape/team/:teamName
 * @desc Scrape team matches from CREX
 */
router.get('/scrape/team/:teamName', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const teamName = req.params.teamName || 'services-GR';

  try {
    logger.info(`[${requestId}] Received request to scrape team matches for: ${teamName}`);

    const result = await scraperService.scrapeTeamMatches(teamName);

    logger.info(`[${requestId}] Team matches scrape completed successfully`);
    res.json({
      success: result.success,
      source: result.source || 'crex',
      type: 'team',
      team: result.team || teamName,
      total: result.total || 0,
      data: result.data || [],
      timestamp: result.timestamp || new Date().toISOString(),
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error scraping team matches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route GET /api/scrape/all
 * @desc Scrape all match types from CREX
 */
router.get('/scrape/all', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    logger.info(`[${requestId}] Received request to scrape all matches from CREX`);

    const result = await scraperService.scrapeAll();

    logger.info(`[${requestId}] All matches scrape completed successfully`);
    res.json({
      success: result.success,
      source: result.source || 'multi',
      type: 'all',
      total: result.total || 0,
      data: result.data || {},
      errors: result.errors || [],
      timestamp: result.timestamp || new Date().toISOString(),
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error scraping all matches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

// ============================================================
// ESPN SCRAPE ENDPOINTS
// ============================================================

/**
 * @route GET /api/scrape/espn/previous
 * @desc Scrape previous matches from ESPN Cricinfo
 */
router.get('/scrape/espn/previous', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const date = req.query.date || null;

  try {
    logger.info(
      `[${requestId}] Received request to scrape ESPN previous matches${date ? ` for date ${date}` : ''}`
    );

    const result = await scraperService.scrapeESPNPreviousMatches(date);

    logger.info(`[${requestId}] ESPN previous matches scrape completed successfully`);
    res.json({
      success: result.success,
      source: result.source || 'espncricinfo',
      type: 'previous',
      total: result.total || 0,
      data: result.data || [],
      date: date || 'today',
      timestamp: result.timestamp || new Date().toISOString(),
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error scraping ESPN previous matches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

// ============================================================
// CRICBUZZ SCRAPE ENDPOINTS
// ============================================================

/**
 * @route GET /api/scrape/cricbuzz/live
 * @desc Scrape live matches from Cricbuzz
 */
router.get('/scrape/cricbuzz/live', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    logger.info(`[${requestId}] Received request to scrape Cricbuzz live matches`);

    const result = await scraperService.scrapeCricbuzzLive();

    logger.info(`[${requestId}] Cricbuzz live scrape completed successfully`);
    res.json({
      success: result.success,
      source: result.source || 'cricbuzz',
      type: 'live',
      total: result.total || 0,
      data: result.data || [],
      timestamp: result.timestamp || new Date().toISOString(),
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error scraping Cricbuzz live matches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

// ============================================================
// CRICBUZZ ARCHIVE SCRAPE ENDPOINTS
// ============================================================

/**
 * @route GET /api/scrape/cricbuzz/archive
 * @desc Scrape entire Cricbuzz archive
 */
router.get('/scrape/cricbuzz/archive', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    logger.info(`[${requestId}] Received request to scrape Cricbuzz archive`);

    const result = await scraperService.scrapeCricbuzzArchive();

    logger.info(`[${requestId}] Cricbuzz archive scrape completed successfully`);
    res.json({
      success: result.success,
      source: result.source || 'cricbuzz-archive',
      type: 'archive',
      stats: result.stats || {},
      data: result.data || {},
      timestamp: result.timestamp || new Date().toISOString(),
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error scraping Cricbuzz archive:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route GET /api/scrape/cricbuzz/archive/year/:year
 * @desc Scrape Cricbuzz archive for a specific year
 */
router.get('/scrape/cricbuzz/archive/year/:year', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { year } = req.params;

  try {
    logger.info(`[${requestId}] Smart scraping Cricbuzz archive for year: ${year}`);

    const result = await scraperService.scrapeCricbuzzArchiveYear(year);

    res.json({
      success: result.success,
      source: result.source || 'cricbuzz-archive',
      type: 'year',
      year: year,
      stats: result.stats || {},
      duration: result.duration || 0,
      timestamp: result.timestamp || new Date().toISOString(),
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error scraping archive for year ${year}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route POST /api/scrape/cricbuzz/archive/batch
 * @desc Scrape Cricbuzz archive for multiple years
 */
router.post('/scrape/cricbuzz/archive/batch', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { years } = req.body;

  try {
    const targetYears = years || Array.from({ length: 5 }, (_, i) => String(2026 - i));

    logger.info(
      `[${requestId}] Batch scraping Cricbuzz archive for years: ${targetYears.join(', ')}`
    );

    const result = await scraperService.scrapeCricbuzzArchiveYears(targetYears);

    res.json({
      success: result.success,
      source: result.source || 'cricbuzz-archive',
      type: 'batch',
      stats: result.stats || {},
      results: result.results || [],
      duration: result.duration || 0,
      timestamp: result.timestamp || new Date().toISOString(),
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error batch scraping archive:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route GET /api/scrape/cricbuzz/archive/stats/:year
 * @desc Get Cricbuzz archive statistics for a year
 */
router.get('/scrape/cricbuzz/archive/stats/:year', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { year } = req.params;

  try {
    const { cache } = require('../cache');
    const stats = await cache.get(`cricbuzz_archive_stats_${year}`);

    res.json({
      success: true,
      year: year,
      stats: stats || null,
      cached: !!stats,
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error getting archive stats for ${year}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

// ============================================================
// FORCE SCRAPE ENDPOINTS
// ============================================================

/**
 * @route POST /api/scrape/force
 * @desc Force scrape with specific parameters
 */
router.post('/scrape/force', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { type, source, team, date, year, seriesId, matchId } = req.body;

  try {
    logger.info(`[${requestId}] Received force scrape request:`, {
      type,
      source,
      team,
      date,
      year,
      seriesId,
      matchId,
    });

    const result = await scraperService.forceScrape({
      type,
      source,
      team,
      date,
      year,
      seriesId,
      matchId,
    });

    logger.info(`[${requestId}] Force scrape completed successfully`);
    res.json({
      success: true,
      data: result,
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Force scrape error:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route POST /api/scrape/force-release
 * @desc Force release stuck scrape lock
 */
router.post('/scrape/force-release', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    logger.info(`[${requestId}] Force releasing scrape lock...`);

    const result = scraperService.forceReleaseLock();

    res.json({
      success: true,
      released: result,
      message: result ? 'Scrape lock released' : 'No lock to release',
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error releasing lock:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

// ============================================================
// REAL-TIME UPDATE ENDPOINTS
// ============================================================

/**
 * @route POST /api/realtime/start
 * @desc Start real-time updates (5 second polling)
 */
router.post('/realtime/start', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { interval = 5000 } = req.body;

  try {
    logger.info(`[${requestId}] Starting real-time updates with interval: ${interval}ms`);

    const result = await scraperService.startRealTimeUpdates({
      interval: interval,
      onMatchUpdate: (match, changes) => {
        // Broadcast via WebSocket - will be handled by server.js
        logger.debug(
          `📊 Match ${match.match_id} updated: ${changes.previousScore} → ${changes.newScore}`
        );
      },
      onMatchComplete: (match) => {
        logger.info(`✅ Match ${match.match_id} completed`);
      },
      onNewMatch: (match) => {
        logger.info(`🆕 New match: ${match.teams.home.name} vs ${match.teams.away.name}`);
      },
    });

    res.json({
      success: result,
      message: result ? 'Real-time updates started (5 second interval)' : 'Already running',
      interval: interval,
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error starting real-time:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route POST /api/realtime/stop
 * @desc Stop real-time updates
 */
router.post('/realtime/stop', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    logger.info(`[${requestId}] Stopping real-time updates...`);

    const result = scraperService.stopRealTimeUpdates();

    res.json({
      success: result,
      message: result ? 'Real-time updates stopped' : 'Not running',
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error stopping real-time:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route GET /api/realtime/status
 * @desc Get real-time status
 */
router.get('/realtime/status', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    const status = scraperService.getRealTimeStatus();

    res.json({
      success: true,
      data: status,
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error getting real-time status:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

// ============================================================
// MATCH QUERY ENDPOINTS
// ============================================================

/**
 * @route GET /api/matches
 * @desc Get matches from database with filters
 */
router.get('/matches', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { status, format, team, series, source, limit = 50, offset = 0 } = req.query;

  try {
    logger.info(`[${requestId}] Fetching matches with filters:`, {
      status,
      format,
      team,
      series,
      source,
    });

    const matches = await scraperService.getMatches({
      status,
      format,
      team,
      series,
      source,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    res.json({
      success: true,
      data: matches,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: matches.length,
      },
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error fetching matches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

/**
 * @route GET /api/matches/:id
 * @desc Get match by ID
 */
router.get('/matches/:id', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { id } = req.params;

  try {
    logger.info(`[${requestId}] Fetching match details: ${id}`);

    const match = await scraperService.getMatchDetails(id);

    if (match) {
      res.json({
        success: true,
        data: match,
        requestId: requestId,
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Match not found',
        requestId: requestId,
      });
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching match ${id}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

// ============================================================
// CLEANUP ENDPOINTS
// ============================================================

/**
 * @route POST /api/cleanup
 * @desc Clean up scrapers and browser
 */
router.post('/cleanup', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    logger.info(`[${requestId}] Starting cleanup...`);

    await scraperService.cleanup();

    logger.info(`[${requestId}] Cleanup completed successfully`);
    res.json({
      success: true,
      message: 'Cleanup completed successfully',
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Cleanup error:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

// ============================================================
// BROWSER STATS ENDPOINTS
// ============================================================

/**
 * @route GET /api/browser/stats
 * @desc Get browser statistics
 */
router.get('/browser/stats', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    const stats = browserManager.getStats ? browserManager.getStats() : {};
    const isHealthy = await browserManager.healthCheck();

    res.json({
      success: true,
      data: {
        ready: browserManager.isReady || false,
        healthy: isHealthy,
        stats: stats,
      },
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error getting browser stats:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

// ============================================================
// SOURCE STATUS ENDPOINT
// ============================================================

/**
 * @route GET /api/status
 * @desc Get source status
 */
router.get('/status', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    const status = await scraperService.getSourceStatus();

    res.json({
      success: true,
      data: status,
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error getting source status:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

// ============================================================
// DATABASE STATS ENDPOINT
// ============================================================

/**
 * @route GET /api/db/stats
 * @desc Get database statistics
 */
router.get('/db/stats', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    const { getConnection } = require('../database');
    const db = getConnection();

    const [matchCount] = await db.query('SELECT COUNT(*) as total FROM matches');
    const [sourceCount] = await db.query(
      'SELECT source, COUNT(*) as count FROM matches GROUP BY source'
    );
    const [statusCount] = await db.query(
      'SELECT status, COUNT(*) as count FROM matches GROUP BY status'
    );
    const [recentMatches] = await db.query(
      'SELECT * FROM matches ORDER BY created_at DESC LIMIT 5'
    );

    res.json({
      success: true,
      data: {
        totalMatches: matchCount[0]?.total || 0,
        bySource: sourceCount,
        byStatus: statusCount,
        recentMatches: recentMatches,
      },
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error getting database stats:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

// ============================================================
// TEST ENDPOINT
// ============================================================

/**
 * @route GET /api/test
 * @desc Test endpoint to verify API is working
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'API is working',
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
  });
});

module.exports = router;
