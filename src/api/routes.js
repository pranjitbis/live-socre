// src/api/routes.js
const express = require('express');
const router = express.Router();
const { scraperService } = require('../services/scraperService');
const browserManager = require('../scraper/browser');
const logger = require('../logger');
const fs = require('fs');
const path = require('path');

// ============================================================
// FINISHED MATCH DATA LOADER
// ============================================================

// Cache for match data
let matchCache = {
  data: null,
  lastLoad: null,
  women: [],
  men: []
};

// Path to your match data
const MATCH_DATA_PATH = path.join('C:', 'Users', 'pranj', 'OneDrive', 'Desktop', 'testing', 'CricketScraper', 'old_metch');

/**
 * Load all match JSON files
 */
function loadMatchData() {
  try {
    // Check if we have cached data
    if (matchCache.data && matchCache.lastLoad) {
      const age = Date.now() - matchCache.lastLoad;
      if (age < 60000) {
        logger.debug(`📊 Using cached match data (${age}ms old)`);
        return matchCache.data;
      }
    }

    // Check if directory exists
    if (!fs.existsSync(MATCH_DATA_PATH)) {
      logger.warn(`⚠️ Match data path not found: ${MATCH_DATA_PATH}`);
      matchCache.data = [];
      matchCache.women = [];
      matchCache.men = [];
      return [];
    }

    // Get all JSON files
    const files = fs.readdirSync(MATCH_DATA_PATH).filter(f => f.endsWith('.json'));
    
    if (files.length === 0) {
      logger.warn(`⚠️ No JSON files found in: ${MATCH_DATA_PATH}`);
      matchCache.data = [];
      matchCache.women = [];
      matchCache.men = [];
      return [];
    }

    let allMatches = [];
    
    for (const file of files) {
      try {
        const fullPath = path.join(MATCH_DATA_PATH, file);
        const content = fs.readFileSync(fullPath, 'utf8');
        const matchData = JSON.parse(content);
        
        // Add metadata
        matchData._sourceFile = file;
        matchData._fullPath = fullPath;
        matchData._loadedAt = new Date().toISOString();
        
        // Detect gender
        const gender = detectGender(matchData, file);
        matchData._gender = gender;
        
        allMatches.push(matchData);
        logger.debug(`✅ Loaded: ${file} (${matchData.info?.teams?.join(' vs ') || 'Unknown'})`);
      } catch (error) {
        logger.warn(`⚠️ Error loading file ${file}: ${error.message}`);
      }
    }

    // Cache the data
    matchCache.data = allMatches;
    matchCache.lastLoad = Date.now();
    
    // Separate by gender
    matchCache.women = allMatches.filter(m => m._gender === 'women');
    matchCache.men = allMatches.filter(m => m._gender === 'men');
    
    logger.info(`✅ Loaded ${allMatches.length} matches (${matchCache.women.length} women, ${matchCache.men.length} men)`);
    
    return allMatches;
  } catch (error) {
    logger.error(`❌ Error loading match data: ${error.message}`);
    matchCache.data = [];
    matchCache.women = [];
    matchCache.men = [];
    return [];
  }
}

/**
 * Detect gender from match data or filename
 */
function detectGender(matchData, filename) {
  // First check info.gender
  if (matchData.info?.gender) {
    const gender = matchData.info.gender.toLowerCase();
    if (gender === 'female' || gender === 'women' || gender === 'woman') return 'women';
    if (gender === 'male' || gender === 'men' || gender === 'man') return 'men';
  }
  
  // Check filename
  const lowerFile = filename.toLowerCase();
  if (lowerFile.includes('women') || lowerFile.includes('female')) return 'women';
  if (lowerFile.includes('men') || lowerFile.includes('male')) return 'men';
  
  // Check team names
  const teams = matchData.info?.teams || [];
  const womenKeywords = ['women', 'womens', 'female', 'girls'];
  for (const team of teams) {
    const lowerTeam = team.toLowerCase();
    if (womenKeywords.some(k => lowerTeam.includes(k))) return 'women';
  }
  
  // Default to men
  return 'men';
}

/**
 * Get matches by gender
 */
function getMatches(gender = 'all') {
  if (!matchCache.data || matchCache.data.length === 0) {
    loadMatchData();
  }
  
  if (gender === 'women') return matchCache.women || [];
  if (gender === 'men') return matchCache.men || [];
  return matchCache.data || [];
}

/**
 * Transform match data for API response
 */
function transformMatch(match, format = 'full') {
  const info = match.info || {};
  
  if (format === 'summary') {
    return {
      id: match._sourceFile.replace('.json', ''),
      gender: match._gender,
      match_type: info.match_type || 'Unknown',
      teams: info.teams || [],
      venue: info.venue || 'Unknown',
      city: info.city || 'Unknown',
      dates: info.dates || [],
      season: info.season || 'Unknown',
      outcome: info.outcome || null,
      toss: info.toss || null,
      player_of_match: info.player_of_match || [],
      overs: info.overs || 0,
      sourceFile: match._sourceFile
    };
  }
  
  // Full format - return complete match data
  return match;
}

// ============================================================
// HEALTH CHECK ENDPOINTS
// ============================================================

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'cricket-scraper-api',
    uptime: process.uptime(),
    requestId: req.requestId,
  });
});

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
// ⭐ FORCE RELEASE LOCK
// ============================================================

router.post('/scrape/force-release', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    logger.info(`[${requestId}] 🔓 Force releasing all scrape locks...`);

    const released = scraperService.forceReleaseLock('all');
    
    if (scraperService.crexScrapers && scraperService.crexScrapers.live) {
      if (typeof scraperService.crexScrapers.live.forceReleaseLock === 'function') {
        scraperService.crexScrapers.live.forceReleaseLock();
      }
    }
    
    const status = await scraperService.getSourceStatus();

    res.json({
      success: true,
      message: 'All locks released successfully',
      released: released,
      timestamp: new Date().toISOString(),
      requestId: requestId,
      status: status
    });
  } catch (error) {
    logger.error(`[${requestId}] Error releasing locks:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

router.get('/scrape/lock-status', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    const status = await scraperService.getSourceStatus();

    res.json({
      success: true,
      status: status,
      timestamp: new Date().toISOString(),
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error getting lock status:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

// ============================================================
// ⭐ FIXED: LIVE SCRAPE - IMMEDIATE RESPONSE
// ============================================================

router.get('/scrape/live', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const force = req.query.force !== 'false';

  try {
    logger.info(`[${requestId}] Received request to scrape live matches (force: ${force})`);

    // ⭐ Check and release stale locks
    if (scraperService.checkAndReleaseStaleLocks) {
      scraperService.checkAndReleaseStaleLocks();
    }

    // ⭐ FIRST: Try to get cached data (immediate response)
    const cachedData = await scraperService.getCachedOrLastData('live');
    
    if (cachedData && cachedData.data && cachedData.data.length > 0) {
      // ✅ Return cached data immediately
      logger.info(`[${requestId}] Returning cached live data (${cachedData.data.length} matches)`);
      
      // ⭐ Start background scraping for updates (don't wait)
      if (force) {
        scraperService.scrapeLive(true)
          .then(result => {
            logger.info(`[${requestId}] Background scrape completed: ${result?.data?.length || 0} matches`);
          })
          .catch(error => {
            logger.error(`[${requestId}] Background scrape failed:`, error.message);
          });
      }

      return res.json({
        success: true,
        source: 'crex',
        type: 'live',
        total: cachedData.total || cachedData.data.length,
        data: cachedData.data,
        timestamp: new Date().toISOString(),
        requestId: requestId,
        fromCache: true,
        forceRefresh: force,
        message: force ? 'Background refresh started - check WebSocket for updates' : 'Cached data - use force=true to refresh',
      });
    }

    // ⭐ No cache - start scrape with timeout
    logger.info(`[${requestId}] No cached data available, starting scrape with timeout...`);

    // Send initial response with loading status
    res.writeHead(202, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    });

    // Start scraping with timeout
    let scrapeResult = null;
    let scrapeError = null;

    try {
      // Race between scrape and timeout
      scrapeResult = await Promise.race([
        scraperService.scrapeLive(force),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Scrape timeout - try again in a few seconds')), 15000)
        )
      ]);
    } catch (error) {
      scrapeError = error;
    }

    if (scrapeResult && scrapeResult.success) {
      // Success - return data
      res.end(JSON.stringify({
        success: true,
        source: 'crex',
        type: 'live',
        total: scrapeResult.total || 0,
        data: scrapeResult.data || [],
        timestamp: new Date().toISOString(),
        requestId: requestId,
        fromCache: false,
        forceRefresh: force,
        duration: scrapeResult.duration || 0,
      }));
    } else {
      // Failed or timeout - return error but with useful message
      res.end(JSON.stringify({
        success: false,
        source: 'crex',
        type: 'live',
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        requestId: requestId,
        error: scrapeError ? scrapeError.message : 'No data available',
        message: 'No cached data available. Please try again in a few seconds.',
        fromCache: false,
      }));
    }

  } catch (error) {
    logger.error(`[${requestId}] Error scraping live matches:`, error);
    
    // Check if response already sent
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message,
        requestId: requestId,
        timestamp: new Date().toISOString(),
      });
    }
  }
});

// ============================================================
// ⭐ FIXED: LIVE SCRAPE REFRESH - BACKGROUND
// ============================================================

router.get('/scrape/live/refresh', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    logger.info(`[${requestId}] 🔄 Force refreshing live matches...`);

    // Clear cache
    try {
      const { cache } = require('../cache');
      if (cache && typeof cache.del === 'function') {
        await cache.del('crex_live_matches');
        logger.info(`[${requestId}] ✅ Cache cleared`);
      }
    } catch (e) {
      logger.warn(`[${requestId}] Could not clear cache: ${e.message}`);
    }

    // Release locks
    scraperService.forceReleaseLock();

    // Return immediate response
    res.json({
      success: true,
      message: 'Refresh started - check WebSocket for updates',
      requestId: requestId,
      timestamp: new Date().toISOString(),
    });

    // ⭐ Start background scraping
    scraperService.scrapeLive(true)
      .then(result => {
        logger.info(`[${requestId}] Background refresh completed: ${result?.data?.length || 0} matches`);
      })
      .catch(error => {
        logger.error(`[${requestId}] Background refresh failed:`, error.message);
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

// ============================================================
// OTHER SCRAPE ENDPOINTS
// ============================================================

router.get('/scrape/upcoming', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    const cached = await scraperService.getCachedOrLastData('upcoming');
    
    if (cached && cached.data && cached.data.length > 0) {
      return res.json({
        success: true,
        source: 'crex',
        type: 'upcoming',
        total: cached.total || cached.data.length,
        data: cached.data,
        timestamp: new Date().toISOString(),
        requestId: requestId,
        fromCache: true,
      });
    }

    const result = await scraperService.scrapeUpcoming();

    res.json({
      success: result.success,
      source: result.source || 'crex',
      type: 'upcoming',
      total: result.total || 0,
      data: result.data || [],
      timestamp: result.timestamp || new Date().toISOString(),
      requestId: requestId,
      fromCache: false,
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

router.get('/scrape/finished', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    const cached = await scraperService.getCachedOrLastData('finished');
    
    if (cached && cached.data && cached.data.length > 0) {
      return res.json({
        success: true,
        source: 'crex',
        type: 'finished',
        total: cached.total || cached.data.length,
        data: cached.data,
        timestamp: new Date().toISOString(),
        requestId: requestId,
        fromCache: true,
      });
    }

    const result = await scraperService.scrapeFinished();

    res.json({
      success: result.success,
      source: result.source || 'crex',
      type: 'finished',
      total: result.total || 0,
      data: result.data || [],
      timestamp: result.timestamp || new Date().toISOString(),
      requestId: requestId,
      fromCache: false,
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

router.get('/scrape/previous', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    logger.info(`[${requestId}] Received request to scrape previous matches from CREX`);

    const result = await scraperService.scrapePreviousMatches();

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

router.post('/scrape/force-clear', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    logger.info(`[${requestId}] 🧹 Force clearing all caches...`);

    try {
      const { cache } = require('../cache');
      if (cache && typeof cache.clear === 'function') {
        await cache.clear();
        logger.info(`[${requestId}] ✅ All caches cleared`);
      }
    } catch (e) {
      logger.warn(`[${requestId}] Could not clear cache: ${e.message}`);
    }

    scraperService.forceReleaseLock();

    try {
      await browserManager.close();
      scraperService.browserReady = false;
      logger.info(`[${requestId}] Browser closed`);
    } catch (e) {
      logger.warn(`[${requestId}] Error closing browser: ${e.message}`);
    }

    res.json({
      success: true,
      message: 'All caches cleared, locks released, browser reset',
      timestamp: new Date().toISOString(),
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error clearing caches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId,
    });
  }
});

// ============================================================
// 🏏 FINISHED MATCH DATA ENDPOINTS
// ============================================================

router.get('/matches/finished', (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { 
    gender = 'all', 
    format = 'summary',
    limit = 100,
    offset = 0
  } = req.query;
  
  try {
    logger.info(`[${requestId}] Fetching finished matches (gender: ${gender})`);
    
    const matches = getMatches(gender);
    
    const start = parseInt(offset);
    const end = Math.min(start + parseInt(limit), matches.length);
    const paginated = matches.slice(start, end);
    
    const transformed = paginated.map(match => transformMatch(match, format));
    
    res.json({
      success: true,
      source: 'cricsheet',
      type: 'finished',
      gender: gender,
      total: matches.length,
      returned: transformed.length,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        next: end < matches.length ? end : null
      },
      data: transformed,
      timestamp: new Date().toISOString(),
      requestId: requestId,
      cacheInfo: {
        loaded: matchCache.data !== null,
        cacheAge: matchCache.lastLoad ? Date.now() - matchCache.lastLoad : null,
        totalCached: matchCache.data ? matchCache.data.length : 0
      }
    });
  } catch (error) {
    logger.error(`[${requestId}] Error fetching finished matches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId
    });
  }
});

router.get('/matches/finished/women', (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { format = 'full' } = req.query;
  
  try {
    logger.info(`[${requestId}] Fetching finished women's matches`);
    
    const matches = getMatches('women');
    const transformed = matches.map(match => transformMatch(match, format));
    
    res.json({
      success: true,
      source: 'cricsheet',
      type: 'finished',
      gender: 'women',
      total: matches.length,
      data: transformed,
      timestamp: new Date().toISOString(),
      requestId: requestId
    });
  } catch (error) {
    logger.error(`[${requestId}] Error fetching women's matches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId
    });
  }
});

router.get('/matches/finished/men', (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { format = 'full' } = req.query;
  
  try {
    logger.info(`[${requestId}] Fetching finished men's matches`);
    
    const matches = getMatches('men');
    const transformed = matches.map(match => transformMatch(match, format));
    
    res.json({
      success: true,
      source: 'cricsheet',
      type: 'finished',
      gender: 'men',
      total: matches.length,
      data: transformed,
      timestamp: new Date().toISOString(),
      requestId: requestId
    });
  } catch (error) {
    logger.error(`[${requestId}] Error fetching men's matches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId
    });
  }
});

router.get('/matches/finished/search', (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { q, gender = 'all' } = req.query;
  
  if (!q) {
    return res.status(400).json({
      success: false,
      error: 'Search query (q) is required',
      requestId: requestId
    });
  }
  
  try {
    logger.info(`[${requestId}] Searching finished matches (gender: ${gender}, query: ${q})`);
    
    const matches = getMatches(gender);
    const queryLower = q.toLowerCase();
    
    const results = matches.filter(match => {
      const info = match.info || {};
      
      const teams = info.teams || [];
      if (teams.some(t => t.toLowerCase().includes(queryLower))) return true;
      
      const players = info.players || {};
      for (const [team, playerList] of Object.entries(players)) {
        if (Array.isArray(playerList)) {
          if (playerList.some(p => p.toLowerCase().includes(queryLower))) return true;
        }
      }
      
      if (info.venue && info.venue.toLowerCase().includes(queryLower)) return true;
      if (info.city && info.city.toLowerCase().includes(queryLower)) return true;
      if (info.event?.name && info.event.name.toLowerCase().includes(queryLower)) return true;
      if (info.season && info.season.toLowerCase().includes(queryLower)) return true;
      
      return false;
    });
    
    res.json({
      success: true,
      source: 'cricsheet',
      type: 'finished',
      gender: gender,
      search: {
        query: q,
        total: results.length
      },
      data: results.slice(0, 100),
      timestamp: new Date().toISOString(),
      requestId: requestId
    });
  } catch (error) {
    logger.error(`[${requestId}] Error searching matches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId
    });
  }
});

router.get('/matches/finished/team/:teamName', (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { teamName } = req.params;
  const { gender = 'all' } = req.query;
  
  try {
    logger.info(`[${requestId}] Fetching finished matches for team: ${teamName}`);
    
    const matches = getMatches(gender);
    const teamLower = teamName.toLowerCase();
    
    const results = matches.filter(match => {
      const teams = match.info?.teams || [];
      return teams.some(t => t.toLowerCase().includes(teamLower));
    });
    
    res.json({
      success: true,
      source: 'cricsheet',
      type: 'finished',
      team: teamName,
      gender: gender,
      total: results.length,
      data: results,
      timestamp: new Date().toISOString(),
      requestId: requestId
    });
  } catch (error) {
    logger.error(`[${requestId}] Error fetching team matches:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId
    });
  }
});

router.get('/matches/finished/stats', (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { gender = 'all' } = req.query;
  
  try {
    logger.info(`[${requestId}] Fetching finished matches stats (gender: ${gender})`);
    
    const matches = getMatches(gender);
    
    const stats = {
      total_matches: matches.length,
      by_match_type: {},
      by_season: {},
      by_team: {},
      by_venue: {},
      teams: new Set(),
      venues: new Set(),
      players: new Set()
    };
    
    for (const match of matches) {
      const info = match.info || {};
      
      const matchType = info.match_type || 'Unknown';
      stats.by_match_type[matchType] = (stats.by_match_type[matchType] || 0) + 1;
      
      const season = info.season || 'Unknown';
      stats.by_season[season] = (stats.by_season[season] || 0) + 1;
      
      const venue = info.venue || 'Unknown';
      stats.by_venue[venue] = (stats.by_venue[venue] || 0) + 1;
      stats.venues.add(venue);
      
      const teams = info.teams || [];
      for (const team of teams) {
        stats.by_team[team] = (stats.by_team[team] || 0) + 1;
        stats.teams.add(team);
      }
      
      const players = info.players || {};
      for (const [team, playerList] of Object.entries(players)) {
        if (Array.isArray(playerList)) {
          for (const player of playerList) {
            stats.players.add(player);
          }
        }
      }
    }
    
    stats.teams = Array.from(stats.teams).sort();
    stats.venues = Array.from(stats.venues).sort();
    stats.players_count = stats.players.size;
    delete stats.players;
    
    stats.by_gender = {
      women: matchCache.women ? matchCache.women.length : 0,
      men: matchCache.men ? matchCache.men.length : 0,
      total: matchCache.data ? matchCache.data.length : 0
    };
    
    res.json({
      success: true,
      source: 'cricsheet',
      type: 'finished',
      gender: gender,
      stats: stats,
      timestamp: new Date().toISOString(),
      requestId: requestId
    });
  } catch (error) {
    logger.error(`[${requestId}] Error fetching stats:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId
    });
  }
});

router.get('/matches/finished/:id', (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { id } = req.params;
  
  try {
    logger.info(`[${requestId}] Fetching finished match: ${id}`);
    
    const matches = getMatches('all');
    const match = matches.find(m => {
      return m._sourceFile === id || 
             m._sourceFile === `${id}.json` ||
             (m.info?.event?.name && m.info.event.name === id);
    });
    
    if (match) {
      res.json({
        success: true,
        source: 'cricsheet',
        type: 'finished',
        data: match,
        timestamp: new Date().toISOString(),
        requestId: requestId
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Match not found',
        requestId: requestId
      });
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching match:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId
    });
  }
});

router.post('/matches/finished/refresh', (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  
  try {
    logger.info(`[${requestId}] Refreshing finished match data...`);
    
    matchCache.data = null;
    matchCache.lastLoad = null;
    matchCache.women = [];
    matchCache.men = [];
    
    const data = loadMatchData();
    
    res.json({
      success: true,
      message: 'Finished match data refreshed',
      dataPath: MATCH_DATA_PATH,
      total_matches: data.length,
      women: matchCache.women ? matchCache.women.length : 0,
      men: matchCache.men ? matchCache.men.length : 0,
      timestamp: new Date().toISOString(),
      requestId: requestId
    });
  } catch (error) {
    logger.error(`[${requestId}] Error refreshing data:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId: requestId
    });
  }
});

router.get('/matches/finished/status', (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);

  try {
    const dirExists = fs.existsSync(MATCH_DATA_PATH);
    let fileCount = 0;
    let sampleFiles = [];
    
    if (dirExists) {
      try {
        const files = fs.readdirSync(MATCH_DATA_PATH).filter(f => f.endsWith('.json'));
        fileCount = files.length;
        sampleFiles = files.slice(0, 10);
      } catch (e) {
        logger.warn(`⚠️ Error reading directory: ${e.message}`);
      }
    }

    res.json({
      success: true,
      data: {
        dataPath: MATCH_DATA_PATH,
        directoryExists: dirExists,
        fileCount: fileCount,
        sampleFiles: sampleFiles,
        cacheLoaded: matchCache.data !== null,
        cacheAge: matchCache.lastLoad ? Date.now() - matchCache.lastLoad : null,
        totalMatches: matchCache.data ? matchCache.data.length : 0,
        women: matchCache.women ? matchCache.women.length : 0,
        men: matchCache.men ? matchCache.men.length : 0,
        lastLoad: matchCache.lastLoad ? new Date(matchCache.lastLoad).toISOString() : null,
      },
      requestId: requestId,
    });
  } catch (error) {
    logger.error(`[${requestId}] Error getting status:`, error);
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

router.get('/matches', async (req, res) => {
  const requestId = req.requestId || Math.random().toString(36).substring(7);
  const { status, format, team, series, source, year, limit = 50, offset = 0 } = req.query;

  try {
    logger.info(`[${requestId}] Fetching matches with filters`);

    const matches = await scraperService.getMatches({
      status,
      format,
      team,
      series,
      source,
      year,
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
// TEST ENDPOINT
// ============================================================

router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'API is working',
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
  });
});

module.exports = router;