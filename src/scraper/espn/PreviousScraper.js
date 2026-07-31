// src/scraper/espn/PreviousScraper.js
const BaseEspnScraper = require('./BaseEspnScraper');
const PREVIOUS_SELECTORS = require('./selectors/previousSelectors');
const logger = require('../../logger');
const util = require('util');
const fs = require('fs');
const path = require('path');

const deepLog = (label, data) => {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`📊 ${label}`);
  console.log(`${'═'.repeat(80)}`);
  console.log(util.inspect(data, {
    depth: null,
    colors: true,
    compact: false,
    maxArrayLength: null,
    maxStringLength: null,
    showHidden: false
  }));
  console.log(`${'═'.repeat(80)}\n`);
};

class PreviousScraper extends BaseEspnScraper {
  constructor(options = {}) {
    super({ headless: true, timeout: options.timeout || 120000 });
    this.selectors = PREVIOUS_SELECTORS;
    this.requests = [];
    this.responses = [];
    this.jsonEndpoints = [];
    this.detectedApiEndpoint = null;
    this.stats = {
      discovered: 0,
      extracted: 0,
      skipped: 0,
      errors: 0
    };
  }

  // ============================================================
  // MAIN SCRAPE METHOD
  // ============================================================
  async scrapePreviousMatches() {
    logger.info('🚀 Starting ESPN Cricinfo Previous Matches Scraper');

    try {
      await this.initializeBrowser();

      // Setup network listeners
      await this.setupNetworkListeners();
      
      // Navigate with retry
      const pageReady = await this.navigateWithRetry();
      
      if (!pageReady) {
        logger.error('❌ Page could not be loaded properly');
        await this.closeBrowser();
        return {
          success: false,
          timestamp: new Date().toISOString(),
          total_matches: 0,
          data: [],
          error: 'Page load failed - all navigation attempts failed'
        };
      }

      // Wait for content
      await this.page.waitForTimeout(3000);

      // Log page info
      const url = this.page.url();
      const title = await this.page.title();
      logger.info(`   Current URL: ${url}`);
      logger.info(`   Page Title: ${title}`);

      // Check for bot protection
      const bodyText = await this.page.evaluate(() => document.body.textContent);
      const botProtection = this.detectBotProtection(bodyText);
      if (botProtection) {
        logger.error(`🚫 BOT PROTECTION DETECTED: ${botProtection}`);
        await this.closeBrowser();
        return {
          success: false,
          timestamp: new Date().toISOString(),
          total_matches: 0,
          data: [],
          error: `Bot protection detected: ${botProtection}`
        };
      }

      // Save page HTML for debugging
      const debugDir = path.join(process.cwd(), 'debug');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      
      const htmlContent = await this.page.content();
      fs.writeFileSync(path.join(debugDir, 'espn-page.html'), htmlContent);
      fs.writeFileSync(path.join(debugDir, 'espn-page-text.txt'), bodyText || '');
      logger.info(`💾 Saved page HTML to debug/espn-page.html`);

      // Check if page has content
      const hasContent = bodyText && bodyText.length > 500;
      logger.info(`   Body Text Length: ${bodyText ? bodyText.length : 0}`);
      logger.info(`   Has Content: ${hasContent}`);

      if (!hasContent) {
        logger.warn('⚠️ Page has very little content, trying to wait longer...');
        await this.page.waitForTimeout(5000);
        
        const bodyText2 = await this.page.evaluate(() => document.body.textContent);
        if (!bodyText2 || bodyText2.length < 500) {
          logger.error('❌ Page still has no content after waiting');
          await this.closeBrowser();
          return {
            success: false,
            timestamp: new Date().toISOString(),
            total_matches: 0,
            data: [],
            error: 'Page content is empty'
          };
        }
      }

      // Find JSON endpoints from network
      await this.discoverJsonEndpoints();

      // Use discovered endpoint or fallback to DOM
      let discoveredMatches = [];
      if (this.detectedApiEndpoint) {
        logger.info(`📡 Using discovered API endpoint: ${this.detectedApiEndpoint}`);
        discoveredMatches = await this.discoverMatchesFromApi();
      } else {
        logger.info('🔍 No JSON endpoint found, falling back to DOM scraping');
        discoveredMatches = await this.discoverMatchesFromDom();
      }

      this.stats.discovered = discoveredMatches.length;

      if (discoveredMatches.length === 0) {
        logger.warn('⚠️ No completed matches discovered');
        await this.closeBrowser();
        return {
          success: false,
          timestamp: new Date().toISOString(),
          total_matches: 0,
          data: []
        };
      }

      logger.info(`📋 Phase 1 complete: Discovered ${discoveredMatches.length} matches`);
      deepLog('PHASE 1 - Discovered Matches', discoveredMatches);

      // Phase 2: Extract details
      const fullMatches = [];
      for (let i = 0; i < discoveredMatches.length; i++) {
        const discovered = discoveredMatches[i];
        logger.info(`  📄 Processing match ${i + 1}/${discoveredMatches.length}: ${discovered.url}`);

        try {
          const matchData = await this.extractMatchDetails(discovered.url);
          if (matchData) {
            fullMatches.push(matchData);
            this.stats.extracted++;
            logger.info(`    ✅ Extracted: ${matchData.teams.home.name} vs ${matchData.teams.away.name}`);
          }
        } catch (error) {
          logger.error(`    ❌ Error processing match: ${error.message}`);
          this.stats.errors++;
          continue;
        }

        if (i < discoveredMatches.length - 1) {
          await this.page.waitForTimeout(1000);
        }
      }

      await this.closeBrowser();
      this.logStatistics();

      const result = {
        success: true,
        timestamp: new Date().toISOString(),
        total_matches: fullMatches.length,
        data: fullMatches,
        api_endpoint_used: this.detectedApiEndpoint,
        endpoints_discovered: this.jsonEndpoints
      };

      // Save to file
      const outputFile = path.join(process.cwd(), 'espn_previous_matches.json');
      fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
      logger.info(`💾 Results saved to ${outputFile}`);

      return result;

    } catch (error) {
      logger.error(`❌ PreviousScraper error: ${error.message}`);
      await this.closeBrowser();
      return {
        success: false,
        timestamp: new Date().toISOString(),
        total_matches: 0,
        data: []
      };
    }
  }

  // ============================================================
  // NAVIGATE WITH RETRY LOGIC - FIXED
  // ============================================================
  async navigateWithRetry() {
    const urls = [
      'https://www.espncricinfo.com/ci/engine/match/index.html?view=week',
      'https://www.espncricinfo.com/ci/content/engine/match/index.html?view=week',
      'https://www.espncricinfo.com/series',
      'https://www.espncricinfo.com'
    ];

    let lastError = null;

    for (let attempt = 0; attempt < urls.length; attempt++) {
      const url = urls[attempt];
      logger.info(`   Attempt ${attempt + 1}/${urls.length}: ${url}`);

      try {
        // Try with different wait strategies
        const waitOptions = ['domcontentloaded', 'load', 'networkidle'];
        
        for (const waitUntil of waitOptions) {
          try {
            logger.info(`      Trying with waitUntil: ${waitUntil}`);
            
            const response = await this.page.goto(url, {
              waitUntil: waitUntil,
              timeout: 30000
            });

            if (response) {
              const status = response.status();
              logger.info(`      Response status: ${status}`);
              
              if (status >= 200 && status < 400) {
                logger.info(`   ✅ Successfully loaded: ${url} (${waitUntil})`);
                
                // Wait a bit for content to render
                await this.page.waitForTimeout(2000);
                
                // Check if page has content
                const bodyText = await this.page.evaluate(() => document.body.textContent);
                if (bodyText && bodyText.length > 100) {
                  logger.info(`   Page loaded with ${bodyText.length} characters`);
                  return true;
                } else {
                  logger.info(`   Page has minimal content (${bodyText ? bodyText.length : 0} chars), trying next wait strategy...`);
                }
              } else {
                logger.warn(`   ⚠️ Response status: ${status}`);
              }
            }
          } catch (e) {
            logger.debug(`   ⚠️ Failed with ${waitUntil}: ${e.message}`);
            lastError = e;
            continue;
          }
        }
      } catch (error) {
        lastError = error;
        logger.warn(`   ❌ Failed to load ${url}: ${error.message}`);
        continue;
      }
    }

    logger.error(`❌ All navigation attempts failed. Last error: ${lastError?.message || 'Unknown error'}`);
    return false;
  }

  // ============================================================
  // SETUP NETWORK LISTENERS
  // ============================================================
  async setupNetworkListeners() {
    logger.info('📡 Setting up network listeners...');

    // Clear previous data
    this.requests = [];
    this.responses = [];
    this.jsonEndpoints = [];
    this.detectedApiEndpoint = null;

    // Listen to all requests
    this.page.on('request', (request) => {
      const url = request.url();
      const req = {
        url: url,
        method: request.method(),
        headers: request.headers(),
        timestamp: new Date().toISOString()
      };
      this.requests.push(req);
      
      // Log interesting requests
      if (url.includes('.json') || url.includes('api') || url.includes('graphql')) {
        logger.debug(`   📤 Request: ${request.method()} ${url}`);
      }
    });

    // Listen to all responses
    this.page.on('response', async (response) => {
      try {
        const url = response.url();
        const status = response.status();
        const headers = response.headers();
        const contentType = headers['content-type'] || '';
        
        const res = {
          url: url,
          status: status,
          contentType: contentType,
          headers: headers,
          timestamp: new Date().toISOString()
        };

        // Check if it's JSON
        if (contentType.includes('application/json') || 
            contentType.includes('text/json') ||
            contentType.includes('graphql')) {
          
          logger.debug(`   📥 JSON Response: ${status} ${url}`);
          
          try {
            const body = await response.text();
            res.bodySize = body.length;
            
            // Try to parse JSON
            try {
              const jsonData = JSON.parse(body);
              res.keys = Object.keys(jsonData);
              res.isValidJson = true;
              
              // Check if it contains match data
              const hasMatchData = this.hasMatchData(jsonData);
              if (hasMatchData) {
                res.hasMatchData = true;
                this.jsonEndpoints.push({
                  url: url,
                  status: status,
                  bodySize: body.length,
                  keys: Object.keys(jsonData),
                  contentType: contentType
                });
                logger.info(`   ✅ Found JSON with match data: ${url}`);
              } else {
                logger.debug(`   ℹ️ JSON endpoint (no match data): ${url} - Keys: ${Object.keys(jsonData).join(', ')}`);
              }
            } catch (e) {
              res.isValidJson = false;
              logger.debug(`   ⚠️ Invalid JSON response: ${url}`);
            }
          } catch (e) {
            logger.debug(`   ⚠️ Could not read response body: ${url}`);
          }
        }

        this.responses.push(res);
      } catch (error) {
        logger.debug(`   ⚠️ Error processing response: ${error.message}`);
      }
    });
  }

  // ============================================================
  // CHECK IF JSON HAS MATCH DATA
  // ============================================================
  hasMatchData(jsonData) {
    if (!jsonData || typeof jsonData !== 'object') return false;
    
    const matchIndicators = ['matches', 'events', 'content', 'series', 'results', 'fixtures', 'scorecards', 'match', 'game', 'matchList'];
    const keys = Object.keys(jsonData);
    
    for (const indicator of matchIndicators) {
      if (keys.includes(indicator)) return true;
    }
    
    // Check nested
    for (const key of keys) {
      if (typeof jsonData[key] === 'object' && jsonData[key] !== null) {
        const nestedKeys = Object.keys(jsonData[key]);
        for (const indicator of matchIndicators) {
          if (nestedKeys.includes(indicator)) return true;
        }
      }
    }
    
    return false;
  }

  // ============================================================
  // DISCOVER JSON ENDPOINTS
  // ============================================================
  async discoverJsonEndpoints() {
    logger.info(`📡 Analyzing ${this.jsonEndpoints.length} JSON endpoints...`);

    // Log all discovered JSON endpoints
    for (const endpoint of this.jsonEndpoints) {
      logger.info(`   📊 JSON Endpoint: ${endpoint.url}`);
      logger.info(`      Status: ${endpoint.status}`);
      logger.info(`      Body Size: ${endpoint.bodySize} bytes`);
      logger.info(`      Keys: ${endpoint.keys.join(', ')}`);
      logger.info(`      Content-Type: ${endpoint.contentType}`);
    }

    // Find the best endpoint
    for (const endpoint of this.jsonEndpoints) {
      if (endpoint.status === 200 && endpoint.hasMatchData) {
        this.detectedApiEndpoint = endpoint.url;
        logger.info(`   ✅ Selected endpoint: ${endpoint.url}`);
        break;
      }
    }

    // If no match data endpoint found, try to find any JSON with match-related keys
    if (!this.detectedApiEndpoint) {
      for (const endpoint of this.jsonEndpoints) {
        const matchKeys = ['matches', 'events', 'content', 'series', 'results'];
        const hasMatchKey = endpoint.keys.some(key => matchKeys.includes(key));
        if (endpoint.status === 200 && hasMatchKey) {
          this.detectedApiEndpoint = endpoint.url;
          logger.info(`   ✅ Selected fallback endpoint: ${endpoint.url}`);
          break;
        }
      }
    }

    logger.info(`   Detected API Endpoint: ${this.detectedApiEndpoint || 'None'}`);
    logger.info(`   Total JSON Responses: ${this.responses.filter(r => r.isValidJson).length}`);
  }

  // ============================================================
  // DISCOVER MATCHES FROM API
  // ============================================================
  async discoverMatchesFromApi() {
    logger.info(`📡 Discovering matches from API: ${this.detectedApiEndpoint}`);

    try {
      // Navigate to the API endpoint to get fresh data
      const response = await this.page.goto(this.detectedApiEndpoint, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const content = await this.page.evaluate(() => document.body.textContent);
      
      try {
        const data = JSON.parse(content);
        const matches = this.extractMatchesFromJson(data);
        
        // Limit to first 20 matches
        const limitedMatches = matches.slice(0, 20);
        logger.info(`✅ API: Discovered ${limitedMatches.length} completed matches`);
        return limitedMatches;
      } catch (e) {
        logger.error(`❌ Failed to parse API response: ${e.message}`);
        return [];
      }
    } catch (error) {
      logger.error(`❌ API discovery failed: ${error.message}`);
      return [];
    }
  }

  // ============================================================
  // EXTRACT MATCHES FROM JSON
  // ============================================================
  extractMatchesFromJson(data) {
    const matches = [];
    
    try {
      // Try different possible paths
      let matchList = null;
      
      if (data.matches) matchList = data.matches;
      else if (data.events) matchList = data.events;
      else if (data.content && data.content.matches) matchList = data.content.matches;
      else if (data.data && data.data.matches) matchList = data.data.matches;
      else if (data.results) matchList = data.results;
      else if (data.fixtures) matchList = data.fixtures;
      else if (data.matchList) matchList = data.matchList;
      
      if (!matchList || !Array.isArray(matchList)) {
        // Try to find any array in the data
        for (const key of Object.keys(data)) {
          if (Array.isArray(data[key]) && data[key].length > 0) {
            const firstItem = data[key][0];
            if (firstItem && (firstItem.team1 || firstItem.team2 || firstItem.teams || firstItem.match || firstItem.score)) {
              matchList = data[key];
              break;
            }
          }
        }
      }

      if (matchList && Array.isArray(matchList)) {
        for (const item of matchList) {
          try {
            // Extract teams
            let team1 = item.team1 || item.team_a || item.teams?.[0] || item.away || '';
            let team2 = item.team2 || item.team_b || item.teams?.[1] || item.home || '';
            
            // Extract URL
            let url = item.url || item.href || item.match_url || item.matchUrl || item.link || '';
            if (url && !url.startsWith('http')) {
              url = `https://www.espncricinfo.com${url}`;
            }
            
            // Check if completed
            const status = item.status || item.matchStatus || item.state || '';
            const isCompleted = /completed|result|won|finished|full time/i.test(status);
            
            if (isCompleted && team1 && team2 && url) {
              matches.push({
                url: url,
                team1: team1,
                team2: team2,
                result: {
                  winner: item.winner || item.result || '',
                  margin: item.margin || '',
                  method: item.method || 'Normal'
                },
                format: item.format || item.matchFormat || 'T20',
                rawText: JSON.stringify(item).substring(0, 300)
              });
            }
          } catch (error) {
            continue;
          }
        }
      }
    } catch (error) {
      logger.error(`❌ Error extracting matches from JSON: ${error.message}`);
    }

    return matches;
  }

  // ============================================================
  // DISCOVER MATCHES FROM DOM (Fallback)
  // ============================================================
  async discoverMatchesFromDom() {
    logger.info('🔍 Discovering matches from DOM...');

    try {
      const pageText = await this.page.evaluate(() => document.body.textContent);
      const lines = pageText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      logger.info(`   Found ${lines.length} lines of text`);

      const matches = [];
      let currentFormat = '';

      for (const line of lines) {
        if (line.startsWith('##')) {
          currentFormat = line.replace('##', '').trim();
          continue;
        }

        const lowerLine = line.toLowerCase();
        if (lowerLine.includes('tbc') || 
            lowerLine.includes('scheduled') ||
            lowerLine.includes('will begin') ||
            lowerLine.includes('starts at')) {
          continue;
        }

        const hasScore = /\d+\s*[\/-]\s*\d+/.test(line);
        const hasResult = /won by|won\s+(?:the\s+)?match|tied|drawn/.test(lowerLine);
        
        if ((hasScore || hasResult) && /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(line)) {
          const isCompleted = /won by|won\s+(?:the\s+)?match|tied|drawn/.test(lowerLine);
          
          if (isCompleted) {
            // Try to find URL from links
            const links = await this.page.$$eval('a[href*="/series/"], a[href*="/match/"]', (els) => {
              return els.map(el => el.getAttribute('href'));
            });

            let matchUrl = '';
            for (const link of links) {
              if (link && !link.includes('/series/')) {
                matchUrl = this.buildAbsoluteUrl(link);
                break;
              }
            }

            if (matchUrl) {
              const teams = this.extractTeamsFromLine(line);
              if (teams.team1 && teams.team2) {
                matches.push({
                  url: matchUrl,
                  team1: teams.team1,
                  team2: teams.team2,
                  result: this.extractResultFromLine(line),
                  rawText: line.substring(0, 300),
                  format: currentFormat
                });
              }
            }
          }
        }
      }

      const uniqueMatches = [];
      const seenUrls = new Set();
      for (const match of matches) {
        if (!seenUrls.has(match.url)) {
          seenUrls.add(match.url);
          uniqueMatches.push(match);
        }
      }

      const limitedMatches = uniqueMatches.slice(0, 20);
      logger.info(`✅ DOM: Discovered ${limitedMatches.length} completed matches`);
      return limitedMatches;

    } catch (error) {
      logger.error(`❌ DOM discovery failed: ${error.message}`);
      return [];
    }
  }

  // ============================================================
  // HELPER: EXTRACT TEAMS FROM LINE
  // ============================================================
  extractTeamsFromLine(line) {
    let team1 = '', team2 = '';
    const cleanLine = line.replace(/\s+/g, ' ').trim();

    const vsMatch = cleanLine.match(/([A-Za-z\s]+?)\s+vs\s+([A-Za-z\s]+?)(?:\s|$)/i);
    if (vsMatch) {
      const t1 = vsMatch[1].trim();
      const t2 = vsMatch[2].trim();
      if (t1 && t2 && t1.length > 2 && t2.length > 2) {
        team1 = t1.replace(/[()\-:]/g, '').trim();
        team2 = t2.replace(/[()\-:]/g, '').trim();
        team1 = team1.replace(/\s+Women$|Men$|XI$/, '').trim();
        team2 = team2.replace(/\s+Women$|Men$|XI$/, '').trim();
        return { team1, team2 };
      }
    }

    const scorePattern = /([A-Za-z][A-Za-z\s]+?)\s+(\d+[\/-]\d+|\d+)\s*(?:\(|ov|$)/gi;
    let scores = [];
    let match;
    while ((match = scorePattern.exec(cleanLine)) !== null) {
      const team = match[1].trim().replace(/[()\-:]/g, '').trim();
      if (team && team.length > 2) {
        scores.push(team);
      }
    }

    if (scores.length >= 2) {
      team1 = scores[0];
      team2 = scores[1];
      return { team1, team2 };
    }

    return { team1, team2 };
  }

  // ============================================================
  // HELPER: EXTRACT RESULT FROM LINE
  // ============================================================
  extractResultFromLine(line) {
    const result = { winner: '', margin: '', method: 'Normal' };

    const winMatch = line.match(/(.+?)\s+won by\s+([\d\s]+(?:runs|wickets|an innings))/i);
    if (winMatch) {
      result.winner = winMatch[1].trim();
      result.margin = winMatch[2].trim();
      return result;
    }

    if (line.toLowerCase().includes('tied')) {
      result.winner = 'Match Tied';
      result.method = 'Tied';
      return result;
    }

    if (line.toLowerCase().includes('drawn')) {
      result.winner = 'Match Drawn';
      result.method = 'Drawn';
      return result;
    }

    return result;
  }

  // ============================================================
  // DETECT BOT PROTECTION
  // ============================================================
  detectBotProtection(text) {
    if (!text) return null;
    
    const protectionIndicators = [
      'Cloudflare',
      'Akamai',
      'Enable JavaScript',
      'Access Denied',
      'captcha',
      'blocked',
      'suspicious',
      'DDoS',
      'Ray ID',
      'Please wait',
      'Checking your browser',
      'Verifying you are human'
    ];

    for (const indicator of protectionIndicators) {
      if (text.includes(indicator)) {
        return indicator;
      }
    }
    
    return null;
  }

  // ============================================================
  // EXTRACT MATCH DETAILS
  // ============================================================
  async extractMatchDetails(matchUrl) {
    logger.info(`   🔍 Extracting details from: ${matchUrl}`);

    try {
      await this.page.goto(matchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      await this.page.waitForTimeout(3000);

      const matchData = {
        match_id: `match_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        match_url: matchUrl,
        series: await this.extractSeries(),
        match: await this.extractMatchInfo(),
        venue: await this.extractVenue(),
        teams: await this.extractTeams(),
        innings: await this.extractInnings(),
        result: await this.extractResult(),
        toss: await this.extractToss(),
        player_of_match: await this.extractPlayerOfMatch(),
        officials: await this.extractOfficials(),
        scorecard: await this.extractScorecard(),
        batting: await this.extractBatting(),
        bowling: await this.extractBowling(),
        fall_of_wickets: await this.extractFallOfWickets(),
        match_info: await this.extractMatchInfoData(),
        commentary_url: await this.extractCommentaryUrl()
      };

      return matchData;

    } catch (error) {
      logger.error(`   ❌ Error extracting match details: ${error.message}`);
      return null;
    }
  }

  // ============================================================
  // EXTRACT SERIES
  // ============================================================
  async extractSeries() {
    const series = { id: '', name: '', short_name: '', season: '' };

    try {
      const selectors = [
        '.match-info .series-name',
        '.match-header .series-name',
        '.match-series a',
        '.header-series a'
      ];

      for (const selector of selectors) {
        const name = await this.getText(selector);
        if (name) {
          series.name = name.trim();
          series.short_name = series.name.substring(0, 20);
          const seasonMatch = name.match(/\b(20\d{2})\b/);
          if (seasonMatch) {
            series.season = seasonMatch[1];
          }
          break;
        }
      }

      const linkSelectors = [
        '.match-info .series-name a',
        '.match-header .series-name a'
      ];
      for (const selector of linkSelectors) {
        const href = await this.getAttribute(selector, 'href');
        if (href) {
          const idMatch = href.match(/\/series\/([^\/]+)/);
          if (idMatch) {
            series.id = idMatch[1];
          }
          break;
        }
      }

      if (!series.id && series.name) {
        series.id = this.generateSeriesId(series.name);
      }

    } catch (error) {
      logger.debug(`   ⚠️ Error extracting series: ${error.message}`);
    }

    return series;
  }

  // ============================================================
  // EXTRACT MATCH INFO
  // ============================================================
  async extractMatchInfo() {
    const match = {
      number: '',
      format: '',
      status: 'Completed',
      start_time: '',
      end_time: ''
    };

    try {
      const formatSelectors = ['.match-format', '.format-tag', '.match-info .format'];
      for (const selector of formatSelectors) {
        const text = await this.getText(selector);
        if (text) {
          match.format = text.trim();
          break;
        }
      }

      const startSelectors = ['.match-date', '.start-date', '.match-info .date'];
      for (const selector of startSelectors) {
        const text = await this.getText(selector);
        if (text) {
          match.start_time = text.trim();
          break;
        }
      }

      const title = await this.page.title();
      const numberMatch = title.match(/(\d+(?:st|nd|rd|th)\s+(?:Match|TEST|ODI|T20|T10|100B))/i);
      if (numberMatch) {
        match.number = numberMatch[0];
      }

    } catch (error) {
      logger.debug(`   ⚠️ Error extracting match info: ${error.message}`);
    }

    return match;
  }

  // ============================================================
  // EXTRACT VENUE
  // ============================================================
  async extractVenue() {
    const venue = { id: '', name: '', city: '', country: '' };

    try {
      const nameSelectors = ['.match-venue', '.venue', '.venue-name', '.match-location'];
      for (const selector of nameSelectors) {
        const text = await this.getText(selector);
        if (text) {
          venue.name = text.trim();
          break;
        }
      }

      const linkSelectors = ['.venue a', '.match-venue a'];
      for (const selector of linkSelectors) {
        const href = await this.getAttribute(selector, 'href');
        if (href) {
          const idMatch = href.match(/\/venue\/([^\/]+)/);
          if (idMatch) {
            venue.id = idMatch[1];
          }
          break;
        }
      }

      if (venue.name) {
        const parts = venue.name.split(',').map(p => p.trim());
        if (parts.length >= 2) {
          venue.city = parts[parts.length - 2];
          venue.country = parts[parts.length - 1];
        }
      }

    } catch (error) {
      logger.debug(`   ⚠️ Error extracting venue: ${error.message}`);
    }

    return venue;
  }

  // ============================================================
  // EXTRACT TEAMS
  // ============================================================
  async extractTeams() {
    const teams = {
      home: { id: '', name: '', short_name: '', logo: '' },
      away: { id: '', name: '', short_name: '', logo: '' }
    };

    try {
      const teamContainers = await this.page.$$('.team, .team-container, .match-teams .team');

      if (teamContainers.length >= 2) {
        const containers = teamContainers.slice(0, 2);
        const teamNames = [];

        for (const container of containers) {
          const nameEl = await container.$('.team-name, .name, .team-title');
          if (nameEl) {
            const name = await this.page.evaluate(el => el.textContent.trim(), nameEl);
            if (name) {
              teamNames.push(name);
            }
          }
        }

        if (teamNames.length >= 2) {
          teams.home.name = teamNames[0];
          teams.home.id = this.generateTeamId(teamNames[0]);
          teams.home.short_name = teamNames[0].substring(0, 3).toUpperCase();
          
          teams.away.name = teamNames[1];
          teams.away.id = this.generateTeamId(teamNames[1]);
          teams.away.short_name = teamNames[1].substring(0, 3).toUpperCase();
        }
      }

    } catch (error) {
      logger.debug(`   ⚠️ Error extracting teams: ${error.message}`);
    }

    return teams;
  }

  // ============================================================
  // EXTRACT INNINGS
  // ============================================================
  async extractInnings() {
    const innings = [];

    try {
      const innElements = await this.page.$$('.innings, .inning, .scorecard-innings');

      for (const innEl of innElements) {
        const text = await this.page.evaluate(el => el.textContent.trim(), innEl);
        if (!text) continue;

        const inn = {
          team: '',
          runs: null,
          wickets: null,
          overs: '',
          run_rate: null,
          extras: null,
          total: null,
          declared: false,
          follow_on: false,
          target: null
        };

        const teamMatch = text.match(/^([A-Za-z\s]+?)\s+\d/);
        if (teamMatch) {
          inn.team = teamMatch[1].trim();
        }

        const scoreMatch = text.match(/(\d+)[\/-](\d+)/);
        if (scoreMatch) {
          inn.runs = parseInt(scoreMatch[1]);
          inn.wickets = parseInt(scoreMatch[2]);
          inn.total = `${inn.runs}-${inn.wickets}`;
        }

        const overMatch = text.match(/(\d+\.\d+|\d+)\s*ov/i);
        if (overMatch) {
          inn.overs = overMatch[1];
        }

        innings.push(inn);
      }

    } catch (error) {
      logger.debug(`   ⚠️ Error extracting innings: ${error.message}`);
    }

    return innings;
  }

  // ============================================================
  // EXTRACT RESULT
  // ============================================================
  async extractResult() {
    const result = { winner: '', margin: '', method: 'Normal' };

    try {
      const resultSelectors = ['.match-result', '.result', '.result-text', '.match-status'];
      let resultText = '';

      for (const selector of resultSelectors) {
        const text = await this.getText(selector);
        if (text) {
          resultText = text;
          break;
        }
      }

      if (resultText) {
        const winMatch = resultText.match(/(.+?)\s+won by\s+([\d\s]+(?:runs|wickets|an innings))/i);
        if (winMatch) {
          result.winner = winMatch[1].trim();
          result.margin = winMatch[2].trim();
        } else if (resultText.toLowerCase().includes('tied')) {
          result.winner = 'Match Tied';
          result.method = 'Tied';
        } else if (resultText.toLowerCase().includes('drawn')) {
          result.winner = 'Match Drawn';
          result.method = 'Drawn';
        }
      }

    } catch (error) {
      logger.debug(`   ⚠️ Error extracting result: ${error.message}`);
    }

    return result;
  }

  // ============================================================
  // EXTRACT TOSS
  // ============================================================
  async extractToss() {
    const toss = { winner: '', decision: '' };

    try {
      const tossSelectors = ['.toss', '.toss-info', '.match-info .toss'];
      let tossText = '';

      for (const selector of tossSelectors) {
        const text = await this.getText(selector);
        if (text) {
          tossText = text;
          break;
        }
      }

      if (tossText) {
        const winMatch = tossText.match(/(.+?)\s+won the toss/i);
        if (winMatch) {
          toss.winner = winMatch[1].trim();
          if (tossText.includes('bat')) {
            toss.decision = 'bat';
          } else if (tossText.includes('bowl') || tossText.includes('field')) {
            toss.decision = 'bowl';
          }
        }
      }

    } catch (error) {
      logger.debug(`   ⚠️ Error extracting toss: ${error.message}`);
    }

    return toss;
  }

  // ============================================================
  // EXTRACT PLAYER OF MATCH
  // ============================================================
  async extractPlayerOfMatch() {
    const player = { name: '', team: '', image: '', profile_url: '' };

    try {
      const pomSelectors = ['.player-of-match', '.mom', '.match-info .mom'];
      for (const selector of pomSelectors) {
        const text = await this.getText(selector);
        if (text) {
          player.name = text.trim();
          break;
        }
      }

    } catch (error) {
      logger.debug(`   ⚠️ Error extracting player of match: ${error.message}`);
    }

    return player;
  }

  // ============================================================
  // EXTRACT OFFICIALS
  // ============================================================
  async extractOfficials() {
    const officials = {
      umpires: [],
      tv_umpire: '',
      reserve_umpire: '',
      match_referee: ''
    };

    try {
      const umpireText = await this.getText('.umpires, .officials .umpires');
      if (umpireText) {
        officials.umpires = umpireText.split(',').map(u => u.trim());
      }

      const refereeText = await this.getText('.match-referee, .referee, .officials .referee');
      if (refereeText) {
        officials.match_referee = refereeText.trim();
      }

    } catch (error) {
      logger.debug(`   ⚠️ Error extracting officials: ${error.message}`);
    }

    return officials;
  }

  // ============================================================
  // EXTRACT SCORECARD
  // ============================================================
  async extractScorecard() {
    const scorecard = { innings: [] };

    try {
      const summary = await this.getText('.scorecard-summary, .match-score-summary');
      if (summary) {
        scorecard.summary = summary.trim();
      }

    } catch (error) {
      logger.debug(`   ⚠️ Error extracting scorecard: ${error.message}`);
    }

    return scorecard;
  }

  // ============================================================
  // EXTRACT BATTING
  // ============================================================
  async extractBatting() {
    const batting = [];

    try {
      const battingTables = await this.page.$$('.batting-table, .scorecard-batting, .batting');

      for (const table of battingTables) {
        const rows = await table.$$('tr');

        for (const row of rows) {
          const text = await this.page.evaluate(el => el.textContent.trim(), row);
          if (!text || text.length < 5) continue;
          if (text.includes('BAT') || text.includes('R') || text.includes('B')) continue;

          const parts = text.split(/\s+/).filter(p => p.length > 0);
          if (parts.length >= 3) {
            batting.push({
              name: parts[0] || '',
              runs: parseInt(parts[1]) || null,
              balls: parseInt(parts[2]) || null,
              fours: parseInt(parts[3]) || null,
              sixes: parseInt(parts[4]) || null,
              strike_rate: parseFloat(parts[5]) || null,
              dismissal: '',
              captain: false,
              keeper: false
            });
          }
        }
      }

    } catch (error) {
      logger.debug(`   ⚠️ Error extracting batting: ${error.message}`);
    }

    return batting;
  }

  // ============================================================
  // EXTRACT BOWLING
  // ============================================================
  async extractBowling() {
    const bowling = [];

    try {
      const bowlingTables = await this.page.$$('.bowling-table, .scorecard-bowling, .bowling');

      for (const table of bowlingTables) {
        const rows = await table.$$('tr');

        for (const row of rows) {
          const text = await this.page.evaluate(el => el.textContent.trim(), row);
          if (!text || text.length < 5) continue;
          if (text.includes('BOWL') || text.includes('O') || text.includes('M')) continue;

          const parts = text.split(/\s+/).filter(p => p.length > 0);
          if (parts.length >= 5) {
            bowling.push({
              name: parts[0] || '',
              overs: parts[1] || '',
              maidens: parseInt(parts[2]) || null,
              runs: parseInt(parts[3]) || null,
              wickets: parseInt(parts[4]) || null,
              economy: parseFloat(parts[5]) || null,
              dots: null,
              wides: null,
              no_balls: null
            });
          }
        }
      }

    } catch (error) {
      logger.debug(`   ⚠️ Error extracting bowling: ${error.message}`);
    }

    return bowling;
  }

  // ============================================================
  // EXTRACT FALL OF WICKETS
  // ============================================================
  async extractFallOfWickets() {
    const wickets = [];

    try {
      const fowSelectors = ['.fall-of-wickets', '.fow', '.wicket-log'];

      for (const selector of fowSelectors) {
        const container = await this.page.$(selector);
        if (container) {
          const rows = await container.$$('tr, .fow-row');
          for (const row of rows) {
            const text = await this.page.evaluate(el => el.textContent.trim(), row);
            if (text) {
              const parts = text.split(/\s+/).filter(p => p.length > 0);
              if (parts.length >= 3) {
                wickets.push({
                  score: parts[0] || '',
                  wickets: parts[1] || '',
                  overs: parts[2] || '',
                  batsman: parts.slice(3).join(' ') || ''
                });
              }
            }
          }
          break;
        }
      }

    } catch (error) {
      logger.debug(`   ⚠️ Error extracting fall of wickets: ${error.message}`);
    }

    return wickets;
  }

  // ============================================================
  // EXTRACT MATCH INFO DATA
  // ============================================================
  async extractMatchInfoData() {
    const info = { attendance: '', weather: '', pitch: '' };

    try {
      const attendanceText = await this.getText('.attendance, .match-info .attendance');
      if (attendanceText) info.attendance = attendanceText.trim();

      const weatherText = await this.getText('.weather, .match-info .weather');
      if (weatherText) info.weather = weatherText.trim();

      const pitchText = await this.getText('.pitch, .match-info .pitch');
      if (pitchText) info.pitch = pitchText.trim();

    } catch (error) {
      logger.debug(`   ⚠️ Error extracting match info data: ${error.message}`);
    }

    return info;
  }

  // ============================================================
  // EXTRACT COMMENTARY URL
  // ============================================================
  async extractCommentaryUrl() {
    try {
      const el = await this.page.$('a[href*="/commentary/"]');
      if (el) {
        const href = await this.page.evaluate(el => el.getAttribute('href'), el);
        if (href) {
          return this.buildAbsoluteUrl(href);
        }
      }
    } catch (error) {
      logger.debug(`   ⚠️ Error extracting commentary URL: ${error.message}`);
    }
    return '';
  }

  // ============================================================
  // LOG STATISTICS
  // ============================================================
  logStatistics() {
    logger.info(`📊 ESPN Previous Scraper Statistics:`);
    logger.info(`   Discovered: ${this.stats.discovered}`);
    logger.info(`   Extracted: ${this.stats.extracted}`);
    logger.info(`   Skipped: ${this.stats.skipped}`);
    logger.info(`   Errors: ${this.stats.errors}`);
    logger.info(`   JSON Endpoints Found: ${this.jsonEndpoints.length}`);
    logger.info(`   API Endpoint Used: ${this.detectedApiEndpoint || 'None (DOM fallback)'}`);
    logger.info(`   Success rate: ${this.stats.discovered > 0 ? Math.round((this.stats.extracted / this.stats.discovered) * 100) : 0}%`);
  }
}

module.exports = PreviousScraper;