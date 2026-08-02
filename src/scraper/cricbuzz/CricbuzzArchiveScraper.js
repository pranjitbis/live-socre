// src/scraper/cricbuzz/CricbuzzArchiveScraper.js
const BaseScraper = require('../base/BaseScraper');
const logger = require('../../logger');
const browserManager = require('../browser');
const FlagService = require('../../services/FlagService');
const { getConnection } = require('../../database');
const crypto = require('crypto');

class CricbuzzArchiveScraper extends BaseScraper {
  constructor() {
    super({
      name: 'cricbuzz-archive',
      baseUrl: 'https://www.cricbuzz.com',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    
    // Agent configuration - 10 agents
    this.agentConfig = {
      maxAgents: 10,
      batchSize: 3,
      agentDelay: 2000,
      matchDelay: 1000,
      maxRetries: 3,
      requestTimeout: 30000
    };
    
    this.browser = null;
    this.context = null;
    this.isBrowserInitialized = false;
    this.browserManager = browserManager;
    
    // Track active pages per agent
    this.activePages = new Map();
    this.pageLock = new Map();
    
    // Statistics
    this.stats = {
      totalSeries: 0,
      totalMatches: 0,
      processed: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      startTime: null,
      endTime: null,
      agentStats: {}
    };
    
    // Progress tracking
    this.progress = {
      currentBatch: 0,
      totalBatches: 0,
      currentMatch: 0,
      totalMatches: 0,
      completedMatches: []
    };
    
    this.callbacks = {
      onMatchComplete: null,
      onBatchComplete: null,
      onProgress: null
    };
  }

  // ============================================================
  // BROWSER MANAGEMENT
  // ============================================================
  async initializeBrowser() {
    try {
      if (this.isBrowserInitialized && this.browser && this.browser.isConnected()) {
        return true;
      }

      await this.browserManager.launch();
      this.browser = this.browserManager.browser;
      this.context = this.browserManager.context;
      
      if (!this.context) {
        this.context = await this.browser.newContext({
          viewport: { width: 1920, height: 1080 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
      }
      
      this.isBrowserInitialized = true;
      logger.info('✅ Browser initialized (headless mode)');
      return true;
      
    } catch (error) {
      logger.error(`Failed to initialize browser: ${error.message}`);
      return false;
    }
  }

  async closeBrowser() {
    try {
      // Close all active pages
      for (const [agentId, page] of this.activePages) {
        try {
          if (page && !page.isClosed()) {
            await page.close();
          }
        } catch (e) {
          // Ignore
        }
      }
      this.activePages.clear();
      this.pageLock.clear();
      
      this.isBrowserInitialized = false;
      return true;
    } catch (error) {
      this.isBrowserInitialized = false;
      return false;
    }
  }

  // ============================================================
  // SLEEP
  // ============================================================
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // GENERATE DATA HASH
  // ============================================================
  generateDataHash(data) {
    const str = JSON.stringify(data);
    return crypto.createHash('md5').update(str).digest('hex');
  }

  // ============================================================
  // CHECK EXISTING DATA
  // ============================================================
  async checkExistingData(matchId) {
    try {
      const db = getConnection();
      const [rows] = await db.query(
        'SELECT id, data_hash, details FROM matches WHERE id = ?',
        [matchId]
      );
      
      if (rows.length > 0) {
        return {
          exists: true,
          data: rows[0],
          hash: rows[0].data_hash
        };
      }
      return { exists: false };
    } catch (error) {
      return { exists: false };
    }
  }

  // ============================================================
  // UPSERT MATCH DATA
  // ============================================================
  async upsertMatchData(matchData) {
    try {
      const db = getConnection();
      const matchId = matchData.matchId || matchData.id;
      
      const dataHash = this.generateDataHash(matchData);
      const existing = await this.checkExistingData(matchId);
      
      if (existing.exists) {
        if (existing.hash === dataHash) {
          this.stats.skipped++;
          return { status: 'skipped', matchId };
        }
        
        const query = `
          UPDATE matches SET
            title = ?,
            match_type = ?,
            status = ?,
            venue = ?,
            team1 = ?,
            team2 = ?,
            score1 = ?,
            score2 = ?,
            result = ?,
            match_date = ?,
            source = ?,
            data_hash = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        
        await db.query(query, [
          matchData.matchTitle || matchData.title || '',
          matchData.format || 'T20',
          matchData.status || 'Completed',
          matchData.venue || '',
          matchData.team1?.name || '',
          matchData.team2?.name || '',
          matchData.score1 || '',
          matchData.score2 || '',
          matchData.result || '',
          matchData.date || null,
          matchData.source || 'cricbuzz-archive',
          dataHash,
          matchId
        ]);
        
        this.stats.updated++;
        return { status: 'updated', matchId };
        
      } else {
        const query = `
          INSERT INTO matches (
            id, title, match_type, status, venue, team1, team2,
            score1, score2, result, match_date, source, data_hash,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;
        
        await db.query(query, [
          matchId,
          matchData.matchTitle || matchData.title || '',
          matchData.format || 'T20',
          matchData.status || 'Completed',
          matchData.venue || '',
          matchData.team1?.name || '',
          matchData.team2?.name || '',
          matchData.score1 || '',
          matchData.score2 || '',
          matchData.result || '',
          matchData.date || null,
          matchData.source || 'cricbuzz-archive',
          dataHash
        ]);
        
        if (matchData.details) {
          await db.query(
            `INSERT INTO match_details (id, match_id, details)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE details = VALUES(details), updated_at = NOW()`,
            [`detail_${matchId}`, matchId, JSON.stringify(matchData)]
          );
        }
        
        this.stats.inserted++;
        return { status: 'inserted', matchId };
      }
      
    } catch (error) {
      logger.error(`Error upserting match ${matchId}:`, error.message);
      this.stats.failed++;
      return { status: 'failed', matchId, error: error.message };
    }
  }

  // ============================================================
  // MAIN SCRAPE METHOD - 10 AGENTS
  // ============================================================
  async scrapeYear(year) {
    logger.info(`🚀 Starting 10-Agent Cricbuzz Archive scrape for year: ${year}`);
    this.stats.startTime = Date.now();
    this.progress.totalMatches = 0;
    this.progress.completedMatches = [];
    
    try {
      await this.initializeBrowser();
      
      // Phase 1: Discover series
      const seriesList = await this.discoverSeries(year);
      this.stats.totalSeries = seriesList.length;
      logger.info(`📋 Found ${seriesList.length} series in ${year}`);
      
      if (seriesList.length === 0) {
        await this.closeBrowser();
        return this.getFinalResult(year);
      }
      
      // Phase 2: Process with 10 agents
      const allMatches = await this.processWithAgents(seriesList);
      this.stats.totalMatches = allMatches.length;
      logger.info(`📋 Total matches found: ${allMatches.length}`);
      
      // Phase 3: Upsert to database
      if (allMatches.length > 0) {
        logger.info(`💾 Upserting ${allMatches.length} matches to database...`);
        await this.batchUpsert(allMatches);
      }
      
      await this.closeBrowser();
      this.stats.endTime = Date.now();
      
      return this.getFinalResult(year);
      
    } catch (error) {
      logger.error(`❌ Error scraping year ${year}: ${error.message}`);
      await this.closeBrowser();
      this.stats.endTime = Date.now();
      return {
        success: false,
        year: year,
        error: error.message,
        stats: this.stats
      };
    }
  }

  // ============================================================
  // DISCOVER SERIES
  // ============================================================
  async discoverSeries(year) {
    // Use a dedicated page for discovery
    const page = await this.createPage('discovery');
    
    try {
      const url = `https://www.cricbuzz.com/cricket-scorecard-archives/${year}`;
      await this.navigateWithRetry(page, url);
      await page.waitForTimeout(3000);
      
      const series = await page.evaluate((year) => {
        const seriesList = [];
        const processed = new Set();
        
        const getText = (el) => {
          if (!el) return '';
          return el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
        };
        
        const cleanText = (text) => {
          if (!text) return '';
          return text.replace(/\s+/g, ' ').trim();
        };
        
        const links = document.querySelectorAll('a[href*="/cricket-series/"]');
        
        links.forEach(link => {
          const href = link.getAttribute('href');
          if (!href) return;
          
          const text = cleanText(getText(link));
          if (!text || text.length < 2) return;
          
          let name = text.replace(/\d{4}/g, '').trim();
          name = name.replace(/\s+/g, ' ').trim();
          
          const key = name.toLowerCase();
          if (processed.has(key)) return;
          processed.add(key);
          
          const idMatch = href.match(/\/cricket-series\/(\d+)/);
          const id = idMatch ? idMatch[1] : null;
          const url = href.startsWith('http') ? href : `https://www.cricbuzz.com${href}`;
          
          let format = 'T20';
          const textLower = (name + ' ' + getText(link.closest('div') || link)).toLowerCase();
          if (textLower.includes('test')) format = 'Test';
          else if (textLower.includes('odi')) format = 'ODI';
          else if (textLower.includes('t20')) format = 'T20';
          else if (textLower.includes('the hundred')) format = 'The Hundred';
          
          seriesList.push({
            id: id || `series_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            name: name,
            url: url,
            season: year,
            format: format
          });
        });
        
        return seriesList;
      }, year);
      
      // Close the discovery page
      await this.closePage('discovery');
      return series;
      
    } catch (error) {
      await this.closePage('discovery');
      throw error;
    }
  }

  // ============================================================
  // CREATE PAGE WITH LOCK
  // ============================================================
  async createPage(agentId) {
    // Wait if this agent already has a page being closed
    while (this.pageLock.has(agentId)) {
      await this.sleep(100);
    }
    
    // Lock for this agent
    this.pageLock.set(agentId, true);
    
    try {
      // Check if we already have a page for this agent
      if (this.activePages.has(agentId)) {
        const existingPage = this.activePages.get(agentId);
        if (!existingPage.isClosed()) {
          this.pageLock.delete(agentId);
          return existingPage;
        }
      }
      
      // Create a new page
      if (!this.context) {
        await this.initializeBrowser();
      }
      
      const page = await this.context.newPage();
      page.setDefaultTimeout(this.agentConfig.requestTimeout);
      page.setDefaultNavigationTimeout(this.agentConfig.requestTimeout);
      
      // Store the page
      this.activePages.set(agentId, page);
      this.pageLock.delete(agentId);
      
      return page;
      
    } catch (error) {
      this.pageLock.delete(agentId);
      throw error;
    }
  }

  // ============================================================
  // CLOSE PAGE
  // ============================================================
  async closePage(agentId) {
    // Wait if page is being used
    while (this.pageLock.has(agentId)) {
      await this.sleep(100);
    }
    
    this.pageLock.set(agentId, true);
    
    try {
      if (this.activePages.has(agentId)) {
        const page = this.activePages.get(agentId);
        if (page && !page.isClosed()) {
          await page.close();
        }
        this.activePages.delete(agentId);
      }
      this.pageLock.delete(agentId);
      return true;
    } catch (error) {
      this.activePages.delete(agentId);
      this.pageLock.delete(agentId);
      return false;
    }
  }

  // ============================================================
  // PROCESS WITH 10 AGENTS - BATCH BY BATCH
  // ============================================================
  async processWithAgents(seriesList) {
    logger.info(`🤖 Starting ${this.agentConfig.maxAgents} agents...`);
    
    const allMatches = [];
    const totalSeries = seriesList.length;
    const batchSize = this.agentConfig.batchSize;
    const totalBatches = Math.ceil(totalSeries / batchSize);
    
    this.progress.totalBatches = totalBatches;
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * batchSize;
      const end = Math.min(start + batchSize, totalSeries);
      const batch = seriesList.slice(start, end);
      
      this.progress.currentBatch = batchIndex + 1;
      
      logger.info(`\n📦 Batch ${batchIndex + 1}/${totalBatches}: Processing ${batch.length} series`);
      logger.info('='.repeat(60));
      
      // Process batch with agents
      const batchMatches = await this.processBatchWithAgents(batch);
      allMatches.push(...batchMatches);
      
      this.progress.completedMatches = allMatches;
      
      logger.info(`📊 Progress: ${allMatches.length} matches collected so far`);
      
      if (this.callbacks.onBatchComplete) {
        this.callbacks.onBatchComplete({
          batch: batchIndex + 1,
          totalBatches: totalBatches,
          matches: allMatches.length,
          batchMatches: batchMatches.length
        });
      }
      
      // Delay between batches
      if (batchIndex < totalBatches - 1) {
        logger.info(`⏳ Waiting 3 seconds before next batch...`);
        await this.sleep(3000);
      }
    }
    
    return allMatches;
  }

  // ============================================================
  // PROCESS BATCH WITH AGENTS
  // ============================================================
  async processBatchWithAgents(batch) {
    const agentPromises = [];
    const batchResults = [];
    
    const agentCount = Math.min(batch.length, this.agentConfig.maxAgents);
    
    for (let i = 0; i < agentCount; i++) {
      const agentNum = i + 1;
      const series = batch[i];
      
      if (!series) break;
      
      const delay = i * this.agentConfig.agentDelay;
      
      logger.info(`   🤖 Agent ${agentNum} starting in ${delay}ms: ${series.name}`);
      
      const agentPromise = new Promise((resolve) => {
        setTimeout(async () => {
          const result = await this.runAgent(agentNum, series);
          resolve(result);
        }, delay);
      });
      
      agentPromises.push(agentPromise);
    }
    
    const results = await Promise.all(agentPromises);
    
    for (const result of results) {
      if (result && result.matches) {
        batchResults.push(...result.matches);
        if (this.callbacks.onMatchComplete) {
          this.callbacks.onMatchComplete(result.matches);
        }
      }
    }
    
    return batchResults;
  }

  // ============================================================
  // RUN AGENT - Process one series
  // ============================================================
  async runAgent(agentNum, series) {
    const agentId = `agent_${agentNum}`;
    const matches = [];
    
    logger.info(`      ${agentId} processing: ${series.name}`);
    
    // Create a dedicated page for this agent
    const page = await this.createPage(agentId);
    
    try {
      // Navigate to series page
      await this.navigateWithRetry(page, series.url);
      await page.waitForTimeout(2000);
      
      // Extract matches from series
      const matchData = await page.evaluate((series) => {
        const matches = [];
        const seen = new Set();
        
        const getText = (el) => {
          if (!el) return '';
          return el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
        };
        
        const cleanText = (text) => {
          if (!text) return '';
          return text.replace(/\s+/g, ' ').trim();
        };
        
        const links = document.querySelectorAll('a[href*="/live-cricket-scores/"]');
        
        links.forEach(link => {
          const href = link.getAttribute('href');
          if (!href) return;
          
          const idMatch = href.match(/\/live-cricket-scores\/(\d+)/);
          const id = idMatch ? idMatch[1] : null;
          if (!id || seen.has(id)) return;
          seen.add(id);
          
          const container = link.closest('div, li, article') || link;
          const text = cleanText(getText(container));
          
          const vsMatch = text.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)/i);
          let team1 = vsMatch ? cleanText(vsMatch[1]) : '';
          let team2 = vsMatch ? cleanText(vsMatch[2]) : '';
          
          team1 = team1.replace(/\d+/g, '').trim();
          team2 = team2.replace(/\d+/g, '').trim();
          
          if (!team1 || !team2) return;
          
          const scoreEls = container.querySelectorAll('.score, .runs, .cb-score');
          const scores = [];
          scoreEls.forEach(el => {
            const s = cleanText(getText(el));
            if (s) scores.push(s);
          });
          
          let result = '';
          const resultEl = container.querySelector('.result, .match-result, .status');
          if (resultEl) {
            result = cleanText(getText(resultEl));
          }
          
          const url = href.startsWith('http') ? href : `https://www.cricbuzz.com${href}`;
          
          matches.push({
            id: id,
            url: url,
            team1: team1,
            team2: team2,
            score1: scores[0] || '',
            score2: scores[1] || '',
            result: result || '',
            seriesId: series.id,
            seriesName: series.name,
            season: series.season,
            format: series.format
          });
        });
        
        return matches;
      }, series);
      
      logger.info(`      ${agentId} found ${matchData.length} matches`);
      
      // Process each match using the same page
      for (let i = 0; i < matchData.length; i++) {
        const match = matchData[i];
        
        try {
          const details = await this.extractMatchDetailsPage(page, match, series);
          matches.push(details);
          this.stats.processed++;
          
          if ((i + 1) % 5 === 0) {
            logger.info(`      ${agentId}: ${i + 1}/${matchData.length} matches processed`);
          }
          
          if (i < matchData.length - 1) {
            await this.sleep(this.agentConfig.matchDelay);
          }
          
        } catch (error) {
          logger.error(`      ${agentId} error on match ${i + 1}: ${error.message}`);
        }
      }
      
      // Close the agent's page when done
      await this.closePage(agentId);
      
    } catch (error) {
      logger.error(`      ${agentId} error: ${error.message}`);
      // Close the page on error
      await this.closePage(agentId);
    }
    
    return {
      agentId,
      matches,
      series: series.name
    };
  }

  // ============================================================
  // EXTRACT MATCH DETAILS PAGE - FIXED
  // ============================================================
  async extractMatchDetailsPage(page, match, series) {
    try {
      await this.navigateWithRetry(page, match.url);
      await page.waitForTimeout(1500);
      
      const details = await page.evaluate(({ match, series }) => {
        const getText = (el) => {
          if (!el) return '';
          return el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
        };
        
        const cleanText = (text) => {
          if (!text) return '';
          return text.replace(/\s+/g, ' ').trim();
        };
        
        let venue = '';
        const venueEl = document.querySelector('.venue, .match-venue, .venue-name, .location');
        if (venueEl) {
          venue = cleanText(getText(venueEl));
        }
        
        let playerOfMatch = '';
        const pomEl = document.querySelector('.player-of-match, .mom, .player-of-the-match');
        if (pomEl) {
          playerOfMatch = cleanText(getText(pomEl));
        }
        
        let toss = '';
        const tossEl = document.querySelector('.toss, .toss-info, .match-toss');
        if (tossEl) {
          toss = cleanText(getText(tossEl));
        }
        
        const inningsScoreEls = document.querySelectorAll('.innings-score, .score, .runs');
        const scores = [];
        inningsScoreEls.forEach(el => {
          const s = cleanText(getText(el));
          if (s && !s.includes('vs')) scores.push(s);
        });
        
        const titleEl = document.querySelector('h1, .match-header, .title');
        let title = titleEl ? cleanText(getText(titleEl)) : `${match.team1} vs ${match.team2}`;
        
        if (title && (title.includes('vs') || title.includes('VS'))) {
          const parts = title.split(/\s+vs\s+/i);
          if (parts.length === 2) {
            match.team1 = cleanText(parts[0]);
            match.team2 = cleanText(parts[1]);
          }
        }
        
        return {
          matchId: match.id,
          matchTitle: title || `${match.team1} vs ${match.team2}`,
          seriesId: series.id,
          seriesName: series.name,
          season: series.season,
          format: series.format || 'T20',
          status: 'Completed',
          venue: venue || 'TBD',
          date: '',
          result: match.result || '',
          playerOfMatch: playerOfMatch || '',
          team1: { 
            name: match.team1, 
            short: match.team1.substring(0, 3).toUpperCase() 
          },
          team2: { 
            name: match.team2, 
            short: match.team2.substring(0, 3).toUpperCase() 
          },
          score1: match.score1 || (scores[0] || ''),
          score2: match.score2 || (scores[1] || ''),
          toss: toss || '',
          source: 'cricbuzz-archive'
        };
      }, { match, series });
      
      details.team1.flag = FlagService.getFlagUrl(details.team1.name);
      details.team2.flag = FlagService.getFlagUrl(details.team2.name);
      
      return details;
      
    } catch (error) {
      logger.error(`Error extracting match details for ${match.id}: ${error.message}`);
      return {
        matchId: match.id,
        matchTitle: `${match.team1} vs ${match.team2}`,
        seriesId: series.id,
        seriesName: series.name,
        season: series.season,
        format: series.format || 'T20',
        status: 'Completed',
        venue: 'TBD',
        date: '',
        result: match.result || '',
        team1: { 
          name: match.team1, 
          short: match.team1.substring(0, 3).toUpperCase() 
        },
        team2: { 
          name: match.team2, 
          short: match.team2.substring(0, 3).toUpperCase() 
        },
        score1: match.score1 || '',
        score2: match.score2 || '',
        source: 'cricbuzz-archive'
      };
    }
  }

  // ============================================================
  // BATCH UPSERT
  // ============================================================
  async batchUpsert(matches) {
    const results = [];
    const batchSize = 10;
    
    for (let i = 0; i < matches.length; i += batchSize) {
      const batch = matches.slice(i, i + batchSize);
      const promises = batch.map(match => this.upsertMatchData(match));
      const batchResults = await Promise.all(promises);
      results.push(...batchResults);
      
      logger.info(`📊 Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(matches.length / batchSize)}: ${batchResults.filter(r => r.status === 'inserted').length} inserted, ${batchResults.filter(r => r.status === 'updated').length} updated, ${batchResults.filter(r => r.status === 'skipped').length} skipped`);
      
      if (i + batchSize < matches.length) {
        await this.sleep(500);
      }
    }
    
    return results;
  }

  // ============================================================
  // NAVIGATE WITH RETRY
  // ============================================================
  async navigateWithRetry(page, url, options = {}) {
    const maxRetries = options.maxRetries || this.agentConfig.maxRetries;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check if page is still valid
        if (!page || page.isClosed()) {
          throw new Error('Page is closed');
        }
        
        const response = await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: this.agentConfig.requestTimeout
        });
        
        if (response && response.status() === 403) {
          if (attempt === maxRetries) throw new Error('403 Forbidden');
          await this.sleep(3000 * attempt);
          continue;
        }
        
        if (response && response.status() >= 400) {
          if (attempt === maxRetries) throw new Error(`Status ${response.status()}`);
          await this.sleep(2000 * attempt);
          continue;
        }
        
        await page.waitForLoadState('networkidle');
        await this.sleep(1000);
        return response;
        
      } catch (error) {
        if (attempt === maxRetries) throw error;
        await this.sleep(2000 * attempt);
      }
    }
  }

  // ============================================================
  // GET FINAL RESULT
  // ============================================================
  getFinalResult(year) {
    const duration = this.stats.startTime && this.stats.endTime ? 
      (this.stats.endTime - this.stats.startTime) / 1000 : 0;
    
    logger.info('\n' + '='.repeat(60));
    logger.info('📊 SCRAPING COMPLETE');
    logger.info('='.repeat(60));
    logger.info(`   Year: ${year}`);
    logger.info(`   Series Found: ${this.stats.totalSeries}`);
    logger.info(`   Matches Found: ${this.stats.totalMatches}`);
    logger.info(`   ✅ Inserted: ${this.stats.inserted}`);
    logger.info(`   🔄 Updated: ${this.stats.updated}`);
    logger.info(`   ⏭️ Skipped: ${this.stats.skipped}`);
    logger.info(`   ❌ Failed: ${this.stats.failed}`);
    logger.info(`   ⏱️ Duration: ${duration}s`);
    logger.info(`   📈 Success Rate: ${this.stats.totalMatches > 0 ? Math.round(((this.stats.inserted + this.stats.updated) / this.stats.totalMatches) * 100) : 0}%`);
    logger.info('='.repeat(60));
    
    if (this.progress.completedMatches.length > 0) {
      logger.info('\n📋 Sample Matches:');
      const samples = this.progress.completedMatches.slice(0, 3);
      samples.forEach((match, i) => {
        logger.info(`   ${i + 1}. ${match.team1?.name || 'Team 1'} vs ${match.team2?.name || 'Team 2'} - ${match.result || 'Completed'}`);
      });
    }
    logger.info('='.repeat(60));
    
    return {
      success: true,
      year: year,
      stats: this.stats,
      duration: duration,
      matches: this.progress.completedMatches
    };
  }
}

module.exports = CricbuzzArchiveScraper;