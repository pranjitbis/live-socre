// src/services/scraperService.js
const logger = require('../logger');
const { cache } = require('../cache');
const { getConnection } = require('../database');
const { LiveScraper, UpcomingScraper, FinishedScraper } = require('../scraper/crex');
const browserManager = require('../scraper/browser');

class ScraperService {
  constructor() {
    // ⭐ CRITICAL: Pass browser manager to scrapers
    this.browserManager = browserManager;
    
    // ⭐ Create scrapers with shared browser manager
    this.crexScrapers = {
      live: new LiveScraper(),
      upcoming: new UpcomingScraper(),
      finished: new FinishedScraper(),
    };

    this.initialized = false;
    
    // Lock management
    this.isScraping = {
      live: false,
      upcoming: false,
      finished: false,
    };
    this.scrapeLockTime = {
      live: null,
      upcoming: null,
      finished: null,
    };
    
    // Active promises for sharing concurrent scrape requests
    this.activePromises = {
      live: null,
      upcoming: null,
      finished: null,
    };
    
    this.lastScrapeResult = {
      live: null,
      upcoming: null,
      finished: null,
    };
    this.lastScrapeTime = {
      live: null,
      upcoming: null,
      finished: null,
    };

    // Retry configuration
    this.maxRetries = 2;
    this.retryDelay = 1000;
    this.debugMode = true;
    
    // Lock timeout (120 seconds)
    this.lockTimeout = 120000;
    
    // Cache TTL
    this.cacheTTL = 60;
    
    // Last successful data
    this.lastSuccessData = {
      live: null,
      upcoming: null,
      finished: null,
    };
    this.lastSuccessTime = {
      live: null,
      upcoming: null,
      finished: null,
    };
  }

  // ============================================================
  // ⭐ FORCE RELEASE ALL LOCKS
  // ============================================================
  forceReleaseLock(type = 'all') {
    const types = type === 'all' ? ['live', 'upcoming', 'finished'] : [type];
    let released = false;

    for (const t of types) {
      if (this.isScraping[t] || this.activePromises[t]) {
        const lockAge = this.scrapeLockTime[t] ? Date.now() - this.scrapeLockTime[t] : 0;
        logger.warn(`🔓 Force releasing ${t} scrape lock (age: ${Math.round(lockAge/1000)}s)`);
        this.isScraping[t] = false;
        this.scrapeLockTime[t] = null;
        this.activePromises[t] = null;
        released = true;
      }
    }
    
    // Also release lock in LiveScraper instance
    if (this.crexScrapers && this.crexScrapers.live) {
      try {
        if (typeof this.crexScrapers.live.forceReleaseLock === 'function') {
          this.crexScrapers.live.forceReleaseLock();
        }
        if (typeof this.crexScrapers.live.ensureLockReleased === 'function') {
          this.crexScrapers.live.ensureLockReleased();
        }
      } catch (e) {}
    }
    
    return released;
  }

  // ============================================================
  // ⭐ CHECK AND RELEASE STALE LOCKS
  // ============================================================
  checkAndReleaseStaleLocks() {
    const now = Date.now();
    let released = false;
    
    for (const [type, isScraping] of Object.entries(this.isScraping)) {
      if (isScraping && this.scrapeLockTime[type]) {
        const lockAge = now - this.scrapeLockTime[type];
        if (lockAge > this.lockTimeout) {
          logger.warn(`⚠️ Stale ${type} lock detected (${Math.round(lockAge/1000)}s old), releasing...`);
          this.isScraping[type] = false;
          this.scrapeLockTime[type] = null;
          this.activePromises[type] = null;
          released = true;
        }
      }
    }
    
    return released;
  }

  // ============================================================
  // ⭐ GET CACHED OR LAST SUCCESSFUL DATA
  // ============================================================
  async getCachedOrLastData(type) {
    // Try cache first
    try {
      const cached = await cache.get(`crex_${type}_matches`);
      if (cached) {
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        if (parsed && parsed.length > 0) {
          logger.info(`📊 Returning cached ${type} data (${parsed.length} matches)`);
          return {
            success: true,
            source: 'crex',
            type: type,
            total: parsed.length,
            data: parsed,
            fromCache: true,
            timestamp: new Date().toISOString(),
          };
        }
      }
    } catch (e) {}
    
    // Try last successful data
    if (this.lastSuccessData[type] && this.lastSuccessTime[type]) {
      const age = Date.now() - this.lastSuccessTime[type];
      if (age < 120000) { // 2 minutes
        logger.info(`📊 Returning last successful ${type} data (${this.lastSuccessData[type].length} matches, ${Math.round(age/1000)}s old)`);
        return {
          success: true,
          source: 'crex',
          type: type,
          total: this.lastSuccessData[type].length,
          data: this.lastSuccessData[type],
          fromCache: true,
          timestamp: new Date().toISOString(),
        };
      }
    }
    
    return null;
  }

  // ============================================================
  // ⭐ INITIALIZE - SINGLE BROWSER
  // ============================================================
  async initialize() {
    if (this.initialized) return;

    logger.info('Initializing scraper service with CREX as primary source...');

    try {
      // ⭐ Launch SINGLE browser instance
      await this.browserManager.launch();
      logger.info('✅ Single browser manager initialized');

      // Test CREX scrapers
      for (const [type, scraper] of Object.entries(this.crexScrapers)) {
        try {
          let testData;
          logger.info(`🔍 Testing CREX ${type} scraper...`);
          
          if (type === 'live') {
            testData = await scraper.scrapeLive(true);
            const count = testData?.data?.length || 0;
            logger.info(`✅ CREX ${type} scraper test complete: ${count} matches found`);
          } else if (type === 'upcoming') {
            testData = await scraper.scrapeUpcoming(true);
            const count = testData?.data?.length || 0;
            logger.info(`✅ CREX ${type} scraper test complete: ${count} matches found`);
          } else if (type === 'finished') {
            testData = await scraper.scrapeFinished(true);
            const count = testData?.data?.length || 0;
            logger.info(`✅ CREX ${type} scraper test complete: ${count} matches found`);
          }
        } catch (error) {
          logger.warn(`⚠️ CREX ${type} scraper test failed: ${error.message}`);
        }
      }

      // Pre-warm cache
      try {
        logger.info('🔄 Pre-warming cache...');
        
        const liveResult = await this.scrapeLiveWithRetry(true);
        if (liveResult && liveResult.success && liveResult.data && liveResult.data.length > 0) {
          try {
            await cache.set('crex_live_matches', JSON.stringify(liveResult.data), this.cacheTTL);
          } catch (e) {}
          logger.info(`✅ Cache pre-warmed with ${liveResult.data.length} CREX live matches`);
          this.lastSuccessData.live = liveResult.data;
          this.lastSuccessTime.live = Date.now();
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

  // ============================================================
  // ⭐ RETRY WRAPPER
  // ============================================================
  async scrapeWithRetry(scraperFn, type, forceRefresh = true) {
    let lastError = null;
    let lastResult = null;

    // If not forceRefresh, try cached data first
    if (!forceRefresh) {
      const cached = await this.getCachedOrLastData(type);
      if (cached) {
        return cached;
      }
    }

    // Check and release stale locks
    this.checkAndReleaseStaleLocks();

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Ensure LiveScraper internal lock is released so it doesn't block the retry
        if (this.crexScrapers && this.crexScrapers[type] && typeof this.crexScrapers[type].ensureLockReleased === 'function') {
          try {
            await this.crexScrapers[type].ensureLockReleased();
          } catch (e) {}
        }

        // Set lock with timestamp
        this.isScraping[type] = true;
        this.scrapeLockTime[type] = Date.now();

        logger.info(`🔄 ${type} scrape attempt ${attempt}/${this.maxRetries}`);

        // Ensure SINGLE browser is ready
        try {
          await this.browserManager.launch();
        } catch (browserError) {
          logger.warn(`⚠️ Browser launch failed: ${browserError.message}`);
          await this.browserManager.close();
          await this.browserManager.launch();
        }

        // Add small delay before scraping
        await this.sleep(500);

        const result = await scraperFn(forceRefresh);
        lastResult = result;

        if (this.debugMode) {
          logger.debug(`   Result: success=${result.success}, total=${result.total || 0}, data=${result.data?.length || 0}`);
          if (result.error) {
            logger.debug(`   Error: ${result.error}`);
          }
        }

        // Release lock
        this.isScraping[type] = false;
        this.scrapeLockTime[type] = null;

        // If successful, store data
        if (result && result.success && result.data && result.data.length > 0) {
          this.lastSuccessData[type] = result.data;
          this.lastSuccessTime[type] = Date.now();
          
          try {
            await cache.set(`crex_${type}_matches`, JSON.stringify(result.data), this.cacheTTL);
          } catch (e) {}
          
          logger.info(`✅ ${type} scrape successful with ${result.data.length} matches`);
          return result;
        }

        // If successful but empty data
        if (result && result.success === true && (!result.data || result.data.length === 0)) {
          logger.info(`📢 ${type} scrape successful but no matches found`);
          
          const cached = await this.getCachedOrLastData(type);
          if (cached) {
            logger.info(`📊 Returning cached ${type} data (${cached.data.length} matches)`);
            return cached;
          }
          
          return result;
        }

        // If error, retry
        if (result && !result.success) {
          const errorMsg = result.error || result.message || 'Unknown error';
          logger.warn(`⚠️ ${type} scrape returned failure: ${errorMsg} (attempt ${attempt})`);
          lastError = new Error(errorMsg);
          
          if (attempt < this.maxRetries) {
            const delay = this.retryDelay * attempt;
            logger.info(`⏳ Retrying in ${delay}ms...`);
            await this.sleep(delay);
            continue;
          }
          
          const cached = await this.getCachedOrLastData(type);
          if (cached) {
            logger.info(`📊 Returning cached ${type} data after failure`);
            return cached;
          }
          
          return result;
        }

        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * attempt;
          logger.info(`⏳ Retrying in ${delay}ms...`);
          await this.sleep(delay);
          continue;
        }

        return result || { success: false, data: [] };
        
      } catch (error) {
        logger.error(`❌ ${type} scrape attempt ${attempt} failed:`, error.message);
        lastError = error;

        // Release lock on error
        this.isScraping[type] = false;
        this.scrapeLockTime[type] = null;

        // If browser issue, reinitialize
        if (error.message.includes('browser') || 
            error.message.includes('closed') ||
            error.message.includes('connection') ||
            error.message.includes('timeout')) {
          logger.info('🔄 Reinitializing browser...');
          try {
            await this.browserManager.close();
            await this.browserManager.launch();
          } catch (reinitError) {
            logger.error(`❌ Browser reinitialization failed: ${reinitError.message}`);
          }
        }

        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * attempt * 2;
          logger.info(`⏳ Retrying in ${delay}ms...`);
          await this.sleep(delay);
          continue;
        }
        
        const cached = await this.getCachedOrLastData(type);
        if (cached) {
          logger.info(`📊 Returning cached ${type} data after error`);
          return cached;
        }
      }
    }

    // Ensure lock is released
    this.isScraping[type] = false;
    this.scrapeLockTime[type] = null;

    logger.error(`❌ All ${this.maxRetries} ${type} scrape attempts failed`);
    
    // Return last successful data if available
    if (this.lastSuccessData[type] && this.lastSuccessTime[type]) {
      const age = Date.now() - this.lastSuccessTime[type];
      logger.info(`📊 Returning last successful ${type} data (${this.lastSuccessData[type].length} matches, ${Math.round(age/1000)}s old)`);
      return {
        success: true,
        source: 'crex',
        type: type,
        total: this.lastSuccessData[type].length,
        data: this.lastSuccessData[type],
        fromCache: true,
        timestamp: new Date().toISOString(),
        message: 'Using cached data (scrape failed)',
      };
    }
    
    return {
      success: false,
      source: 'crex',
      type: type,
      total: 0,
      data: [],
      timestamp: new Date().toISOString(),
      error: lastError ? lastError.message : 'All retries failed',
      fromCache: false,
      attempts: this.maxRetries,
      message: 'No cached data available. Please try again in a few seconds.',
    };
  }

  // ============================================================
  // SCRAPE METHODS WITH RETRY
  // ============================================================
  async scrapeLiveWithRetry(forceRefresh = true) {
    const startTime = Date.now();
    const requestId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    logger.info(`🔴 [${requestId}] Scraping live matches with retry...`);

    try {
      if (!this.crexScrapers.live) {
        logger.error('❌ Live scraper not initialized');
        return {
          success: false,
          source: 'crex',
          type: 'live',
          total: 0,
          data: [],
          timestamp: new Date().toISOString(),
          error: 'Live scraper not initialized',
          duration: Date.now() - startTime,
          requestId: requestId,
        };
      }

      const result = await this.scrapeWithRetry(
        (refresh) => this.crexScrapers.live.scrapeLive(refresh),
        'live',
        forceRefresh
      );

      this.lastScrapeResult.live = result;
      this.lastScrapeTime.live = Date.now();

      if (result && result.success && result.data && result.data.length > 0) {
        try {
          await cache.set('crex_live_matches', JSON.stringify(result.data), this.cacheTTL);
          logger.info(`📦 Cached ${result.data.length} live matches`);
        } catch (e) {
          logger.warn(`⚠️ Failed to cache live matches: ${e.message}`);
        }
        this.lastSuccessData.live = result.data;
        this.lastSuccessTime.live = Date.now();
      }

      return {
        ...result,
        duration: Date.now() - startTime,
        requestId: requestId,
        fromCache: false,
      };
    } catch (error) {
      logger.error(`❌ [${requestId}] Live scrape failed:`, error.message);
      
      this.isScraping.live = false;
      this.scrapeLockTime.live = null;
      
      const cached = await this.getCachedOrLastData('live');
      if (cached) {
        return cached;
      }
      
      return {
        success: false,
        source: 'crex',
        type: 'live',
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        error: error.message,
        duration: Date.now() - startTime,
        requestId: requestId,
        message: 'No cached data available. Please try again in a few seconds.',
      };
    }
  }

  async scrapeUpcomingWithRetry(forceRefresh = true) {
    const startTime = Date.now();
    const requestId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    logger.info(`📅 [${requestId}] Scraping upcoming matches with retry...`);

    try {
      const result = await this.scrapeWithRetry(
        (refresh) => this.crexScrapers.upcoming.scrapeUpcoming(refresh),
        'upcoming',
        forceRefresh
      );

      this.lastScrapeResult.upcoming = result;
      this.lastScrapeTime.upcoming = Date.now();

      if (result && result.success && result.data && result.data.length > 0) {
        try {
          await cache.set('crex_upcoming_matches', JSON.stringify(result.data), this.cacheTTL);
        } catch (e) {}
        this.lastSuccessData.upcoming = result.data;
        this.lastSuccessTime.upcoming = Date.now();
      }

      return {
        ...result,
        duration: Date.now() - startTime,
        requestId: requestId,
        fromCache: false,
      };
    } catch (error) {
      logger.error(`❌ [${requestId}] Upcoming scrape failed:`, error.message);
      this.isScraping.upcoming = false;
      this.scrapeLockTime.upcoming = null;
      
      const cached = await this.getCachedOrLastData('upcoming');
      if (cached) return cached;
      
      return {
        success: false,
        source: 'crex',
        type: 'upcoming',
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        error: error.message,
        duration: Date.now() - startTime,
        requestId: requestId,
      };
    }
  }

  async scrapeFinishedWithRetry(forceRefresh = true) {
    const startTime = Date.now();
    const requestId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    logger.info(`🏁 [${requestId}] Scraping finished matches with retry...`);

    try {
      const result = await this.scrapeWithRetry(
        (refresh) => this.crexScrapers.finished.scrapeFinished(refresh),
        'finished',
        forceRefresh
      );

      this.lastScrapeResult.finished = result;
      this.lastScrapeTime.finished = Date.now();

      if (result && result.success && result.data && result.data.length > 0) {
        try {
          await cache.set('crex_finished_matches', JSON.stringify(result.data), this.cacheTTL);
        } catch (e) {}
        this.lastSuccessData.finished = result.data;
        this.lastSuccessTime.finished = Date.now();
      }

      return {
        ...result,
        duration: Date.now() - startTime,
        requestId: requestId,
        fromCache: false,
      };
    } catch (error) {
      logger.error(`❌ [${requestId}] Finished scrape failed:`, error.message);
      this.isScraping.finished = false;
      this.scrapeLockTime.finished = null;
      
      const cached = await this.getCachedOrLastData('finished');
      if (cached) return cached;
      
      return {
        success: false,
        source: 'crex',
        type: 'finished',
        total: 0,
        data: [],
        timestamp: new Date().toISOString(),
        error: error.message,
        duration: Date.now() - startTime,
        requestId: requestId,
      };
    }
  }

  // ============================================================
  // ⭐ MAIN SCRAPE METHODS
  // ============================================================
  async scrapeLive(forceRefresh = true) {
    // If not force refresh, check if we already have cache
    if (!forceRefresh) {
      const cached = await this.getCachedOrLastData('live');
      if (cached && cached.data && cached.data.length > 0) {
        return cached;
      }
    }

    // Check if scrape is already in progress
    if (this.activePromises.live) {
      logger.info(`♻️ Live scrape already in progress, reusing existing promise...`);
      return this.activePromises.live;
    }

    // Otherwise, create new promise and store it
    this.activePromises.live = (async () => {
      this.isScraping.live = true;
      this.scrapeLockTime.live = Date.now();

      try {
        const result = await this.scrapeLiveWithRetry(forceRefresh);
        if (result) {
          logger.info(`📊 Live scrape result: success=${result.success}, total=${result.total || 0}, data=${result.data?.length || 0}`);
        }
        return result;
      } catch (error) {
        logger.error('❌ Live scrape failed:', error.message);
        
        const cached = await this.getCachedOrLastData('live');
        if (cached) {
          return cached;
        }
        
        return {
          success: false,
          source: 'crex',
          type: 'live',
          total: 0,
          data: [],
          timestamp: new Date().toISOString(),
          error: error.message,
          message: 'No cached data available. Please try again in a few seconds.',
          fromCache: false,
        };
      } finally {
        this.isScraping.live = false;
        this.scrapeLockTime.live = null;
        this.activePromises.live = null;
      }
    })();

    return this.activePromises.live;
  }

  async scrapeUpcoming(forceRefresh = true) {
    if (!forceRefresh) {
      const cached = await this.getCachedOrLastData('upcoming');
      if (cached && cached.data && cached.data.length > 0) {
        return cached;
      }
    }

    if (this.activePromises.upcoming) {
      logger.info(`♻️ Upcoming scrape already in progress, reusing existing promise...`);
      return this.activePromises.upcoming;
    }

    this.activePromises.upcoming = (async () => {
      this.isScraping.upcoming = true;
      this.scrapeLockTime.upcoming = Date.now();

      try {
        const result = await this.scrapeUpcomingWithRetry(forceRefresh);
        return result;
      } catch (error) {
        logger.error('❌ Upcoming scrape failed:', error.message);
        
        const cached = await this.getCachedOrLastData('upcoming');
        if (cached) return cached;
        
        return {
          success: false,
          source: 'crex',
          type: 'upcoming',
          total: 0,
          data: [],
          timestamp: new Date().toISOString(),
          error: error.message,
          fromCache: false,
        };
      } finally {
        this.isScraping.upcoming = false;
        this.scrapeLockTime.upcoming = null;
        this.activePromises.upcoming = null;
      }
    })();

    return this.activePromises.upcoming;
  }

  async scrapeFinished(forceRefresh = true) {
    if (!forceRefresh) {
      const cached = await this.getCachedOrLastData('finished');
      if (cached && cached.data && cached.data.length > 0) {
        return cached;
      }
    }

    if (this.activePromises.finished) {
      logger.info(`♻️ Finished scrape already in progress, reusing existing promise...`);
      return this.activePromises.finished;
    }

    this.activePromises.finished = (async () => {
      this.isScraping.finished = true;
      this.scrapeLockTime.finished = Date.now();

      try {
        const result = await this.scrapeFinishedWithRetry(forceRefresh);
        return result;
      } catch (error) {
        logger.error('❌ Finished scrape failed:', error.message);
        
        const cached = await this.getCachedOrLastData('finished');
        if (cached) return cached;
        
        return {
          success: false,
          source: 'crex',
          type: 'finished',
          total: 0,
          data: [],
          timestamp: new Date().toISOString(),
          error: error.message,
          fromCache: false,
        };
      } finally {
        this.isScraping.finished = false;
        this.scrapeLockTime.finished = null;
        this.activePromises.finished = null;
      }
    })();

    return this.activePromises.finished;
  }

  // ============================================================
  // HELPER METHODS
  // ============================================================
  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================
  // SHUTDOWN
  // ============================================================
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

    // ⭐ Close SINGLE browser
    await this.browserManager.close();

    this.forceReleaseLock('all');
    this.initialized = false;
    logger.info('✅ Scraper service shut down');
  }

  // ============================================================
  // CLEANUP
  // ============================================================
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

    // ⭐ Close SINGLE browser
    await this.browserManager.close();

    this.forceReleaseLock('all');
    logger.info('✅ Cleanup completed');
  }

  // ============================================================
  // SCRAPE ALL
  // ============================================================
  async scrapeAll(forceRefresh = true) {
    const startTime = Date.now();
    logger.info('📊 Scraping all match types from CREX...');

    const results = {
      live: null,
      upcoming: null,
      finished: null,
      errors: [],
    };

    try {
      results.live = await this.scrapeLive(forceRefresh);
    } catch (error) {
      results.errors.push({ type: 'live', error: error.message });
    }

    try {
      results.upcoming = await this.scrapeUpcoming(forceRefresh);
    } catch (error) {
      results.errors.push({ type: 'upcoming', error: error.message });
    }

    try {
      results.finished = await this.scrapeFinished(forceRefresh);
    } catch (error) {
      results.errors.push({ type: 'finished', error: error.message });
    }

    const liveCount = results.live?.data?.length || 0;
    const upcomingCount = results.upcoming?.data?.length || 0;
    const finishedCount = results.finished?.data?.length || 0;

    logger.info(`✅ Scraped all matches in ${Date.now() - startTime}ms`);
    logger.info(`  Live: ${liveCount}, Upcoming: ${upcomingCount}, Finished: ${finishedCount}`);

    return {
      success: true,
      source: 'crex',
      timestamp: new Date().toISOString(),
      total: liveCount + upcomingCount + finishedCount,
      data: {
        live: results.live,
        upcoming: results.upcoming,
        finished: results.finished,
      },
      errors: results.errors.length > 0 ? results.errors : undefined,
    };
  }

  // ============================================================
  // GET SOURCE STATUS
  // ============================================================
  async getSourceStatus() {
    const browserStats = this.browserManager.getStats ? this.browserManager.getStats() : {};

    this.checkAndReleaseStaleLocks();

    return {
      primary: {
        source: 'crex',
        enabled: true,
        types: {
          live: {
            enabled: true,
            lastCheck: new Date().toISOString(),
            isScraping: this.isScraping.live,
            lockAge: this.scrapeLockTime.live ? Math.round((Date.now() - this.scrapeLockTime.live) / 1000) : 0,
            lastResultCount: this.lastScrapeResult.live?.data?.length || 0,
            lastSuccess: this.lastScrapeResult.live?.success || false,
            lastSuccessDataCount: this.lastSuccessData.live?.length || 0,
          },
          upcoming: {
            enabled: true,
            lastCheck: new Date().toISOString(),
            isScraping: this.isScraping.upcoming,
            lockAge: this.scrapeLockTime.upcoming ? Math.round((Date.now() - this.scrapeLockTime.upcoming) / 1000) : 0,
            lastResultCount: this.lastScrapeResult.upcoming?.data?.length || 0,
            lastSuccess: this.lastScrapeResult.upcoming?.success || false,
          },
          finished: {
            enabled: true,
            lastCheck: new Date().toISOString(),
            isScraping: this.isScraping.finished,
            lockAge: this.scrapeLockTime.finished ? Math.round((Date.now() - this.scrapeLockTime.finished) / 1000) : 0,
            lastResultCount: this.lastScrapeResult.finished?.data?.length || 0,
            lastSuccess: this.lastScrapeResult.finished?.success || false,
          },
        },
      },
      initialized: this.initialized,
      browser: {
        ready: this.browserManager.isReady || false,
        stats: browserStats,
      },
      cache: {
        live: this.lastSuccessData.live ? this.lastSuccessData.live.length : 0,
        lastUpdate: this.lastSuccessTime.live ? new Date(this.lastSuccessTime.live).toISOString() : null,
      },
    };
  }

  // ============================================================
  // FORCE SCRAPE
  // ============================================================
  async forceScrape(options = {}) {
    const { type, forceRefresh = true } = options;

    if (type) {
      this.forceReleaseLock(type);
    } else {
      this.forceReleaseLock('all');
    }

    if (type === 'live') {
      return await this.scrapeLive(forceRefresh);
    } else if (type === 'upcoming') {
      return await this.scrapeUpcoming(forceRefresh);
    } else if (type === 'finished') {
      return await this.scrapeFinished(forceRefresh);
    } else {
      return await this.scrapeAll(forceRefresh);
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
  // GET MATCH DETAILS
  // ============================================================
  async getMatchDetails(matchId) {
    try {
      const cached = await cache.get(`match_${matchId}`);
      if (cached) return cached;

      const db = getConnection();
      const [rows] = await db.query('SELECT * FROM matches WHERE id = ?', [matchId]);

      if (rows.length > 0) {
        const [details] = await db.query('SELECT * FROM match_details WHERE match_id = ?', [
          matchId,
        ]);

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

    if (filters.source) {
      query += ' AND source = ?';
      params.push(filters.source);
    }

    query += ' ORDER BY match_date DESC LIMIT ? OFFSET ?';
    params.push(filters.limit || 100);
    params.push(filters.offset || 0);

    try {
      const [rows] = await db.query(query, params);
      return rows;
    } catch (error) {
      logger.error('Error getting matches:', error);
      return [];
    }
  }
}

// Singleton instance
const scraperService = new ScraperService();

module.exports = { scraperService, ScraperService };