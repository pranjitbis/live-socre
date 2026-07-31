const logger = require('../logger');
const { cache } = require('../cache');
const { getConnection } = require('../database');
const { LiveScraper, UpcomingScraper, FinishedScraper } = require('../scraper/crex');
const browserManager = require('../scraper/browser');

class ScraperService {
  constructor() {
    this.crexScrapers = {
      live: new LiveScraper(),
      upcoming: new UpcomingScraper(),
      finished: new FinishedScraper()
    };
    
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    logger.info('Initializing scraper service with CREX as primary source...');

    try {
      // Test CREX scrapers
      for (const [type, scraper] of Object.entries(this.crexScrapers)) {
        try {
          let testData;
          if (type === 'live') {
            testData = await scraper.scrapeLive();
            logger.info(`✅ CREX ${type} scraper working, found ${testData.data?.length || 0} matches`);
          } else if (type === 'upcoming') {
            testData = await scraper.scrapeUpcoming();
            logger.info(`✅ CREX ${type} scraper working, found ${testData.data?.length || 0} matches`);
          } else if (type === 'finished') {
            testData = await scraper.scrapeFinished();
            logger.info(`✅ CREX ${type} scraper working, found ${testData.data?.length || 0} matches`);
          }
        } catch (error) {
          logger.warn(`⚠️ CREX ${type} scraper test failed: ${error.message}`);
        }
      }

      // Pre-warm cache
      try {
        const liveResult = await this.crexScrapers.live.scrapeLive();
        if (liveResult && liveResult.data && liveResult.data.length > 0) {
          await cache.set('crex_live_matches', liveResult.data, 5);
          logger.info(`✅ Cache pre-warmed with ${liveResult.data.length} CREX live matches`);
        }

        const upcomingResult = await this.crexScrapers.upcoming.scrapeUpcoming();
        if (upcomingResult && upcomingResult.data && upcomingResult.data.length > 0) {
          await cache.set('crex_upcoming_matches', upcomingResult.data, 5);
          logger.info(`✅ Cache pre-warmed with ${upcomingResult.data.length} CREX upcoming matches`);
        }

        const finishedResult = await this.crexScrapers.finished.scrapeFinished();
        if (finishedResult && finishedResult.data && finishedResult.data.length > 0) {
          await cache.set('crex_finished_matches', finishedResult.data, 5);
          logger.info(`✅ Cache pre-warmed with ${finishedResult.data.length} CREX finished matches`);
        }
      } catch (error) {
        logger.warn('⚠️ Failed to pre-warm cache:', error.message);
      }

      logger.info('✅ Cache pre-warmed successfully');
    } catch (error) {
      logger.error('Failed to pre-warm cache:', error);
    }

    this.initialized = true;
    logger.info('✅ Scraper service initialized with CREX as primary source');
  }

  async shutdown() {
    logger.info('Shutting down scraper service...');

    for (const [type, scraper] of Object.entries(this.crexScrapers)) {
      if (scraper.closeBrowser && typeof scraper.closeBrowser === 'function') {
        try {
          await scraper.closeBrowser();
          logger.info(`✅ CREX ${type} scraper closed`);
        } catch (error) {
          logger.warn(`⚠️ Error closing CREX ${type} scraper:`, error.message);
        }
      }
    }

    this.initialized = false;
    logger.info('✅ Scraper service shut down');
  }

  async cleanup() {
    logger.info('Cleaning up scraper service...');
    
    for (const [type, scraper] of Object.entries(this.crexScrapers)) {
      if (scraper.closeBrowser && typeof scraper.closeBrowser === 'function') {
        try {
          await scraper.closeBrowser();
          logger.info(`✅ CREX ${type} scraper cleaned up`);
        } catch (error) {
          logger.warn(`⚠️ Error cleaning up CREX ${type} scraper:`, error.message);
        }
      }
      if (scraper.cleanup && typeof scraper.cleanup === 'function') {
        try {
          await scraper.cleanup();
          logger.info(`✅ CREX ${type} scraper cleanup completed`);
        } catch (error) {
          logger.warn(`⚠️ Error in CREX ${type} cleanup:`, error.message);
        }
      }
    }
    
    logger.info('✅ Cleanup completed');
  }

  // ============================================================
  // CREX SCRAPE METHODS - COMPLETELY REWRITTEN
  // ============================================================

  async scrapeLive() {
    const startTime = Date.now();
    logger.info('🔴 Scraping live matches from CREX...');

    try {
      // Ensure browser is ready
      await browserManager.launch();
      
      // Get the scraper instance
      const scraper = this.crexScrapers.live;
      
      // Call the scrape method
      const result = await scraper.scrapeLive();
      
      // Log detailed result for debugging
      logger.info(`📊 Live scraper response:`, {
        success: result?.success === true,
        hasData: Array.isArray(result?.data),
        dataLength: result?.data?.length || 0,
        timestamp: result?.timestamp
      });
      
      // Check if the scraper was successful and has data
      if (result && result.success === true) {
        const matches = Array.isArray(result.data) ? result.data : [];
        
        logger.info(`✅ Live scraper returned ${matches.length} matches`);
        
        if (matches.length > 0) {
          // Store in database
          try {
            await this.storeMatches(matches.map(m => ({ ...m, source: 'crex-live' })));
            logger.info(`✅ Stored ${matches.length} matches in database`);
          } catch (dbError) {
            logger.warn(`⚠️ Database storage failed: ${dbError.message}`);
          }
          
          // Update cache
          try {
            await cache.set('crex_live_matches', matches, 5);
            logger.info(`✅ Cached ${matches.length} matches`);
          } catch (cacheError) {
            logger.warn(`⚠️ Cache update failed: ${cacheError.message}`);
          }
          
          const duration = Date.now() - startTime;
          logger.info(`✅ Successfully got ${matches.length} live matches from CREX in ${duration}ms`);
          
          // Return success response
          return {
            success: true,
            source: 'crex',
            type: 'live',
            total: matches.length,
            data: matches,
            timestamp: result.timestamp || new Date().toISOString()
          };
        } else {
          // No matches found but scraper was successful
          logger.info('No live matches from CREX');
          return {
            success: true,
            source: 'crex',
            type: 'live',
            total: 0,
            data: [],
            timestamp: new Date().toISOString(),
            message: 'No live matches currently in progress'
          };
        }
      }
      
      // If we reach here, the scraper returned an error response
      logger.warn('Live scraper returned error response:', {
        success: result?.success,
        error: result?.error,
        message: result?.message
      });
      
      return {
        success: false,
        source: 'crex',
        type: 'live',
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        error: result?.error || 'Scraper returned error response'
      };
      
    } catch (error) {
      // Catch any unexpected errors
      logger.error(`CREX live scraper failed with error:`, error.message);
      logger.error(error.stack);
      
      return {
        success: false,
        source: 'crex',
        type: 'live',
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }

  async scrapeUpcoming() {
    const startTime = Date.now();
    logger.info('📅 Scraping upcoming matches from CREX...');

    try {
      await browserManager.launch();
      
      const scraper = this.crexScrapers.upcoming;
      const result = await scraper.scrapeUpcoming();
      
      logger.info(`📊 Upcoming scraper response:`, {
        success: result?.success === true,
        hasData: Array.isArray(result?.data),
        dataLength: result?.data?.length || 0
      });
      
      if (result && result.success === true) {
        const matches = Array.isArray(result.data) ? result.data : [];
        
        if (matches.length > 0) {
          try {
            await this.storeMatches(matches.map(m => ({ ...m, source: 'crex-upcoming' })));
            await cache.set('crex_upcoming_matches', matches, 5);
          } catch (e) {
            logger.warn(`⚠️ Storage error: ${e.message}`);
          }
          
          const duration = Date.now() - startTime;
          logger.info(`✅ Got ${matches.length} upcoming matches from CREX in ${duration}ms`);
          
          return {
            success: true,
            source: 'crex',
            type: 'upcoming',
            total: matches.length,
            data: matches,
            timestamp: result.timestamp || new Date().toISOString()
          };
        } else {
          logger.info('No upcoming matches from CREX');
          return {
            success: true,
            source: 'crex',
            type: 'upcoming',
            total: 0,
            data: [],
            timestamp: new Date().toISOString(),
            message: 'No upcoming matches found'
          };
        }
      }
      
      return {
        success: false,
        source: 'crex',
        type: 'upcoming',
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        error: result?.error || 'Scraper returned error response'
      };
      
    } catch (error) {
      logger.error(`CREX upcoming scraper failed:`, error.message);
      
      return {
        success: false,
        source: 'crex',
        type: 'upcoming',
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }

  async scrapeFinished() {
    const startTime = Date.now();
    logger.info('🏁 Scraping finished matches from CREX...');

    try {
      await browserManager.launch();
      
      const scraper = this.crexScrapers.finished;
      const result = await scraper.scrapeFinished();
      
      logger.info(`📊 Finished scraper response:`, {
        success: result?.success === true,
        hasData: Array.isArray(result?.data),
        dataLength: result?.data?.length || 0
      });
      
      if (result && result.success === true) {
        const matches = Array.isArray(result.data) ? result.data : [];
        
        if (matches.length > 0) {
          try {
            await this.storeMatches(matches.map(m => ({ ...m, source: 'crex-finished' })));
            await cache.set('crex_finished_matches', matches, 5);
          } catch (e) {
            logger.warn(`⚠️ Storage error: ${e.message}`);
          }
          
          const duration = Date.now() - startTime;
          logger.info(`✅ Got ${matches.length} finished matches from CREX in ${duration}ms`);
          
          return {
            success: true,
            source: 'crex',
            type: 'finished',
            total: matches.length,
            data: matches,
            timestamp: result.timestamp || new Date().toISOString()
          };
        } else {
          logger.info('No finished matches from CREX');
          return {
            success: true,
            source: 'crex',
            type: 'finished',
            total: 0,
            data: [],
            timestamp: new Date().toISOString(),
            message: 'No finished matches found'
          };
        }
      }
      
      return {
        success: false,
        source: 'crex',
        type: 'finished',
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        error: result?.error || 'Scraper returned error response'
      };
      
    } catch (error) {
      logger.error(`CREX finished scraper failed:`, error.message);
      
      return {
        success: false,
        source: 'crex',
        type: 'finished',
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }

  // ============================================================
  // SCRAPE ALL MATCH TYPES
  // ============================================================

  async scrapeAll() {
    const startTime = Date.now();
    logger.info('📊 Scraping all match types from CREX...');

    const results = {
      live: null,
      upcoming: null,
      finished: null,
      errors: []
    };

    try {
      results.live = await this.scrapeLive();
    } catch (error) {
      results.errors.push({ type: 'live', error: error.message });
    }

    try {
      results.upcoming = await this.scrapeUpcoming();
    } catch (error) {
      results.errors.push({ type: 'upcoming', error: error.message });
    }

    try {
      results.finished = await this.scrapeFinished();
    } catch (error) {
      results.errors.push({ type: 'finished', error: error.message });
    }

    const duration = Date.now() - startTime;
    
    const liveCount = results.live?.data?.length || 0;
    const upcomingCount = results.upcoming?.data?.length || 0;
    const finishedCount = results.finished?.data?.length || 0;
    
    logger.info(`✅ Scraped all matches in ${duration}ms`);
    logger.info(`  Live: ${liveCount}`);
    logger.info(`  Upcoming: ${upcomingCount}`);
    logger.info(`  Finished: ${finishedCount}`);
    logger.info(`  Total: ${liveCount + upcomingCount + finishedCount}`);

    return {
      success: true,
      source: 'crex',
      timestamp: new Date().toISOString(),
      total: liveCount + upcomingCount + finishedCount,
      data: {
        live: results.live,
        upcoming: results.upcoming,
        finished: results.finished
      },
      errors: results.errors.length > 0 ? results.errors : undefined
    };
  }

  // ============================================================
  // GET MATCH DETAILS
  // ============================================================

  async getMatchDetails(matchId) {
    try {
      const cached = await cache.get(`match_${matchId}`);
      if (cached) return cached;

      const db = getConnection();
      const [rows] = await db.query('SELECT * FROM matches WHERE id = ?', [matchId]);

      if (rows.length > 0) {
        const [details] = await db.query('SELECT * FROM match_details WHERE match_id = ?', [matchId]);

        const matchData = rows[0];
        if (details.length > 0) {
          matchData.details = details[0].details;
        }

        await cache.set(`match_${matchId}`, matchData, 3600);
        return matchData;
      }

      return null;
    } catch (error) {
      logger.error(`Error getting match details for ${matchId}:`, error);
      return null;
    }
  }

  // ============================================================
  // GET MATCHES WITH FILTERS
  // ============================================================

  async getMatches(filters = {}) {
    const db = getConnection();
    let query = 'SELECT * FROM matches WHERE 1=1';
    const params = [];

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.format) {
      query += ' AND match_type = ?';
      params.push(filters.format);
    }

    if (filters.team) {
      query += ' AND (team1 LIKE ? OR team2 LIKE ?)';
      params.push(`%${filters.team}%`, `%${filters.team}%`);
    }

    if (filters.series) {
      query += ' AND series LIKE ?';
      params.push(`%${filters.series}%`);
    }

    query += ' ORDER BY match_date DESC LIMIT 100';

    try {
      const [rows] = await db.query(query, params);
      return rows;
    } catch (error) {
      logger.error('Error getting matches:', error);
      return [];
    }
  }

  // ============================================================
  // GET SOURCE STATUS
  // ============================================================

  async getSourceStatus() {
    const browserStats = browserManager.getStats ? browserManager.getStats() : {};
    
    const status = {
      primary: {
        source: 'crex',
        enabled: true,
        types: {
          live: { enabled: true, lastCheck: new Date().toISOString() },
          upcoming: { enabled: true, lastCheck: new Date().toISOString() },
          finished: { enabled: true, lastCheck: new Date().toISOString() }
        }
      },
      initialized: this.initialized,
      browser: {
        ready: browserManager.isReady || false,
        stats: browserStats
      }
    };

    return status;
  }

  // ============================================================
  // FORCE SCRAPE
  // ============================================================

  async forceScrape(options = {}) {
    const { type } = options;

    if (type === 'live') {
      return await this.scrapeLive();
    } else if (type === 'upcoming') {
      return await this.scrapeUpcoming();
    } else if (type === 'finished') {
      return await this.scrapeFinished();
    } else {
      return await this.scrapeAll();
    }
  }

  // ============================================================
  // DATABASE STORAGE METHODS
  // ============================================================

  async storeMatches(matches) {
    if (!matches || matches.length === 0) return;
    const db = getConnection();

    for (const match of matches) {
      await this.storeMatch(match);
    }
  }

  async storeMatch(match) {
    const db = getConnection();

    try {
      const query = `
        INSERT INTO matches (
          id, title, match_type, status, venue, team1, team2, 
          score1, score2, result, match_date, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          match_type = VALUES(match_type),
          status = VALUES(status),
          venue = VALUES(venue),
          team1 = VALUES(team1),
          team2 = VALUES(team2),
          score1 = VALUES(score1),
          score2 = VALUES(score2),
          result = VALUES(result),
          match_date = VALUES(match_date),
          source = VALUES(source),
          updated_at = CURRENT_TIMESTAMP
      `;

      const matchId = match.match_id || match.matchId || `match_${Date.now()}`;
      
      const title = match.matchTitle || match.series?.name || '';
      const matchType = match.match?.format || match.format || 'T20I';
      const status = match.match?.status || match.status || 'Unknown';
      const venue = match.venue?.name || match.venue || '';
      const team1 = match.teams?.home?.name || match.team1?.name || '';
      const team2 = match.teams?.away?.name || match.team2?.name || '';
      const score1 = match.scoreboard?.batting_team?.score || match.team1?.score || '';
      const score2 = match.scoreboard?.bowling_team?.score || match.team2?.score || '';
      const result = match.result || '';
      const matchDate = match.match?.start_time || match.startTime || null;
      const source = match.source || 'crex';

      await db.query(query, [
        matchId,
        title,
        matchType,
        status,
        venue,
        team1,
        team2,
        score1,
        score2,
        result,
        matchDate,
        source
      ]);

      const detailsQuery = `
        INSERT INTO match_details (id, match_id, details)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          details = VALUES(details),
          updated_at = CURRENT_TIMESTAMP
      `;

      await db.query(detailsQuery, [
        `detail_${matchId}`,
        matchId,
        JSON.stringify(match),
      ]);
    } catch (error) {
      logger.error(`Error storing match ${match.match_id || match.matchId}:`, error.message);
    }
  }
}

// Singleton instance
const scraperService = new ScraperService();

module.exports = { scraperService, ScraperService };