// src/api/routes.js
const express = require('express');
const router = express.Router();
const { scraperService } = require('../services/scraperService');
const logger = require('../logger');

// ============================================================
// PRIMARY SCRAPER ROUTES (CREX)
// ============================================================

// Scrape live matches from CREX (primary)
router.get('/scrape/live', async (req, res) => {
  try {
    const result = await scraperService.scrapeLive();
    res.json({
      success: result.success !== false,
      source: 'crex',
      type: 'live',
      timestamp: new Date().toISOString(),
      total: result.data?.length || 0,
      data: result.data || [],
      fallback_used: result.source === 'fallback' || false
    });
  } catch (error) {
    logger.error('Live scrape error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Scrape upcoming matches from CREX (primary)
router.get('/scrape/upcoming', async (req, res) => {
  try {
    const result = await scraperService.scrapeUpcoming();
    res.json({
      success: result.success !== false,
      source: 'crex',
      type: 'upcoming',
      timestamp: new Date().toISOString(),
      total: result.data?.length || 0,
      data: result.data || [],
      fallback_used: result.source === 'fallback' || false
    });
  } catch (error) {
    logger.error('Upcoming scrape error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Scrape finished matches from CREX (primary)
router.get('/scrape/finished', async (req, res) => {
  try {
    const result = await scraperService.scrapeFinished();
    res.json({
      success: result.success !== false,
      source: 'crex',
      type: 'finished',
      timestamp: new Date().toISOString(),
      total: result.data?.length || 0,
      data: result.data || [],
      fallback_used: result.source === 'fallback' || false
    });
  } catch (error) {
    logger.error('Finished scrape error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Scrape all match types from CREX (primary)
router.get('/scrape/all', async (req, res) => {
  try {
    const result = await scraperService.scrapeAll();
    
    const liveCount = result.data?.live?.data?.length || 0;
    const upcomingCount = result.data?.upcoming?.data?.length || 0;
    const finishedCount = result.data?.finished?.data?.length || 0;
    
    res.json({
      success: true,
      source: 'crex',
      timestamp: new Date().toISOString(),
      total: liveCount + upcomingCount + finishedCount,
      data: {
        live: result.data?.live?.data || [],
        upcoming: result.data?.upcoming?.data || [],
        finished: result.data?.finished?.data || []
      },
      counts: {
        live: liveCount,
        upcoming: upcomingCount,
        finished: finishedCount
      },
      errors: result.errors || []
    });
  } catch (error) {
    logger.error('Scrape all error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// SECONDARY SCRAPER ROUTES (Fallback sources)
// ============================================================

// Scrape from specific source - FIXED: removed the ? from the route
router.get('/scrape/source/:source', async (req, res) => {
  try {
    const { source } = req.params;
    const { type } = req.query; // Use query parameter instead
    
    const result = await scraperService.forceScrape({ source, type });
    
    // Check if result has data property (for CREX)
    const data = result.data || result;
    
    res.json({
      success: true,
      source: source,
      type: type || 'all',
      timestamp: new Date().toISOString(),
      data: data
    });
  } catch (error) {
    logger.error(`Scrape source ${req.params.source} error:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Scrape specific source with type (alternative route)
router.get('/scrape/source/:source/type/:type', async (req, res) => {
  try {
    const { source, type } = req.params;
    const result = await scraperService.forceScrape({ source, type });
    
    const data = result.data || result;
    
    res.json({
      success: true,
      source: source,
      type: type,
      timestamp: new Date().toISOString(),
      data: data
    });
  } catch (error) {
    logger.error(`Scrape source ${req.params.source} type ${req.params.type} error:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Scrape points table (secondary - Cricbuzz)
router.get('/scrape/points', async (req, res) => {
  try {
    const result = await scraperService.scrapePoints();
    res.json({
      success: true,
      source: 'cricbuzz',
      timestamp: new Date().toISOString(),
      data: result
    });
  } catch (error) {
    logger.error('Points scrape error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Scrape news (secondary - Cricbuzz)
router.get('/scrape/news', async (req, res) => {
  try {
    const result = await scraperService.scrapeNews();
    res.json({
      success: true,
      source: 'cricbuzz',
      timestamp: new Date().toISOString(),
      total: result.length,
      data: result
    });
  } catch (error) {
    logger.error('News scrape error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// GET ROUTES
// ============================================================

// Get match details by ID
router.get('/matches/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const match = await scraperService.getMatchDetails(matchId);
    
    if (match) {
      res.json({
        success: true,
        data: match
      });
    } else {
      res.status(404).json({
        success: false,
        error: `Match ${matchId} not found`
      });
    }
  } catch (error) {
    logger.error(`Get match ${req.params.matchId} error:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get matches with filters
router.get('/matches', async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      format: req.query.format,
      team: req.query.team,
      series: req.query.series
    };
    
    const matches = await scraperService.getMatches(filters);
    res.json({
      success: true,
      total: matches.length,
      data: matches
    });
  } catch (error) {
    logger.error('Get matches error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// STATUS ROUTES
// ============================================================

// Get service status
router.get('/status', async (req, res) => {
  try {
    const status = await scraperService.getSourceStatus();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      primarySource: 'crex',
      status: status
    });
  } catch (error) {
    logger.error('Status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get cache status
router.get('/cache/status', async (req, res) => {
  try {
    const cacheStatus = await scraperService.getCacheStatus();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      cache: cacheStatus
    });
  } catch (error) {
    logger.error('Cache status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Clear cache
router.delete('/cache', async (req, res) => {
  try {
    const { pattern } = req.query;
    const cleared = await scraperService.clearCache(pattern);
    res.json({
      success: true,
      message: `Cache cleared: ${cleared} keys`,
      cleared: cleared
    });
  } catch (error) {
    logger.error('Clear cache error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;