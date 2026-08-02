// src/services/scraperService.js
const logger = require('../logger');
const { cache } = require('../cache');
const { getConnection } = require('../database');
const {
  LiveScraper,
  UpcomingScraper,
  FinishedScraper,
  PreviousMatchesScraper,
  TeamMatchesScraper,
} = require('../scraper/crex');
const { PreviousScraper } = require('../scraper/espn');
const { CricbuzzScraper, CricbuzzArchiveScraper } = require('../scraper/cricbuzz');
const browserManager = require('../scraper/browser');

class ScraperService {
  constructor() {
    this.crexScrapers = {
      live: null,
      upcoming: null,
      finished: null,
      previous: null,
      team: null,
    };

    this.espnScraper = null;
    this.cricbuzzScraper = null;
    this.cricbuzzArchiveScraper = null;
    this.initialized = false;
    this.browserReady = false;
    this.maxRetries = 3;

    // Lock management
    this.isScraping = false;
    this.scrapeLockTimeout = 60000;
    this.scrapeStartTime = null;
    this.lastScrapeResult = null;
    this.lastScrapeTime = null;
  }

  // ============================================================
  // LAZY LOAD SCRAPERS
  // ============================================================
  getScraper(type) {
    if (!this.crexScrapers[type]) {
      switch (type) {
        case 'live':
          this.crexScrapers.live = new LiveScraper();
          break;
        case 'upcoming':
          this.crexScrapers.upcoming = new UpcomingScraper();
          break;
        case 'finished':
          this.crexScrapers.finished = new FinishedScraper();
          break;
        case 'previous':
          this.crexScrapers.previous = new PreviousMatchesScraper();
          break;
        case 'team':
          this.crexScrapers.team = new TeamMatchesScraper();
          break;
        default:
          throw new Error(`Unknown scraper type: ${type}`);
      }
    }
    return this.crexScrapers[type];
  }

  getEspnScraper() {
    if (!this.espnScraper) {
      this.espnScraper = new PreviousScraper();
    }
    return this.espnScraper;
  }

  getCricbuzzScraper() {
    if (!this.cricbuzzScraper) {
      this.cricbuzzScraper = new CricbuzzScraper();
    }
    return this.cricbuzzScraper;
  }

  getCricbuzzArchiveScraper() {
    if (!this.cricbuzzArchiveScraper) {
      this.cricbuzzArchiveScraper = new CricbuzzArchiveScraper();
    }
    return this.cricbuzzArchiveScraper;
  }

  // ============================================================
  // INITIALIZE SERVICES
  // ============================================================
  async initialize() {
    if (this.initialized) return;

    logger.info('Initializing scraper service...');

    try {
      try {
        await browserManager.healthCheck();
        this.browserReady = true;
        logger.info('✅ Browser manager is ready');
      } catch (error) {
        logger.warn('⚠️ Browser manager not ready, will initialize on demand:', error.message);
        this.browserReady = false;
      }

      try {
        if (cache && typeof cache.get === 'function') {
          const liveMatches = await cache.get('crex_live_matches');
          if (liveMatches && liveMatches.length > 0) {
            logger.info(`✅ Cache has ${liveMatches.length} live matches`);
          }
        } else {
          logger.warn('⚠️ Cache not available');
        }
      } catch (error) {
        logger.warn('⚠️ Cache check failed:', error.message);
      }

      logger.info('✅ Scraper service initialized');
    } catch (error) {
      logger.error('Failed to initialize scraper service:', error);
    }

    this.initialized = true;
  }

  // ============================================================
  // ENSURE BROWSER IS READY
  // ============================================================
  async ensureBrowser() {
    if (this.browserReady) return true;

    let attempts = 0;
    while (attempts < this.maxRetries) {
      try {
        logger.info(
          `🔄 Attempting to start browser (attempt ${attempts + 1}/${this.maxRetries})...`
        );
        await browserManager.launch();
        this.browserReady = true;
        logger.info('✅ Browser started successfully');
        return true;
      } catch (error) {
        attempts++;
        logger.warn(`⚠️ Browser start attempt ${attempts} failed: ${error.message}`);
        if (attempts < this.maxRetries) {
          const waitTime = 2000 * attempts;
          logger.info(`⏳ Waiting ${waitTime}ms before retry...`);
          await this.sleep(waitTime);
        }
      }
    }

    logger.error('❌ Failed to start browser after multiple attempts');
    return false;
  }

  // ============================================================
  // SLEEP
  // ============================================================
  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================
  // CHECK AND RELEASE STALE LOCK
  // ============================================================
  checkAndReleaseStaleLock() {
    if (this.isScraping && this.scrapeStartTime) {
      const elapsed = Date.now() - this.scrapeStartTime;
      if (elapsed > this.scrapeLockTimeout) {
        logger.warn(`⚠️ Stale scrape lock detected (${elapsed}ms), releasing...`);
        this.isScraping = false;
        this.scrapeStartTime = null;
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // SAFE CACHE SET
  // ============================================================
  async safeCacheSet(key, value, ttl = 300) {
    try {
      if (cache && typeof cache.set === 'function') {
        await cache.set(key, value, ttl);
        return true;
      }
      logger.warn(`⚠️ Cache not available for set: ${key}`);
      return false;
    } catch (error) {
      logger.warn(`⚠️ Cache set failed for ${key}:`, error.message);
      return false;
    }
  }

  // ============================================================
  // SAFE CACHE GET
  // ============================================================
  async safeCacheGet(key) {
    try {
      if (cache && typeof cache.get === 'function') {
        return await cache.get(key);
      }
      return null;
    } catch (error) {
      logger.warn(`⚠️ Cache get failed for ${key}:`, error.message);
      return null;
    }
  }

  // ============================================================
  // SCRAPE LIVE MATCHES
  // ============================================================
  async scrapeLive(forceRefresh = true) {
    const startTime = Date.now();
    logger.info(`🔴 Scraping live matches from CREX (forceRefresh: ${forceRefresh})...`);

    // Check for stale lock
    this.checkAndReleaseStaleLock();

    // If scrape is in progress, return cached result
    if (this.isScraping) {
      logger.warn('⚠️ Scrape already in progress, returning cached result');

      if (this.lastScrapeResult && this.lastScrapeTime) {
        const age = Date.now() - this.lastScrapeTime;
        if (age < 10000) {
          logger.info(`📊 Returning cached result (${age}ms old)`);
          return this.lastScrapeResult;
        }
      }

      return {
        success: true,
        source: 'crex',
        type: 'live',
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        message: 'Scrape in progress, returning empty',
        cached: false,
      };
    }

    // Acquire lock
    this.isScraping = true;
    this.scrapeStartTime = Date.now();

    try {
      const browserOk = await this.ensureBrowser();
      if (!browserOk) {
        this.isScraping = false;
        this.scrapeStartTime = null;
        throw new Error('Browser failed to start');
      }

      const scraper = this.getScraper('live');
      const result = await scraper.scrapeLive(forceRefresh);

      // Store result for caching
      this.lastScrapeResult = result;
      this.lastScrapeTime = Date.now();

      if (result && result.data !== undefined && result.data !== null) {
        const matches = Array.isArray(result.data) ? result.data : [];

        if (matches.length > 0) {
          // Store in database
          this.storeMatches(matches.map((m) => ({ ...m, source: 'crex-live' }))).catch((err) =>
            logger.warn(`⚠️ Database storage failed: ${err.message}`)
          );

          await this.safeCacheSet('crex_live_matches', matches, 30);

          const duration = Date.now() - startTime;
          logger.info(
            `✅ Successfully got ${matches.length} live matches from CREX in ${duration}ms`
          );

          this.isScraping = false;
          this.scrapeStartTime = null;
          return {
            success: true,
            source: 'crex',
            type: 'live',
            total: matches.length,
            data: matches,
            timestamp: result.timestamp || new Date().toISOString(),
            duration: duration,
            cacheBuster: result.cacheBuster || Date.now(),
          };
        } else {
          logger.info('No live matches from CREX');
          this.isScraping = false;
          this.scrapeStartTime = null;
          return {
            success: true,
            source: 'crex',
            type: 'live',
            total: 0,
            data: [],
            timestamp: new Date().toISOString(),
            message: 'No live matches currently in progress',
          };
        }
      }

      this.isScraping = false;
      this.scrapeStartTime = null;
      return {
        success: false,
        source: 'crex',
        type: 'live',
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        error: result?.error || 'Scraper returned error response',
      };
    } catch (error) {
      logger.error(`CREX live scraper failed:`, error.message);
      logger.error(error.stack);

      this.isScraping = false;
      this.scrapeStartTime = null;
      return {
        success: false,
        source: 'crex',
        type: 'live',
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        error: error.message,
      };
    }
  }

  // ============================================================
  // SCRAPE UPCOMING MATCHES
  // ============================================================
  async scrapeUpcoming() {
    const startTime = Date.now();
    logger.info('📅 Scraping upcoming matches from CREX...');

    try {
      const browserOk = await this.ensureBrowser();
      if (!browserOk) {
        throw new Error('Browser failed to start');
      }

      const scraper = this.getScraper('upcoming');
      const result = await scraper.scrapeUpcoming();

      if (result && result.data !== undefined && result.data !== null) {
        const matches = Array.isArray(result.data) ? result.data : [];

        if (matches.length > 0) {
          this.storeMatches(matches.map((m) => ({ ...m, source: 'crex-upcoming' }))).catch((err) =>
            logger.warn(`⚠️ Database storage failed: ${err.message}`)
          );

          await this.safeCacheSet('crex_upcoming_matches', matches, 300);

          const duration = Date.now() - startTime;
          logger.info(`✅ Got ${matches.length} upcoming matches from CREX in ${duration}ms`);

          return {
            success: true,
            source: 'crex',
            type: 'upcoming',
            total: matches.length,
            data: matches,
            timestamp: result.timestamp || new Date().toISOString(),
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
            message: 'No upcoming matches found',
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
        error: result?.error || 'Scraper returned error response',
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
        error: error.message,
      };
    }
  }

  // ============================================================
  // SCRAPE FINISHED MATCHES
  // ============================================================
  async scrapeFinished() {
    const startTime = Date.now();
    logger.info('🏁 Scraping finished matches from CREX...');

    try {
      const browserOk = await this.ensureBrowser();
      if (!browserOk) {
        throw new Error('Browser failed to start');
      }

      const scraper = this.getScraper('finished');
      const result = await scraper.scrapeFinished();

      if (result && result.data !== undefined && result.data !== null) {
        const matches = Array.isArray(result.data) ? result.data : [];

        if (matches.length > 0) {
          this.storeMatches(matches.map((m) => ({ ...m, source: 'crex-finished' }))).catch((err) =>
            logger.warn(`⚠️ Database storage failed: ${err.message}`)
          );

          await this.safeCacheSet('crex_finished_matches', matches, 300);

          const duration = Date.now() - startTime;
          logger.info(`✅ Got ${matches.length} finished matches from CREX in ${duration}ms`);

          return {
            success: true,
            source: 'crex',
            type: 'finished',
            total: matches.length,
            data: matches,
            timestamp: result.timestamp || new Date().toISOString(),
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
            message: 'No finished matches found',
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
        error: result?.error || 'Scraper returned error response',
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
        error: error.message,
      };
    }
  }

  // ============================================================
  // SCRAPE PREVIOUS MATCHES
  // ============================================================
  async scrapePreviousMatches() {
    const startTime = Date.now();
    logger.info('📜 Scraping previous matches from CREX...');

    try {
      const browserOk = await this.ensureBrowser();
      if (!browserOk) {
        throw new Error('Browser failed to start');
      }

      const scraper = this.getScraper('previous');
      const result = await scraper.scrapePreviousMatches();

      if (result && result.data !== undefined && result.data !== null) {
        const matches = Array.isArray(result.data) ? result.data : [];

        if (matches.length > 0) {
          this.storeMatches(matches.map((m) => ({ ...m, source: 'crex-previous' }))).catch((err) =>
            logger.warn(`⚠️ Database storage failed: ${err.message}`)
          );

          await this.safeCacheSet('crex_previous_matches', matches, 300);

          const duration = Date.now() - startTime;
          logger.info(`✅ Got ${matches.length} previous matches from CREX in ${duration}ms`);

          return {
            success: true,
            source: 'crex',
            type: 'previous',
            total: matches.length,
            data: matches,
            timestamp: result.timestamp || new Date().toISOString(),
          };
        } else {
          logger.info('No previous matches from CREX');
          return {
            success: true,
            source: 'crex',
            type: 'previous',
            total: 0,
            data: [],
            timestamp: new Date().toISOString(),
            message: 'No previous matches found',
          };
        }
      }

      return {
        success: false,
        source: 'crex',
        type: 'previous',
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        error: result?.error || 'Scraper returned error response',
      };
    } catch (error) {
      logger.error(`CREX previous matches scraper failed:`, error.message);
      return {
        success: false,
        source: 'crex',
        type: 'previous',
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        error: error.message,
      };
    }
  }

  // ============================================================
  // SCRAPE TEAM MATCHES
  // ============================================================
  async scrapeTeamMatches(teamName = 'services-GR') {
    const startTime = Date.now();
    logger.info(`📋 Scraping team matches for: ${teamName}`);

    try {
      const browserOk = await this.ensureBrowser();
      if (!browserOk) {
        throw new Error('Browser failed to start');
      }

      const scraper = this.getScraper('team');
      const result = await scraper.scrapeTeamMatches(teamName);

      if (result && result.data && result.data.length > 0) {
        this.storeMatches(result.data.map((m) => ({ ...m, source: 'crex-team' }))).catch((err) =>
          logger.warn(`⚠️ Database storage failed: ${err.message}`)
        );

        await this.safeCacheSet(`team_matches_${teamName}`, result.data, 300);

        const duration = Date.now() - startTime;
        logger.info(`✅ Got ${result.data.length} matches for team ${teamName} in ${duration}ms`);

        return {
          success: true,
          source: 'crex',
          type: 'team',
          team: teamName,
          total: result.data.length,
          data: result.data,
          timestamp: result.timestamp || new Date().toISOString(),
        };
      }

      logger.info(`No matches found for team: ${teamName}`);
      return {
        success: true,
        source: 'crex',
        type: 'team',
        team: teamName,
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        message: 'No matches found for this team',
      };
    } catch (error) {
      logger.error(`Team matches scraper failed for ${teamName}:`, error.message);
      return {
        success: false,
        source: 'crex',
        type: 'team',
        team: teamName,
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        error: error.message,
      };
    }
  }

  // ============================================================
  // DATABASE STORAGE METHODS
  // ============================================================
  async storeMatches(matches) {
    if (!matches || matches.length === 0) return;
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
          score1, score2, result, match_date, source, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
          updated_at = NOW()
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
        source,
      ]);

      const detailsQuery = `
        INSERT INTO match_details (id, match_id, details)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          details = VALUES(details),
          updated_at = NOW()
      `;

      await db.query(detailsQuery, [`detail_${matchId}`, matchId, JSON.stringify(match)]);
    } catch (error) {
      logger.error(`Error storing match ${match.match_id || match.matchId}:`, error.message);
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

    if (filters.source) {
      query += ' AND source = ?';
      params.push(filters.source);
    }

    query += ' ORDER BY match_date DESC LIMIT ? OFFSET ?';
    params.push(filters.limit || 50);
    params.push(filters.offset || 0);

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
      sources: {
        crex: {
          enabled: true,
          types: {
            live: { enabled: true, lastCheck: new Date().toISOString() },
            upcoming: { enabled: true, lastCheck: new Date().toISOString() },
            finished: { enabled: true, lastCheck: new Date().toISOString() },
            previous: { enabled: true, lastCheck: new Date().toISOString() },
            team: { enabled: true, lastCheck: new Date().toISOString() },
          },
        },
        espncricinfo: {
          enabled: true,
          types: {
            previous: { enabled: true, lastCheck: new Date().toISOString() },
          },
        },
        cricbuzz: {
          enabled: true,
          types: {
            live: { enabled: true, lastCheck: new Date().toISOString() },
            archive: { enabled: true, lastCheck: new Date().toISOString() },
          },
        },
      },
      initialized: this.initialized,
      browser: {
        ready: this.browserReady || false,
        stats: browserStats,
      },
      isScraping: this.isScraping,
      lastScrapeTime: this.lastScrapeTime,
    };

    return status;
  }

  // ============================================================
  // FORCE RELEASE LOCK
  // ============================================================
  forceReleaseLock() {
    if (this.isScraping) {
      logger.warn('🔓 Force releasing scrape lock');
      this.isScraping = false;
      this.scrapeStartTime = null;
      return true;
    }
    return false;
  }

  // ============================================================
  // START REAL-TIME UPDATES
  // ============================================================
  async startRealTimeUpdates(options = {}) {
    const { interval = 5000, onMatchUpdate, onMatchComplete, onNewMatch } = options;

    const liveScraper = this.getScraper('live');

    return await liveScraper.startRealTimeUpdates({
      interval: interval,
      onUpdate: onMatchUpdate,
      onComplete: onMatchComplete,
      onNewMatch: onNewMatch,
    });
  }

  // ============================================================
  // STOP REAL-TIME UPDATES
  // ============================================================
  stopRealTimeUpdates() {
    const liveScraper = this.getScraper('live');
    return liveScraper.stopRealTimeUpdates();
  }

  // ============================================================
  // GET REAL-TIME STATUS
  // ============================================================
  getRealTimeStatus() {
    const liveScraper = this.getScraper('live');
    const activeMatches = liveScraper.activeMatches || new Map();

    const matches = [];
    for (const [matchId, matchData] of activeMatches) {
      const match = matchData.data;
      const age = (Date.now() - matchData.lastUpdate) / 1000;

      matches.push({
        matchId: matchId,
        homeTeam: match.teams?.home?.name || 'Unknown',
        awayTeam: match.teams?.away?.name || 'Unknown',
        score: match.scoreboard?.batting_team?.score || '0',
        wickets: match.scoreboard?.batting_team?.wickets || '0',
        overs: match.scoreboard?.batting_team?.overs || '0',
        status: match.match?.status || 'Live',
        lastUpdate: matchData.lastUpdate,
        ageSeconds: age,
        isComplete: matchData.isComplete || false,
      });
    }

    return {
      isPolling: liveScraper.isPolling || false,
      activeMatches: matches,
      totalMatches: matches.length,
    };
  }

  // ============================================================
  // CLEANUP
  // ============================================================
  async cleanup() {
    logger.info('🧹 Cleaning up scraper service...');

    // Force release lock
    this.forceReleaseLock();

    // Stop real-time updates
    this.stopRealTimeUpdates();

    // Close CREX scrapers
    for (const [type, scraper] of Object.entries(this.crexScrapers)) {
      if (scraper) {
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
    }

    // Reset scrapers
    this.crexScrapers = {
      live: null,
      upcoming: null,
      finished: null,
      previous: null,
      team: null,
    };

    // Close browser
    try {
      await browserManager.close();
      this.browserReady = false;
      logger.info('✅ Browser closed during cleanup');
    } catch (error) {
      logger.warn('⚠️ Error closing browser during cleanup:', error.message);
    }

    logger.info('✅ Cleanup completed');
  }
}

// Singleton instance
const scraperService = new ScraperService();

module.exports = { scraperService, ScraperService };
