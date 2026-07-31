// src/scraper/crex/CrexScraper.js
const cheerio = require('cheerio');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { chromium } = require('playwright');
const BaseScraper = require('../base/BaseScraper');
const config = require('../../config');
const logger = require('../../logger');

// ============================================================
// SELECTOR CONFIGURATION
// ============================================================
const SELECTORS = {
  common: {
    container: ['app-match-details-wrapper', '.match-container', '.match-page', '.match-details', '.scorecard-container'],
    series: ['.series-name', '.snameTag', '.match-series', '.series-title', '.cb-series-name'],
    title: ['h1', '.match-title', '.match-header h1', '.match-info h1', '.cb-match-title'],
    matchNumber: ['.match-number', '.match-desc', '.cb-match-number'],
    venue: ['.venue', '.match-venue', '.venue-name', '.cb-venue'],
    toss: ['.toss', '.toss-info', '.toss-detail', '.cb-toss'],
    officials: ['.officials', '.match-officials', '.cb-officials'],
    matchInfo: '.match-info, .match-details-info, .info-section',
  },
  upcoming: {
    container: '.teamProfile',
    flexColumn: '.flexColumn',
    val1Text: '.val1-text',
    val2Text: '.val2-text',
    timeText: '.time-text',
    teamName: '.teamNameUpc, .team-name, .name',
    teamFlag: '.teamFlagUpc img',
    teamFlagFallback: 'img[src*="cricketvectors.akamaized.net/Teams/"]',
  },
  live: {
    teamInning: '.team-innig',
    teamName: '.team-name',
    teamScore: '.team-score .runs',
    scoreFirst: '.team-score .runs span:first-child',
    scoreLast: '.team-score .runs span:last-child',
    teamFlag: '.team-img img',
    batsmen: '.batsmen-partnership, .batsmen, .partnership',
    batsman: '.batsman, .batsmen-item',
    batsmanName: '.batsmen-name, .name',
    batsmanScore: '.batsmen-score p, .score',
    bowler: '.bowler-info, .current-bowler, .bowler',
    bowlerName: '.bowler-name, .name',
    timeline: '.overs-timeline, .overs-slide',
    over: '.over, .overs-item',
    ball: '.ball, .delivery',
    overNumber: '.over-number, .number',
    crr: '.crr, .current-run-rate',
    rrr: '.rrr, .required-run-rate',
    partnership: '.partnership, .partnership-info',
  },
  completed: {
    result: '.resultText, .result, .match-result, .result-text, .cb-result',
    playerOfMatch: '.player-of-match, .pom, .mom, .cb-pom, .player-of-the-match, .p-lw-card',
    playerName: '.player-name, .pom-name, .name',
    playerImage: 'img',
    playerPerformance: '.performance, .stats, .pom-stats',
    playerTeam: '.team-name, .team',
    winningTeam: '.winner, .winning-team',
    margin: '.margin, .win-margin',
  },
  status: {
    badge: '.status-badge, .match-status, .status, .state-badge',
    resultBanner: '.result-banner, .match-result-banner',
    scoreboard: '.scoreboard, .match-scoreboard',
  },
  hydration: {
    nextData: /__NEXT_DATA__\s*=\s*({.*?});/s,
    initialState: /window\.__INITIAL_STATE__\s*=\s*({.*?});/s,
    apolloState: /window\.__APOLLO_STATE__\s*=\s*({.*?});/s,
    nuxt: /window\.__NUXT__\s*=\s*({.*?});/s,
    angularBootstrap: /<script[^>]*id="angular-bootstrap"[^>]*>([\s\S]*?)<\/script>/,
    embeddedJson: /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
    runtime: /window\.__RUNTIME__\s*=\s*({.*?});/s,
  }
};

// ============================================================
// DATE/TIME/COUNTDOWN SELECTORS
// ============================================================
const DATE_SELECTORS = [
  '.val1-text',
  '.match-date',
  '.date',
  '.schedule-date',
  '.day',
  '.fixture-date',
  '.start-date',
  '.match-day',
  '.event-date',
];

const TIME_SELECTORS = [
  '.val2-text',
  '.match-time',
  '.time',
  '.schedule-time',
  '.start-time',
  '.fixture-time',
  '.event-time',
];

const COUNTDOWN_SELECTORS = [
  '.time-text',
  '.starts-in',
  '.countdown',
  '.remaining-time',
  '.schedule-countdown',
];

class CrexScraper extends BaseScraper {
  constructor() {
    super(config.sources.crex || { name: 'crex', baseUrl: 'https://crex.com' });
    this.baseUrl = 'https://crex.com';
    this.headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    };
    this.maxMatches = 5;
    this.requestDelay = 2000;
    this.debugDir = path.join(process.cwd(), 'debug');
    this.browser = null;
    this.context = null;
    this.page = null;
    this.usePlaywright = true;
    this.debugEnabled = false;
    this.apiResponses = [];
    this.domCache = new Map();
    this.stats = {
      downloaded: 0,
      parsed: 0,
      jsonDataFound: 0,
      apiDataFound: 0,
      domDataFound: 0,
      validationPassed: 0,
      validationFailed: 0,
      returned: 0,
    };
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  printMemoryUsage(label) {
    if (global.gc) {
      global.gc();
    }
    const memory = process.memoryUsage();
    logger.info(`📊 Memory ${label}:`);
    logger.info(`  Heap Used: ${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    logger.info(`  Heap Total: ${(memory.heapTotal / 1024 / 1024).toFixed(2)} MB`);
    logger.info(`  RSS: ${(memory.rss / 1024 / 1024).toFixed(2)} MB`);
  }

  // ============================================================
  // INITIALIZE PLAYWRIGHT BROWSER
  // ============================================================
  async initialize() {
    try {
      if (!this.browser) {
        logger.info('🔧 STEP: Launching browser...');
        this.browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-web-security',
            '--window-size=1920,1080',
            '--max-old-space-size=2048',
          ],
        });
        logger.info('✅ STEP: Browser launched');

        logger.info('🔧 STEP: Creating browser context...');
        this.context = await this.browser.newContext({
          viewport: { width: 1920, height: 1080 },
          userAgent: this.headers['User-Agent'],
          extraHTTPHeaders: {
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            Connection: 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
          },
        });
        logger.info('✅ STEP: Browser context created');

        logger.info('🔧 STEP: Setting up API capture...');
        this.apiResponses = [];

        // ============================================================
        // Selective resource blocking
        // ============================================================
        logger.info('🔧 STEP: Setting up selective resource blocking...');
        await this.context.route('**/*', (route) => {
          const resourceType = route.request().resourceType();
          const url = route.request().url();
          
          if (['font', 'media'].includes(resourceType)) {
            return route.abort();
          }
          
          if (url.includes('google-analytics') || 
              url.includes('googletagmanager') ||
              url.includes('facebook.com/tr') ||
              url.includes('doubleclick.net') ||
              url.includes('gtag')) {
            return route.abort();
          }
          
          if (resourceType === 'image') {
            if (url.includes('cricketvectors.akamaized.net/Teams/')) {
              return route.continue();
            }
            return route.abort();
          }
          
          return route.continue();
        });
        logger.info('✅ STEP: Selective resource blocking configured');

        logger.info('🔧 STEP: Creating new page...');
        this.page = await this.context.newPage();
        logger.info('✅ STEP: New page created');

        this.page.on('response', this.handleResponse.bind(this));

        logger.info('✅ CREX browser initialized');
      }
      return true;
    } catch (error) {
      logger.error(`❌ Failed to initialize CREX browser:`);
      logger.error(`  Error: ${error.message}`);
      logger.error(`  Stack: ${error.stack}`);
      return false;
    }
  }

  // ============================================================
  // HANDLE RESPONSE - API CAPTURE
  // ============================================================
  handleResponse(response) {
    try {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';
      
      if (!contentType.includes('application/json')) {
        return;
      }

      const relevantPatterns = [
        '/api/', '/match/', '/score/', '/data/',
        '/commentary/', '/timeline/', '/player/', '/statistics/', '/live/',
      ];

      const isRelevant = relevantPatterns.some(pattern => url.includes(pattern));
      if (!isRelevant) {
        return;
      }

      response.json().then(data => {
        if (data && (data.match || data.matchInfo || data.matchData || data.score || data.commentary || data.timeline)) {
          this.apiResponses.push({
            url,
            data,
            timestamp: Date.now(),
          });
          logger.debug(`✅ API response captured: ${url}`);
        }
      }).catch(() => {});
    } catch (error) {}
  }

  // ============================================================
  // CLOSE PLAYWRIGHT BROWSER
  // ============================================================
  async close() {
    try {
      if (this.page) {
        this.page.removeListener('response', this.handleResponse);
        await this.page.close().catch(() => {});
        this.page = null;
      }
      if (this.context) {
        await this.context.close().catch(() => {});
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
      this.apiResponses = [];
      this.domCache.clear();
      if (global.gc) {
        global.gc();
      }
      logger.info('✅ CREX browser closed');
    } catch (error) {
      logger.error(`Error closing CREX browser: ${error.message}`);
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }

  // ============================================================
  // DOM HELPER FUNCTIONS
  // ============================================================
  
  getText(element) {
    if (!element) return '';
    return element.textContent ? element.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  getHtml(element) {
    if (!element) return '';
    return element.innerHTML || '';
  }

  getAttribute(element, attr) {
    if (!element) return '';
    return element.getAttribute(attr) || '';
  }

  getImage(element) {
    if (!element) return '';
    const img = element.querySelector('img');
    return img ? (img.getAttribute('src') || '') : '';
  }

  query(document, selector) {
    try {
      return document.querySelector(selector);
    } catch (error) {
      return null;
    }
  }

  queryAll(document, selector) {
    try {
      return document.querySelectorAll(selector);
    } catch (error) {
      return [];
    }
  }

  findFirst(document, selectors) {
    for (const selector of selectors) {
      const el = this.query(document, selector);
      if (el) return el;
    }
    return null;
  }

  // ============================================================
  // EXTRACT HYDRATION DATA
  // ============================================================
  extractHydrationData(html) {
    const data = {};

    try {
      const sources = [
        { name: '__NEXT_DATA__', pattern: SELECTORS.hydration.nextData },
        { name: '__INITIAL_STATE__', pattern: SELECTORS.hydration.initialState },
        { name: '__APOLLO_STATE__', pattern: SELECTORS.hydration.apolloState },
        { name: '__NUXT__', pattern: SELECTORS.hydration.nuxt },
        { name: '__RUNTIME__', pattern: SELECTORS.hydration.runtime },
        { name: 'Angular Bootstrap', pattern: SELECTORS.hydration.angularBootstrap },
        { name: 'Embedded JSON', pattern: SELECTORS.hydration.embeddedJson },
      ];

      const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/g;
      let scriptMatch;

      for (const source of sources) {
        const match = html.match(source.pattern);
        if (match) {
          try {
            const parsed = JSON.parse(match[1]);
            if (parsed) {
              const matchData = this.findMatchDataInObject(parsed);
              if (matchData) {
                data.match = matchData;
                data.source = source.name;
                logger.debug(`✅ Hydration data found: ${source.name}`);
                break;
              }
            }
          } catch (e) {}
        }
      }

      if (!data.match) {
        while ((scriptMatch = scriptRegex.exec(html)) !== null) {
          const content = scriptMatch[1];
          if (content && (content.includes('"match"') || content.includes('"matchInfo"'))) {
            try {
              const jsonMatches = content.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
              if (jsonMatches) {
                for (const jsonStr of jsonMatches) {
                  try {
                    const parsed = JSON.parse(jsonStr);
                    const matchData = this.findMatchDataInObject(parsed);
                    if (matchData) {
                      data.match = matchData;
                      data.source = 'Script Tag';
                      logger.debug(`✅ Hydration data found in script tag`);
                      break;
                    }
                  } catch (e) {}
                }
              }
            } catch (e) {}
          }
          if (data.match) break;
        }
      }

      return data;
    } catch (error) {
      logger.debug(`Hydration extraction failed: ${error.message}`);
      return data;
    }
  }

  // ============================================================
  // FIND MATCH DATA IN OBJECT
  // ============================================================
  findMatchDataInObject(obj) {
    if (!obj || typeof obj !== 'object') return null;

    if (obj.match) return obj.match;
    if (obj.matchInfo) return obj.matchInfo;
    if (obj.matchData) return obj.matchData;
    if (obj.data?.match) return obj.data.match;
    if (obj.data?.matchInfo) return obj.data.matchInfo;

    if (obj.props?.pageProps?.match) return obj.props.pageProps.match;
    if (obj.props?.pageProps?.matchData) return obj.props.pageProps.matchData;
    if (obj.props?.pageProps?.matchInfo) return obj.props.pageProps.matchInfo;

    if (obj.currentMatchesList?.typeMatches) {
      for (const typeMatch of obj.currentMatchesList.typeMatches) {
        if (typeMatch.seriesMatches) {
          for (const seriesMatch of typeMatch.seriesMatches) {
            if (seriesMatch.seriesAdWrapper?.matches) {
              const matches = seriesMatch.seriesAdWrapper.matches;
              if (matches && matches.length > 0) {
                const firstMatch = matches[0];
                if (firstMatch.matchInfo) return firstMatch;
                if (firstMatch.match) return firstMatch.match;
              }
            }
          }
        }
      }
    }

    const findMatch = (obj, depth = 0) => {
      if (depth > 5) return null;
      if (!obj || typeof obj !== 'object') return null;

      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (value && typeof value === 'object') {
          const result = this.findMatchDataInObject(value);
          if (result) return result;
        }
      }
      return null;
    };

    return findMatch(obj);
  }

  // ============================================================
  // EXTRACT API DATA
  // ============================================================
  extractApiData() {
    if (!this.apiResponses || this.apiResponses.length === 0) {
      return null;
    }

    const sorted = [...this.apiResponses].sort((a, b) => b.timestamp - a.timestamp);

    for (const response of sorted) {
      const data = response.data;
      
      if (data.match) return data.match;
      if (data.matchInfo) return data.matchInfo;
      if (data.matchData) return data.matchData;
      if (data.data?.match) return data.data.match;
      if (data.data?.matchInfo) return data.data.matchInfo;
      
      if (data.score) {
        return { matchScore: data.score };
      }
      
      if (data.commentary) {
        return { commentary: data.commentary };
      }
      
      if (data.timeline) {
        return { timeline: data.timeline };
      }
    }

    return null;
  }

  // ============================================================
  // DETECT PAGE TYPE
  // ============================================================
  detectPageType(document) {
    const badgeSelectors = SELECTORS.status.badge;
    for (const selector of badgeSelectors) {
      const badge = this.query(document, selector);
      if (badge) {
        const text = this.getText(badge).toLowerCase();
        if (text.includes('live')) return 'LIVE';
        if (text.includes('upcoming') || text.includes('up coming')) return 'UPCOMING';
        if (text.includes('completed') || text.includes('finished')) return 'COMPLETED';
        if (text.includes('abandoned')) return 'ABANDONED';
        if (text.includes('result')) return 'COMPLETED';
        if (text.includes('stumps') || text.includes('lunch') || text.includes('tea') || text.includes('innings break')) return 'LIVE';
      }
    }

    for (const selector of SELECTORS.status.resultBanner) {
      const banner = this.query(document, selector);
      if (banner) {
        const text = this.getText(banner);
        if (text.includes('won by') || text.includes('result') || text.includes('tie')) {
          return 'COMPLETED';
        }
      }
    }

    const teamInnings = this.queryAll(document, SELECTORS.live.teamInning);
    if (teamInnings.length >= 2) {
      for (const inn of teamInnings) {
        const score = this.query(inn, SELECTORS.live.teamScore);
        if (score) {
          const scoreText = this.getText(score);
          if (scoreText && scoreText.match(/\d+/)) {
            const resultEl = this.query(document, SELECTORS.completed.result);
            if (resultEl) {
              const resultText = this.getText(resultEl);
              if (resultText.includes('won by')) {
                return 'COMPLETED';
              }
            }
            return 'LIVE';
          }
        }
      }
    }

    const teamProfile = this.query(document, SELECTORS.upcoming.container);
    if (teamProfile) {
      const flexColumn = this.query(teamProfile, SELECTORS.upcoming.flexColumn);
      if (flexColumn) {
        const val1 = this.query(flexColumn, SELECTORS.upcoming.val1Text);
        const val2 = this.query(flexColumn, SELECTORS.upcoming.val2Text);
        if (val1 || val2) {
          return 'UPCOMING';
        }
      }
    }

    const bodyText = document.body ? this.getText(document.body).toLowerCase() : '';
    if (bodyText.includes('abandoned')) return 'ABANDONED';
    if (bodyText.includes('no result')) return 'NO RESULT';
    if (bodyText.includes('draw')) return 'DRAW';
    if (bodyText.includes('won by')) return 'COMPLETED';

    return 'UPCOMING';
  }

  // ============================================================
  // EXTRACT UPCOMING SCHEDULE - COMPREHENSIVE
  // ============================================================
  extractUpcomingSchedule(document, logs) {
    const result = {
      date: '',
      startTime: '',
      startsIn: '',
    };

    // ============================================================
    // STRATEGY 1: Search for flexColumn and child elements
    // ============================================================
    const flexColumns = this.queryAll(document, '.flexColumn');
    logs.push({ selector: '.flexColumn count', found: true, value: `${flexColumns.length} found` });
    
    for (let i = 0; i < flexColumns.length; i++) {
      const container = flexColumns[i];
      const text = this.getText(container);
      
      // Skip containers with unrelated content
      if (text.includes('Team Form') || text.includes('Prediction') || 
          text.includes('Fantasy') || text.includes('Stats') || 
          text.includes('News') || text.includes('Squads') || 
          text.includes('Points Table') || text.includes('Head To Head')) {
        logs.push({ 
          selector: `flexColumn[${i}] (ignored)`, 
          found: true, 
          value: text.substring(0, 50) + (text.length > 50 ? '...' : '') 
        });
        continue;
      }
      
      logs.push({ 
        selector: `flexColumn[${i}]`, 
        found: true, 
        value: text.substring(0, 80) + (text.length > 80 ? '...' : '') 
      });
      
      // Check for date in child elements
      let dateFound = false;
      for (const selector of DATE_SELECTORS) {
        const el = this.query(container, selector);
        if (el) {
          const dateText = this.getText(el);
          if (dateText && !dateText.includes('Team Form') && !dateText.includes('vs')) {
            result.date = dateText;
            dateFound = true;
            logs.push({ selector, found: true, value: result.date });
            break;
          }
        }
      }
      
      // Check for time in child elements
      let timeFound = false;
      for (const selector of TIME_SELECTORS) {
        const el = this.query(container, selector);
        if (el) {
          const timeText = this.getText(el);
          if (timeText && (timeText.match(/\d{1,2}:\d{2}/) || timeText.match(/AM|PM/i))) {
            result.startTime = timeText;
            timeFound = true;
            logs.push({ selector, found: true, value: result.startTime });
            break;
          }
        }
      }
      
      // Check for countdown in child elements
      for (const selector of COUNTDOWN_SELECTORS) {
        const el = this.query(container, selector);
        if (el) {
          const countdownText = this.getText(el);
          if (countdownText && (countdownText.includes('Starts') || countdownText.includes('s'))) {
            result.startsIn = countdownText;
            logs.push({ selector, found: true, value: result.startsIn });
            break;
          }
        }
      }
      
      // If we found date and time in this container, we're done
      if (dateFound && timeFound) {
        logs.push({ 
          selector: `flexColumn[${i}] (selected)`, 
          found: true, 
          value: `Date: ${result.date}, Time: ${result.startTime}` 
        });
        break;
      }
    }

    // ============================================================
    // STRATEGY 2: Search using class-based selectors globally
    // ============================================================
    if (!result.date || !result.startTime) {
      // Search for date
      for (const selector of DATE_SELECTORS) {
        const elements = this.queryAll(document, selector);
        for (const el of elements) {
          const text = this.getText(el);
          if (text && !text.includes('Team Form') && !text.includes('vs') && 
              !text.includes('Points Table') && !text.includes('Head To Head')) {
            // Check if it looks like a date
            if (text.match(/\d{1,2}\s+[A-Za-z]+\s+\d{4}/) || 
                text.match(/[A-Za-z]+\s+\d{1,2},?\s+\d{4}/) ||
                text.includes('Today') || text.includes('Tomorrow') || 
                text.includes('Monday') || text.includes('Tuesday') || 
                text.includes('Wednesday') || text.includes('Thursday') || 
                text.includes('Friday') || text.includes('Saturday') || 
                text.includes('Sunday')) {
              result.date = text;
              logs.push({ selector, found: true, value: result.date });
              break;
            }
          }
        }
        if (result.date) break;
      }
      
      // Search for time
      for (const selector of TIME_SELECTORS) {
        const elements = this.queryAll(document, selector);
        for (const el of elements) {
          const text = this.getText(el);
          if (text && (text.match(/\d{1,2}:\d{2}/) || text.match(/AM|PM/i))) {
            result.startTime = text;
            logs.push({ selector, found: true, value: result.startTime });
            break;
          }
        }
        if (result.startTime) break;
      }
      
      // Search for countdown
      for (const selector of COUNTDOWN_SELECTORS) {
        const elements = this.queryAll(document, selector);
        for (const el of elements) {
          const text = this.getText(el);
          if (text && (text.includes('Starts') || text.includes('s'))) {
            result.startsIn = text;
            logs.push({ selector, found: true, value: result.startsIn });
            break;
          }
        }
        if (result.startsIn) break;
      }
    }

    // ============================================================
    // STRATEGY 3: Text pattern search with regex
    // ============================================================
    if (!result.date || !result.startTime || !result.startsIn) {
      // Find all text nodes in the document
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      
      const datePattern = /(\d{1,2}\s+[A-Za-z]+\s+\d{4})|([A-Za-z]+\s+\d{1,2},?\s+\d{4})|(Today|Tomorrow|\w+day)/i;
      const timePattern = /(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i;
      const countdownPattern = /(Starts in\s+[\dh\s]+|Starting in\s+[\dh\s]+|Starts\s+[\dh\s]+)/i;
      
      let node;
      while ((node = walker.nextNode()) !== null) {
        const text = node.textContent.trim();
        if (!text || text.length < 2 || text.length > 100) continue;
        
        // Skip navigation or menu text
        if (text.includes('Menu') || text.includes('Login') || text.includes('Sign up') ||
            text.includes('Search') || text.includes('Live Scores') || text.includes('Schedule')) {
          continue;
        }
        
        if (!result.date) {
          const dateMatch = text.match(datePattern);
          if (dateMatch) {
            result.date = dateMatch[0];
            logs.push({ selector: 'text: date pattern', found: true, value: result.date });
          }
        }
        
        if (!result.startTime) {
          const timeMatch = text.match(timePattern);
          if (timeMatch) {
            result.startTime = timeMatch[0];
            logs.push({ selector: 'text: time pattern', found: true, value: result.startTime });
          }
        }
        
        if (!result.startsIn) {
          const countdownMatch = text.match(countdownPattern);
          if (countdownMatch) {
            result.startsIn = countdownMatch[0];
            logs.push({ selector: 'text: countdown pattern', found: true, value: result.startsIn });
          }
        }
        
        if (result.date && result.startTime && result.startsIn) break;
      }
    }

    // ============================================================
    // STRATEGY 4: Search in parent container of teamProfile
    // ============================================================
    if (!result.date || !result.startTime) {
      const teamProfiles = this.queryAll(document, '.teamProfile');
      for (const profile of teamProfiles) {
        const parent = profile.parentElement;
        if (parent) {
          const parentText = this.getText(parent);
          
          // Search for date in parent
          if (!result.date) {
            const dateMatch = parentText.match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})|([A-Za-z]+\s+\d{1,2},?\s+\d{4})|(Today|Tomorrow|\w+day)/i);
            if (dateMatch) {
              result.date = dateMatch[0];
              logs.push({ selector: 'parent container: date', found: true, value: result.date });
            }
          }
          
          // Search for time in parent
          if (!result.startTime) {
            const timeMatch = parentText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
            if (timeMatch) {
              result.startTime = timeMatch[0];
              logs.push({ selector: 'parent container: time', found: true, value: result.startTime });
            }
          }
          
          if (result.date && result.startTime) break;
        }
      }
    }

    // ============================================================
    // STRATEGY 5: Clean up extracted values
    // ============================================================
    
    // If date contains time, split them
    if (result.date && result.date.match(/\d{1,2}:\d{2}/)) {
      const dateTimeMatch = result.date.match(/^(.*?)(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
      if (dateTimeMatch) {
        result.date = dateTimeMatch[1].trim();
        if (!result.startTime) {
          result.startTime = dateTimeMatch[2];
        }
        logs.push({ selector: 'split date/time', found: true, value: `${result.date} | ${result.startTime}` });
      }
    }
    
    // Clean up date
    if (result.date) {
      // Remove extra text
      result.date = result.date.replace(/Team Form|Stats|News|Squads|Points Table|Head To Head/g, '').trim();
      // Remove team names from date
      const teams = ['West Indies', 'Pakistan', 'Zimbabwe', 'India', 'England', 'Australia', 
                     'South Africa', 'New Zealand', 'Sri Lanka', 'Bangladesh', 'Afghanistan', 'Ireland'];
      for (const team of teams) {
        result.date = result.date.replace(team, '').trim();
      }
      // Clean up multiple spaces
      result.date = result.date.replace(/\s+/g, ' ').trim();
    }
    
    // Clean up time
    if (result.startTime) {
      result.startTime = result.startTime.replace(/\s+/g, ' ').trim();
    }
    
    // Clean up startsIn
    if (result.startsIn) {
      result.startsIn = result.startsIn.replace(/\s+/g, ' ').trim();
    }

    return result;
  }

  // ============================================================
  // EXTRACT UPCOMING MATCH - COMPREHENSIVE
  // ============================================================
  extractUpcoming(document, logs) {
    const result = {
      date: '',
      startTime: '',
      startsIn: '',
      team1Name: '',
      team2Name: '',
      team1Flag: '',
      team2Flag: '',
      venue: '',
    };

    // ============================================================
    // EXTRACT SCHEDULE (Date, Time, StartsIn)
    // ============================================================
    const schedule = this.extractUpcomingSchedule(document, logs);
    result.date = schedule.date;
    result.startTime = schedule.startTime;
    result.startsIn = schedule.startsIn;

    // ============================================================
    // EXTRACT TEAM NAMES AND FLAGS
    // ============================================================
    const teamProfiles = this.queryAll(document, '.teamProfile');
    logs.push({ selector: '.teamProfile count', found: true, value: `${teamProfiles.length} found` });

    if (teamProfiles.length >= 2) {
      // Team 1
      const profile1 = teamProfiles[0];
      const team1NameEl = this.query(profile1, '.teamNameUpc, .team-name, .name');
      if (team1NameEl) {
        result.team1Name = this.getText(team1NameEl);
        logs.push({ selector: '.teamNameUpc', found: true, value: result.team1Name });
      }

      const flag1Img = this.query(profile1, '.teamFlagUpc img');
      if (flag1Img) {
        const src = flag1Img.getAttribute('src');
        const currentSrc = flag1Img.currentSrc || '';
        const validSrc = src || currentSrc || '';
        if (validSrc.includes('cricketvectors.akamaized.net/Teams/')) {
          result.team1Flag = validSrc;
          logs.push({ selector: '.teamFlagUpc img', found: true, value: 'Flag found' });
        }
      }

      // Team 2
      const profile2 = teamProfiles[1];
      const team2NameEl = this.query(profile2, '.teamNameUpc, .team-name, .name');
      if (team2NameEl) {
        result.team2Name = this.getText(team2NameEl);
        logs.push({ selector: '.teamNameUpc', found: true, value: result.team2Name });
      }

      const flag2Img = this.query(profile2, '.teamFlagUpc img');
      if (flag2Img) {
        const src = flag2Img.getAttribute('src');
        const currentSrc = flag2Img.currentSrc || '';
        const validSrc = src || currentSrc || '';
        if (validSrc.includes('cricketvectors.akamaized.net/Teams/')) {
          result.team2Flag = validSrc;
          logs.push({ selector: '.teamFlagUpc img', found: true, value: 'Flag found' });
        }
      }
    }

    // ============================================================
    // FALLBACK: Find flags using src attribute
    // ============================================================
    if (!result.team1Flag || !result.team2Flag) {
      const allImgs = this.queryAll(document, 'img');
      const flagImages = [];
      for (const img of allImgs) {
        const src = img.getAttribute('src');
        const currentSrc = img.currentSrc || '';
        const validSrc = src || currentSrc || '';
        if (validSrc && validSrc.includes('cricketvectors.akamaized.net/Teams/')) {
          flagImages.push(validSrc);
        }
      }
      if (flagImages.length >= 2) {
        if (!result.team1Flag) result.team1Flag = flagImages[0];
        if (!result.team2Flag) result.team2Flag = flagImages[1];
        logs.push({ selector: 'img[src*="cricketvectors.akamaized.net/Teams/"] (fallback)', found: true, value: 'Flags found' });
      }
    }

    // ============================================================
    // TEAM NAMES FALLBACK FROM H1
    // ============================================================
    if (!result.team1Name || !result.team2Name) {
      const h1 = this.query(document, 'h1');
      if (h1) {
        const h1Text = this.getText(h1);
        const vsMatch = h1Text.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)/i);
        if (vsMatch) {
          result.team1Name = this.cleanText(vsMatch[1]);
          result.team2Name = this.cleanText(vsMatch[2]);
          logs.push({ selector: 'h1 fallback', found: true, value: `${result.team1Name} vs ${result.team2Name}` });
        }
      }
    }

    // ============================================================
    // VENUE
    // ============================================================
    if (!result.venue) {
      const venueEl = this.findFirst(document, SELECTORS.common.venue);
      if (venueEl) {
        result.venue = this.getText(venueEl);
        logs.push({ selector: 'venue', found: true, value: result.venue });
      }
    }

    return result;
  }

  // ============================================================
  // EXTRACT LIVE MATCH
  // ============================================================
  extractLive(document, logs) {
    const result = {
      team1Name: '',
      team2Name: '',
      team1Score: '',
      team2Score: '',
      team1Wickets: '',
      team2Wickets: '',
      team1Overs: '',
      team2Overs: '',
      team1Flag: '',
      team2Flag: '',
      batsmen: [],
      bowlerName: '',
      bowlerOvers: '',
      bowlerMaidens: '',
      bowlerRuns: '',
      bowlerWickets: '',
      bowlerEconomy: '',
      oversTimeline: [],
      crr: '',
      rrr: '',
      partnership: '',
    };

    const teamInnings = this.queryAll(document, SELECTORS.live.teamInning);
    if (teamInnings.length >= 2) {
      logs.push({ selector: '.team-innig', found: true, value: `Found ${teamInnings.length} innings` });

      const t1 = teamInnings[0];
      const t1Name = this.query(t1, SELECTORS.live.teamName);
      if (t1Name) {
        result.team1Name = this.getText(t1Name);
        logs.push({ selector: '.team-name', found: true, value: result.team1Name });
      }

      const t1Flag = this.query(t1, SELECTORS.live.teamFlag);
      if (t1Flag) {
        result.team1Flag = t1Flag.getAttribute('src') || '';
        logs.push({ selector: '.team-img img', found: true, value: 'Flag found' });
      }

      const t1Score = this.query(t1, SELECTORS.live.scoreFirst);
      if (t1Score) {
        const scoreText = this.getText(t1Score);
        const scoreMatch = scoreText.match(/(\d+)[-/](\d+)/);
        if (scoreMatch) {
          result.team1Score = scoreMatch[1];
          result.team1Wickets = scoreMatch[2];
        } else {
          result.team1Score = scoreText;
        }
        logs.push({ selector: '.team-score .runs span:first-child', found: true, value: scoreText });
      }

      const t1Overs = this.query(t1, SELECTORS.live.scoreLast);
      if (t1Overs) {
        result.team1Overs = this.getText(t1Overs).replace(/[()]/g, '');
        logs.push({ selector: '.team-score .runs span:last-child', found: true, value: result.team1Overs });
      }

      const t2 = teamInnings[1];
      const t2Name = this.query(t2, SELECTORS.live.teamName);
      if (t2Name) {
        result.team2Name = this.getText(t2Name);
        logs.push({ selector: '.team-name', found: true, value: result.team2Name });
      }

      const t2Flag = this.query(t2, SELECTORS.live.teamFlag);
      if (t2Flag) {
        result.team2Flag = t2Flag.getAttribute('src') || '';
        logs.push({ selector: '.team-img img', found: true, value: 'Flag found' });
      }

      const t2Score = this.query(t2, SELECTORS.live.scoreFirst);
      if (t2Score) {
        const scoreText = this.getText(t2Score);
        const scoreMatch = scoreText.match(/(\d+)[-/](\d+)/);
        if (scoreMatch) {
          result.team2Score = scoreMatch[1];
          result.team2Wickets = scoreMatch[2];
        } else {
          result.team2Score = scoreText;
        }
        logs.push({ selector: '.team-score .runs span:first-child', found: true, value: scoreText });
      }

      const t2Overs = this.query(t2, SELECTORS.live.scoreLast);
      if (t2Overs) {
        result.team2Overs = this.getText(t2Overs).replace(/[()]/g, '');
        logs.push({ selector: '.team-score .runs span:last-child', found: true, value: result.team2Overs });
      }
    }

    // Batsmen
    const batsmenContainer = this.findFirst(document, SELECTORS.live.batsmen);
    if (batsmenContainer) {
      logs.push({ selector: '.batsmen-partnership', found: true, value: 'Found' });
      
      const batsmanEls = this.queryAll(batsmenContainer, SELECTORS.live.batsman);
      for (const el of batsmanEls) {
        const nameEl = this.query(el, SELECTORS.live.batsmanName);
        const scoreEls = this.queryAll(el, SELECTORS.live.batsmanScore);
        
        const batsman = {
          name: nameEl ? this.getText(nameEl) : '',
          runs: scoreEls.length > 0 ? this.getText(scoreEls[0]) : '',
          balls: scoreEls.length > 1 ? this.getText(scoreEls[1]) : '',
        };
        
        if (batsman.name) {
          result.batsmen.push(batsman);
        }
      }
    }

    // Bowler
    const bowlerContainer = this.findFirst(document, SELECTORS.live.bowler);
    if (bowlerContainer) {
      logs.push({ selector: '.bowler-info', found: true, value: 'Found' });
      
      const nameEl = this.query(bowlerContainer, SELECTORS.live.bowlerName);
      if (nameEl) {
        result.bowlerName = this.getText(nameEl);
      }

      const stats = this.getText(bowlerContainer);
      const statsMatch = stats.match(/([\d.]+)\s+ov\s+(\d+)\s+m\s+(\d+)\s+r\s+(\d+)\s+w\s+([\d.]+)/i);
      if (statsMatch) {
        result.bowlerOvers = statsMatch[1];
        result.bowlerMaidens = statsMatch[2];
        result.bowlerRuns = statsMatch[3];
        result.bowlerWickets = statsMatch[4];
        result.bowlerEconomy = statsMatch[5];
      }
    }

    // Overs timeline
    const timelineContainer = this.findFirst(document, SELECTORS.live.timeline);
    if (timelineContainer) {
      logs.push({ selector: '.overs-timeline', found: true, value: 'Found' });
      
      const overEls = this.queryAll(timelineContainer, SELECTORS.live.over);
      for (const el of overEls) {
        const overNumberEl = this.query(el, SELECTORS.live.overNumber);
        const balls = [];
        
        const ballEls = this.queryAll(el, SELECTORS.live.ball);
        for (const ballEl of ballEls) {
          const text = this.getText(ballEl);
          if (text) {
            balls.push(text);
          }
        }

        if (overNumberEl || balls.length > 0) {
          result.oversTimeline.push({
            over: overNumberEl ? this.getText(overNumberEl) : '',
            balls: balls
          });
        }
      }
    }

    // CRR, RRR, Partnership
    const crrEl = this.findFirst(document, SELECTORS.live.crr);
    if (crrEl) {
      result.crr = this.getText(crrEl);
      logs.push({ selector: '.crr', found: true, value: result.crr });
    }

    const rrrEl = this.findFirst(document, SELECTORS.live.rrr);
    if (rrrEl) {
      result.rrr = this.getText(rrrEl);
      logs.push({ selector: '.rrr', found: true, value: result.rrr });
    }

    const partnershipEl = this.findFirst(document, SELECTORS.live.partnership);
    if (partnershipEl) {
      result.partnership = this.getText(partnershipEl);
      logs.push({ selector: '.partnership', found: true, value: result.partnership });
    }

    return result;
  }

  // ============================================================
  // EXTRACT COMPLETED MATCH
  // ============================================================
  extractCompleted(document, logs) {
    const result = {
      result: '',
      winningTeam: '',
      margin: '',
      marginType: '',
      playerOfMatch: '',
      playerImage: '',
      playerPerformance: '',
      playerTeam: '',
      team1Name: '',
      team2Name: '',
      team1Score: '',
      team2Score: '',
      team1Wickets: '',
      team2Wickets: '',
      team1Overs: '',
      team2Overs: '',
      team1Flag: '',
      team2Flag: '',
      batsmen: [],
      bowlerName: '',
      bowlerOvers: '',
      bowlerMaidens: '',
      bowlerRuns: '',
      bowlerWickets: '',
      bowlerEconomy: '',
      oversTimeline: [],
    };

    const resultEl = this.findFirst(document, SELECTORS.completed.result);
    if (resultEl) {
      const resultText = this.getText(resultEl);
      const match = resultText.match(/([A-Za-z\s]+)\s+won by\s+(\d+)\s+(wkts|runs|wickets?)/i);
      if (match) {
        result.result = match[0];
        result.winningTeam = this.cleanText(match[1]);
        result.margin = match[2];
        result.marginType = match[3];
        logs.push({ selector: '.result', found: true, value: result.result });
      } else {
        result.result = resultText;
        logs.push({ selector: '.result', found: true, value: resultText });
      }
    }

    const pomEl = this.findFirst(document, SELECTORS.completed.playerOfMatch);
    if (pomEl) {
      logs.push({ selector: '.player-of-match', found: true, value: 'Found' });
      
      const nameEl = this.query(pomEl, SELECTORS.completed.playerName);
      if (nameEl) {
        result.playerOfMatch = this.getText(nameEl);
        logs.push({ selector: '.player-name', found: true, value: result.playerOfMatch });
      }

      const imgEl = this.query(pomEl, SELECTORS.completed.playerImage);
      if (imgEl) {
        result.playerImage = imgEl.getAttribute('src') || '';
      }

      const perfEl = this.query(pomEl, SELECTORS.completed.playerPerformance);
      if (perfEl) {
        result.playerPerformance = this.getText(perfEl);
      }

      const teamEl = this.query(pomEl, SELECTORS.completed.playerTeam);
      if (teamEl) {
        result.playerTeam = this.getText(teamEl);
      }
    }

    const liveData = this.extractLive(document, logs);
    result.team1Name = liveData.team1Name;
    result.team2Name = liveData.team2Name;
    result.team1Score = liveData.team1Score;
    result.team2Score = liveData.team2Score;
    result.team1Wickets = liveData.team1Wickets;
    result.team2Wickets = liveData.team2Wickets;
    result.team1Overs = liveData.team1Overs;
    result.team2Overs = liveData.team2Overs;
    result.team1Flag = liveData.team1Flag;
    result.team2Flag = liveData.team2Flag;
    result.batsmen = liveData.batsmen || [];
    result.bowlerName = liveData.bowlerName || '';
    result.bowlerOvers = liveData.bowlerOvers || '';
    result.bowlerMaidens = liveData.bowlerMaidens || '';
    result.bowlerRuns = liveData.bowlerRuns || '';
    result.bowlerWickets = liveData.bowlerWickets || '';
    result.bowlerEconomy = liveData.bowlerEconomy || '';
    result.oversTimeline = liveData.oversTimeline || [];

    return result;
  }

  // ============================================================
  // EXTRACT COMMON FIELDS
  // ============================================================
  extractCommon(document, logs) {
    const result = {
      series: '',
      matchTitle: '',
      matchNumber: '',
      venue: '',
      tossWinner: '',
      tossDecision: '',
      umpires: [],
      thirdUmpire: '',
      matchReferee: '',
    };

    const seriesEl = this.findFirst(document, SELECTORS.common.series);
    if (seriesEl) {
      result.series = this.getText(seriesEl);
      logs.push({ selector: 'series', found: true, value: result.series });
    }

    const titleEl = this.findFirst(document, SELECTORS.common.title);
    if (titleEl) {
      result.matchTitle = this.getText(titleEl);
      logs.push({ selector: 'title', found: true, value: result.matchTitle });
    }

    const numEl = this.findFirst(document, SELECTORS.common.matchNumber);
    if (numEl) {
      result.matchNumber = this.getText(numEl);
      logs.push({ selector: 'matchNumber', found: true, value: result.matchNumber });
    }

    const venueEl = this.findFirst(document, SELECTORS.common.venue);
    if (venueEl) {
      result.venue = this.getText(venueEl);
      logs.push({ selector: 'venue', found: true, value: result.venue });
    }

    const tossEl = this.findFirst(document, SELECTORS.common.toss);
    if (tossEl) {
      const text = this.getText(tossEl);
      const match = text.match(/([A-Za-z\s]+)\s+won the toss/i);
      if (match) {
        result.tossWinner = this.cleanText(match[1]);
        const decisionMatch = text.match(/opted to (bowl|bat|field)/i);
        if (decisionMatch) {
          result.tossDecision = `opted to ${decisionMatch[1]}`;
        }
        logs.push({ selector: 'toss', found: true, value: `${result.tossWinner} ${result.tossDecision}` });
      }
    }

    const officialsEl = this.findFirst(document, SELECTORS.common.officials);
    if (officialsEl) {
      const text = this.getText(officialsEl);
      const umpireMatch = text.match(/Umpires?:\s*([A-Za-z\s,]+)/i);
      if (umpireMatch) {
        result.umpires = umpireMatch[1].split(',').map(u => this.cleanText(u));
        logs.push({ selector: 'umpires', found: true, value: result.umpires.join(', ') });
      }
      const thirdMatch = text.match(/Third Umpire:\s*([A-Za-z\s]+)/i);
      if (thirdMatch) {
        result.thirdUmpire = this.cleanText(thirdMatch[1]);
        logs.push({ selector: 'thirdUmpire', found: true, value: result.thirdUmpire });
      }
      const refereeMatch = text.match(/Match Referee:\s*([A-Za-z\s]+)/i);
      if (refereeMatch) {
        result.matchReferee = this.cleanText(refereeMatch[1]);
        logs.push({ selector: 'matchReferee', found: true, value: result.matchReferee });
      }
    }

    return result;
  }

  // ============================================================
  // MERGE RESULTS
  // ============================================================
  mergeResults(jsonData, apiData, domData, homepageData) {
    const merged = {};

    const sources = [
      { data: jsonData, label: 'JSON', level: 1 },
      { data: apiData, label: 'API', level: 2 },
      { data: domData, label: 'DOM', level: 3 },
      { data: homepageData, label: 'Homepage', level: 4 },
    ];

    const sourceLogs = [];

    for (const source of sources) {
      if (!source.data) continue;
      
      for (const [key, value] of Object.entries(source.data)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value) && value.length === 0) continue;
        if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) continue;
        
        if (merged[key] !== undefined && merged[key] !== '' && merged[key] !== null) {
          if (typeof merged[key] === 'object' && Object.keys(merged[key]).length > 0) continue;
          if (Array.isArray(merged[key]) && merged[key].length > 0) continue;
          if (merged[key] !== '') continue;
        }
        
        merged[key] = value;
        sourceLogs.push(`${key} from ${source.label}`);
      }
    }

    if (sourceLogs.length > 0) {
      logger.debug(`✅ Merged: ${sourceLogs.join(', ')}`);
    }

    return merged;
  }

  // ============================================================
  // FETCH MATCH DATA - MAIN EXTRACTION ENGINE
  // ============================================================
  async fetchMatchDataWithEvaluate(url, retries = 2) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (!this.browser) {
          await this.initialize();
        }

        logger.info(`🌐 Extracting data from: ${url}`);

        this.apiResponses = [];

        await this.page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        // Wait for content
        const upcomingSelectors = [
          '.teamProfile', '.flexColumn', '.val1-text', '.val2-text', '.time-text',
          '.match-date', '.match-time', '.date', '.time', '.schedule',
          '.match-container', '.match-details',
        ];

        let contentFound = false;
        for (const selector of upcomingSelectors) {
          try {
            await this.page.waitForSelector(selector, { timeout: 5000 });
            contentFound = true;
            logger.info(`✅ Upcoming content found: ${selector}`);
            break;
          } catch (e) {}
        }

        if (!contentFound) {
          await this.page.waitForTimeout(3000);
          logger.info('⏳ Waiting 3s for dynamic content');
        }

        await this.page.waitForTimeout(2000);

        const html = await this.page.content();

        // LAYER 1: Extract Hydration JSON
        let jsonData = null;
        const hydrationData = this.extractHydrationData(html);
        if (hydrationData.match) {
          jsonData = hydrationData.match;
          this.stats.jsonDataFound++;
          logger.info(`✅ Hydration JSON found (source: ${hydrationData.source || 'unknown'})`);
        }

        // LAYER 2: Extract API Data
        let apiData = this.extractApiData();
        if (apiData) {
          this.stats.apiDataFound++;
          logger.info(`✅ API data found (${this.apiResponses.length} responses)`);
        }

        // LAYER 3: DOM Extraction
        const domResult = await this.page.evaluate((selectors) => {
          const logs = [];

          const getText = (element) => {
            if (!element) return '';
            return element.textContent ? element.textContent.replace(/\s+/g, ' ').trim() : '';
          };

          const query = (document, selector) => {
            try { return document.querySelector(selector); } catch (e) { return null; }
          };

          const queryAll = (document, selector) => {
            try { return document.querySelectorAll(selector); } catch (e) { return []; }
          };

          const findFirst = (document, selectors) => {
            for (const selector of selectors) {
              const el = query(document, selector);
              if (el) return el;
            }
            return null;
          };

          // Date/Time/Countdown selectors
          const dateSelectors = [
            '.val1-text', '.match-date', '.date', '.schedule-date',
            '.day', '.fixture-date', '.start-date', '.match-day', '.event-date'
          ];
          const timeSelectors = [
            '.val2-text', '.match-time', '.time', '.schedule-time',
            '.start-time', '.fixture-time', '.event-time'
          ];
          const countdownSelectors = [
            '.time-text', '.starts-in', '.countdown', '.remaining-time', '.schedule-countdown'
          ];

          // Detect page type
          let pageType = 'UPCOMING';
          
          const badgeSelectors = selectors.status.badge;
          for (const selector of badgeSelectors) {
            const badge = query(document, selector);
            if (badge) {
              const text = getText(badge).toLowerCase();
              if (text.includes('live')) { pageType = 'LIVE'; break; }
              if (text.includes('upcoming') || text.includes('up coming')) { pageType = 'UPCOMING'; break; }
              if (text.includes('completed') || text.includes('finished')) { pageType = 'COMPLETED'; break; }
              if (text.includes('abandoned')) { pageType = 'ABANDONED'; break; }
              if (text.includes('result')) { pageType = 'COMPLETED'; break; }
            }
          }

          if (pageType === 'UPCOMING') {
            for (const selector of selectors.status.resultBanner) {
              const banner = query(document, selector);
              if (banner) {
                const text = getText(banner);
                if (text.includes('won by') || text.includes('result') || text.includes('tie')) {
                  pageType = 'COMPLETED';
                  break;
                }
              }
            }
          }

          if (pageType === 'UPCOMING') {
            const teamInnings = queryAll(document, selectors.live.teamInning);
            if (teamInnings.length >= 2) {
              for (const inn of teamInnings) {
                const score = query(inn, selectors.live.teamScore);
                if (score) {
                  const scoreText = getText(score);
                  if (scoreText && scoreText.match(/\d+/)) {
                    const resultEl = query(document, selectors.completed.result);
                    if (resultEl) {
                      const resultText = getText(resultEl);
                      if (resultText.includes('won by')) {
                        pageType = 'COMPLETED';
                      } else {
                        pageType = 'LIVE';
                      }
                    } else {
                      pageType = 'LIVE';
                    }
                    break;
                  }
                }
              }
            }
          }

          logs.push({ selector: 'pageType', found: true, value: pageType });

          // Extract common fields
          const common = {};
          const seriesEl = findFirst(document, selectors.common.series);
          if (seriesEl) common.series = getText(seriesEl);
          
          const titleEl = findFirst(document, selectors.common.title);
          if (titleEl) common.matchTitle = getText(titleEl);
          
          const numEl = findFirst(document, selectors.common.matchNumber);
          if (numEl) common.matchNumber = getText(numEl);
          
          const venueEl = findFirst(document, selectors.common.venue);
          if (venueEl) common.venue = getText(venueEl);

          const tossEl = findFirst(document, selectors.common.toss);
          if (tossEl) {
            const text = getText(tossEl);
            const match = text.match(/([A-Za-z\s]+)\s+won the toss/i);
            if (match) {
              common.tossWinner = match[1].trim();
              const decisionMatch = text.match(/opted to (bowl|bat|field)/i);
              if (decisionMatch) {
                common.tossDecision = `opted to ${decisionMatch[1]}`;
              }
            }
          }

          const officialsEl = findFirst(document, selectors.common.officials);
          if (officialsEl) {
            const text = getText(officialsEl);
            const umpireMatch = text.match(/Umpires?:\s*([A-Za-z\s,]+)/i);
            if (umpireMatch) {
              common.umpires = umpireMatch[1].split(',').map(u => u.trim());
            }
            const thirdMatch = text.match(/Third Umpire:\s*([A-Za-z\s]+)/i);
            if (thirdMatch) {
              common.thirdUmpire = thirdMatch[1].trim();
            }
            const refereeMatch = text.match(/Match Referee:\s*([A-Za-z\s]+)/i);
            if (refereeMatch) {
              common.matchReferee = refereeMatch[1].trim();
            }
          }

          // Extract page-specific data
          let pageData = {};
          let status = 'UPCOMING';

          if (pageType === 'UPCOMING') {
            // ============================================================
            // EXTRACT SCHEDULE (Date, Time, StartsIn) - COMPREHENSIVE
            // ============================================================
            let date = '';
            let startTime = '';
            let startsIn = '';

            // Strategy 1: Search flexColumn
            const flexColumns = queryAll(document, '.flexColumn');
            logs.push({ selector: '.flexColumn count', found: true, value: `${flexColumns.length} found` });
            
            for (let i = 0; i < flexColumns.length; i++) {
              const container = flexColumns[i];
              const text = getText(container);
              
              if (text.includes('Team Form') || text.includes('Prediction') || 
                  text.includes('Fantasy') || text.includes('Stats') || 
                  text.includes('News') || text.includes('Squads') || 
                  text.includes('Points Table') || text.includes('Head To Head')) {
                continue;
              }
              
              logs.push({ 
                selector: `flexColumn[${i}]`, 
                found: true, 
                value: text.substring(0, 80) + (text.length > 80 ? '...' : '') 
              });
              
              // Date from child elements
              for (const selector of dateSelectors) {
                const el = query(container, selector);
                if (el) {
                  const dateText = getText(el);
                  if (dateText && !dateText.includes('Team Form') && !dateText.includes('vs')) {
                    date = dateText;
                    logs.push({ selector, found: true, value: date });
                    break;
                  }
                }
              }
              
              // Time from child elements
              for (const selector of timeSelectors) {
                const el = query(container, selector);
                if (el) {
                  const timeText = getText(el);
                  if (timeText && (timeText.match(/\d{1,2}:\d{2}/) || timeText.match(/AM|PM/i))) {
                    startTime = timeText;
                    logs.push({ selector, found: true, value: startTime });
                    break;
                  }
                }
              }
              
              // Countdown from child elements
              for (const selector of countdownSelectors) {
                const el = query(container, selector);
                if (el) {
                  const countdownText = getText(el);
                  if (countdownText && (countdownText.includes('Starts') || countdownText.includes('s'))) {
                    startsIn = countdownText;
                    logs.push({ selector, found: true, value: startsIn });
                    break;
                  }
                }
              }
              
              if (date && startTime) break;
            }

            // Strategy 2: Global class-based search
            if (!date || !startTime) {
              for (const selector of dateSelectors) {
                const elements = queryAll(document, selector);
                for (const el of elements) {
                  const text = getText(el);
                  if (text && !text.includes('Team Form') && !text.includes('vs')) {
                    if (text.match(/\d{1,2}\s+[A-Za-z]+\s+\d{4}/) || 
                        text.match(/[A-Za-z]+\s+\d{1,2},?\s+\d{4}/) ||
                        text.includes('Today') || text.includes('Tomorrow') || 
                        text.includes('Monday') || text.includes('Tuesday') || 
                        text.includes('Wednesday') || text.includes('Thursday') || 
                        text.includes('Friday') || text.includes('Saturday') || 
                        text.includes('Sunday')) {
                      date = text;
                      logs.push({ selector, found: true, value: date });
                      break;
                    }
                  }
                }
                if (date) break;
              }
              
              for (const selector of timeSelectors) {
                const elements = queryAll(document, selector);
                for (const el of elements) {
                  const text = getText(el);
                  if (text && (text.match(/\d{1,2}:\d{2}/) || text.match(/AM|PM/i))) {
                    startTime = text;
                    logs.push({ selector, found: true, value: startTime });
                    break;
                  }
                }
                if (startTime) break;
              }
              
              for (const selector of countdownSelectors) {
                const elements = queryAll(document, selector);
                for (const el of elements) {
                  const text = getText(el);
                  if (text && (text.includes('Starts') || text.includes('s'))) {
                    startsIn = text;
                    logs.push({ selector, found: true, value: startsIn });
                    break;
                  }
                }
                if (startsIn) break;
              }
            }

            // Strategy 3: Text pattern search
            if (!date || !startTime || !startsIn) {
              const datePattern = /(\d{1,2}\s+[A-Za-z]+\s+\d{4})|([A-Za-z]+\s+\d{1,2},?\s+\d{4})|(Today|Tomorrow|\w+day)/i;
              const timePattern = /(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i;
              const countdownPattern = /(Starts in\s+[\dh\s]+|Starting in\s+[\dh\s]+)/i;
              
              const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                null,
                false
              );
              
              let node;
              while ((node = walker.nextNode()) !== null) {
                const text = node.textContent.trim();
                if (!text || text.length < 2 || text.length > 100) continue;
                if (text.includes('Menu') || text.includes('Login') || text.includes('Sign up') ||
                    text.includes('Search') || text.includes('Live Scores') || text.includes('Schedule')) {
                  continue;
                }
                
                if (!date) {
                  const dateMatch = text.match(datePattern);
                  if (dateMatch) {
                    date = dateMatch[0];
                    logs.push({ selector: 'text: date pattern', found: true, value: date });
                  }
                }
                
                if (!startTime) {
                  const timeMatch = text.match(timePattern);
                  if (timeMatch) {
                    startTime = timeMatch[0];
                    logs.push({ selector: 'text: time pattern', found: true, value: startTime });
                  }
                }
                
                if (!startsIn) {
                  const countdownMatch = text.match(countdownPattern);
                  if (countdownMatch) {
                    startsIn = countdownMatch[0];
                    logs.push({ selector: 'text: countdown pattern', found: true, value: startsIn });
                  }
                }
                
                if (date && startTime && startsIn) break;
              }
            }

            // Strategy 4: Search in parent container of teamProfile
            if (!date || !startTime) {
              const teamProfiles = queryAll(document, '.teamProfile');
              for (const profile of teamProfiles) {
                const parent = profile.parentElement;
                if (parent) {
                  const parentText = getText(parent);
                  if (!date) {
                    const dateMatch = parentText.match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})|([A-Za-z]+\s+\d{1,2},?\s+\d{4})|(Today|Tomorrow|\w+day)/i);
                    if (dateMatch) {
                      date = dateMatch[0];
                      logs.push({ selector: 'parent container: date', found: true, value: date });
                    }
                  }
                  if (!startTime) {
                    const timeMatch = parentText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
                    if (timeMatch) {
                      startTime = timeMatch[0];
                      logs.push({ selector: 'parent container: time', found: true, value: startTime });
                    }
                  }
                  if (date && startTime) break;
                }
              }
            }

            // Clean up extracted values
            if (date && date.match(/\d{1,2}:\d{2}/)) {
              const dateTimeMatch = date.match(/^(.*?)(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
              if (dateTimeMatch) {
                date = dateTimeMatch[1].trim();
                if (!startTime) {
                  startTime = dateTimeMatch[2];
                }
                logs.push({ selector: 'split date/time', found: true, value: `${date} | ${startTime}` });
              }
            }
            
            if (date) {
              date = date.replace(/Team Form|Stats|News|Squads|Points Table|Head To Head/g, '').trim();
              const teams = ['West Indies', 'Pakistan', 'Zimbabwe', 'India', 'England', 'Australia', 
                             'South Africa', 'New Zealand', 'Sri Lanka', 'Bangladesh', 'Afghanistan', 'Ireland'];
              for (const team of teams) {
                date = date.replace(team, '').trim();
              }
              date = date.replace(/\s+/g, ' ').trim();
            }
            
            if (startTime) {
              startTime = startTime.replace(/\s+/g, ' ').trim();
            }
            
            if (startsIn) {
              startsIn = startsIn.replace(/\s+/g, ' ').trim();
            }

            pageData.date = date;
            pageData.startTime = startTime;
            pageData.startsIn = startsIn;

            // ============================================================
            // EXTRACT TEAM PROFILES WITH FLAGS
            // ============================================================
            const teamProfiles = queryAll(document, '.teamProfile');
            logs.push({ selector: '.teamProfile count', found: true, value: `${teamProfiles.length} found` });

            if (teamProfiles.length >= 2) {
              const profile1 = teamProfiles[0];
              const team1NameEl = query(profile1, '.teamNameUpc, .team-name, .name');
              if (team1NameEl) {
                pageData.team1Name = getText(team1NameEl);
                logs.push({ selector: '.teamNameUpc', found: true, value: pageData.team1Name });
              }

              const flag1Img = query(profile1, '.teamFlagUpc img');
              if (flag1Img) {
                const src = flag1Img.getAttribute('src');
                const currentSrc = flag1Img.currentSrc || '';
                const validSrc = src || currentSrc || '';
                if (validSrc.includes('cricketvectors.akamaized.net/Teams/')) {
                  pageData.team1Flag = validSrc;
                  logs.push({ selector: '.teamFlagUpc img', found: true, value: 'Flag found' });
                }
              }

              const profile2 = teamProfiles[1];
              const team2NameEl = query(profile2, '.teamNameUpc, .team-name, .name');
              if (team2NameEl) {
                pageData.team2Name = getText(team2NameEl);
                logs.push({ selector: '.teamNameUpc', found: true, value: pageData.team2Name });
              }

              const flag2Img = query(profile2, '.teamFlagUpc img');
              if (flag2Img) {
                const src = flag2Img.getAttribute('src');
                const currentSrc = flag2Img.currentSrc || '';
                const validSrc = src || currentSrc || '';
                if (validSrc.includes('cricketvectors.akamaized.net/Teams/')) {
                  pageData.team2Flag = validSrc;
                  logs.push({ selector: '.teamFlagUpc img', found: true, value: 'Flag found' });
                }
              }
            }

            // Fallback flags
            if (!pageData.team1Flag || !pageData.team2Flag) {
              const allImgs = queryAll(document, 'img');
              const flagImages = [];
              for (const img of allImgs) {
                const src = img.getAttribute('src');
                const currentSrc = img.currentSrc || '';
                const validSrc = src || currentSrc || '';
                if (validSrc && validSrc.includes('cricketvectors.akamaized.net/Teams/')) {
                  flagImages.push(validSrc);
                }
              }
              if (flagImages.length >= 2) {
                if (!pageData.team1Flag) pageData.team1Flag = flagImages[0];
                if (!pageData.team2Flag) pageData.team2Flag = flagImages[1];
                logs.push({ selector: 'img[src*="cricketvectors.akamaized.net/Teams/"] (fallback)', found: true, value: 'Flags found' });
              }
            }

            // Team names fallback from h1
            if (!pageData.team1Name || !pageData.team2Name) {
              const h1 = query(document, 'h1');
              if (h1) {
                const h1Text = getText(h1);
                const vsMatch = h1Text.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)/i);
                if (vsMatch) {
                  pageData.team1Name = vsMatch[1].trim();
                  pageData.team2Name = vsMatch[2].trim();
                  logs.push({ selector: 'h1 fallback', found: true, value: `${pageData.team1Name} vs ${pageData.team2Name}` });
                }
              }
            }
            
            status = 'UPCOMING';
          } else if (pageType === 'COMPLETED') {
            // Completed parser
            const resultEl = findFirst(document, selectors.completed.result);
            if (resultEl) {
              const text = getText(resultEl);
              const match = text.match(/([A-Za-z\s]+)\s+won by\s+(\d+)\s+(wkts|runs|wickets?)/i);
              if (match) {
                pageData.result = match[0];
                pageData.winningTeam = match[1].trim();
                pageData.margin = match[2];
                pageData.marginType = match[3];
              } else {
                pageData.result = text;
              }
            }

            const pomEl = findFirst(document, selectors.completed.playerOfMatch);
            if (pomEl) {
              const nameEl = query(pomEl, selectors.completed.playerName);
              if (nameEl) {
                pageData.playerOfMatch = getText(nameEl);
              }
            }

            const inns = queryAll(document, selectors.live.teamInning);
            if (inns.length >= 2) {
              const t1 = inns[0];
              const t1Name = query(t1, selectors.live.teamName);
              if (t1Name) pageData.team1Name = getText(t1Name);
              
              const t1Score = query(t1, selectors.live.scoreFirst);
              if (t1Score) {
                const scoreText = getText(t1Score);
                const scoreMatch = scoreText.match(/(\d+)[-/](\d+)/);
                if (scoreMatch) {
                  pageData.team1Score = scoreMatch[1];
                  pageData.team1Wickets = scoreMatch[2];
                }
              }
              
              const t2 = inns[1];
              const t2Name = query(t2, selectors.live.teamName);
              if (t2Name) pageData.team2Name = getText(t2Name);
              
              const t2Score = query(t2, selectors.live.scoreFirst);
              if (t2Score) {
                const scoreText = getText(t2Score);
                const scoreMatch = scoreText.match(/(\d+)[-/](\d+)/);
                if (scoreMatch) {
                  pageData.team2Score = scoreMatch[1];
                  pageData.team2Wickets = scoreMatch[2];
                }
              }
              
              // Flags from team innings
              const t1Flag = query(t1, selectors.live.teamFlag);
              if (t1Flag) pageData.team1Flag = t1Flag.getAttribute('src') || '';
              const t2Flag = query(t2, selectors.live.teamFlag);
              if (t2Flag) pageData.team2Flag = t2Flag.getAttribute('src') || '';
            }
            status = 'RESULT';
          } else if (pageType === 'LIVE') {
            // Live parser
            const inns = queryAll(document, selectors.live.teamInning);
            if (inns.length >= 2) {
              const t1 = inns[0];
              const t1Name = query(t1, selectors.live.teamName);
              if (t1Name) pageData.team1Name = getText(t1Name);
              
              const t1Score = query(t1, selectors.live.scoreFirst);
              if (t1Score) {
                const scoreText = getText(t1Score);
                const scoreMatch = scoreText.match(/(\d+)[-/](\d+)/);
                if (scoreMatch) {
                  pageData.team1Score = scoreMatch[1];
                  pageData.team1Wickets = scoreMatch[2];
                }
              }
              
              const t1Overs = query(t1, selectors.live.scoreLast);
              if (t1Overs) {
                pageData.team1Overs = getText(t1Overs).replace(/[()]/g, '');
              }
              
              const t2 = inns[1];
              const t2Name = query(t2, selectors.live.teamName);
              if (t2Name) pageData.team2Name = getText(t2Name);
              
              const t2Score = query(t2, selectors.live.scoreFirst);
              if (t2Score) {
                const scoreText = getText(t2Score);
                const scoreMatch = scoreText.match(/(\d+)[-/](\d+)/);
                if (scoreMatch) {
                  pageData.team2Score = scoreMatch[1];
                  pageData.team2Wickets = scoreMatch[2];
                }
              }
              
              const t2Overs = query(t2, selectors.live.scoreLast);
              if (t2Overs) {
                pageData.team2Overs = getText(t2Overs).replace(/[()]/g, '');
              }
              
              // Flags from team innings
              const t1Flag = query(t1, selectors.live.teamFlag);
              if (t1Flag) pageData.team1Flag = t1Flag.getAttribute('src') || '';
              const t2Flag = query(t2, selectors.live.teamFlag);
              if (t2Flag) pageData.team2Flag = t2Flag.getAttribute('src') || '';
            }
            status = 'LIVE';
          }

          return {
            ...common,
            ...pageData,
            status,
            pageType,
            logs,
          };
        }, SELECTORS);

        // Merge all sources
        const mergedData = this.mergeResults(jsonData, apiData, domResult);

        if (!mergedData.status && domResult.status) {
          mergedData.status = domResult.status;
        }

        if (domResult.logs) {
          for (const log of domResult.logs) {
            if (log.found) {
              logger.debug(`  ✅ ${log.selector}: ${log.value || 'Found'}`);
            } else {
              logger.debug(`  ❌ ${log.selector}: ${log.value}`);
            }
          }
        }

        const mergedKeys = Object.keys(mergedData).filter(k => mergedData[k] && mergedData[k] !== '');
        logger.info(`✅ Merged ${mergedKeys.length} fields from all sources`);

        // Save debug HTML if upcoming schedule is missing
        if (mergedData.status === 'UPCOMING' && (!mergedData.date || !mergedData.startTime)) {
          const matchId = this.extractMatchId(url);
          await this.saveDebugData('upcoming_schedule', html, matchId);
          logger.warn(`⚠️ Upcoming match ${matchId} missing date/time - debug HTML saved`);
        }

        if (!mergedData.team1Name && !mergedData.team2Name && !mergedData.date && !mergedData.result) {
          logger.warn(`⚠️ Limited data extracted from ${url}`);
        }

        return mergedData;

      } catch (error) {
        logger.error(`❌ Extraction failed (attempt ${attempt}): ${error.message}`);
        logger.error(`  Stack: ${error.stack}`);
        if (attempt < retries) {
          await this.sleep(3000 * attempt);
        }
      }
    }
    return null;
  }

  // ============================================================
  // EXTRACT MATCHES FROM PAGE
  // ============================================================
  async extractMatchesFromPage() {
    try {
      logger.info('🔧 STEP 6: Extracting cards from page...');
      
      const matches = await this.page.$$eval('.live-card', (cards) => {
        const maxCards = 5;
        const processedCards = cards.slice(0, maxCards);

        return processedCards.map((card) => {
          const cleanText = (text) => {
            if (!text) return '';
            return text.replace(/\s+/g, ' ').trim();
          };

          const getHref = (element) => {
            if (!element) return '';
            return element.getAttribute('href') || '';
          };

          const matchLink = card.querySelector('a[href*="/cricket-live-score/"]');
          let matchUrl = matchLink ? getHref(matchLink) : '';

          let matchId = '';
          if (matchUrl) {
            const idMatch = matchUrl.match(/\/cricket-live-score\/([^/?]+)/);
            if (idMatch) matchId = idMatch[1];
          }

          const seriesNameEl = card.querySelector('.snameTag, .series-name');
          const seriesName = seriesNameEl ? cleanText(seriesNameEl.textContent) : '';

          const teamNames = card.querySelectorAll('.team-name');
          const teamScores = card.querySelectorAll('.team-score');

          return {
            matchId,
            matchUrl: matchUrl.startsWith('http') ? matchUrl : `https://crex.com${matchUrl}`,
            series: seriesName,
            team1: {
              name: teamNames.length > 0 ? cleanText(teamNames[0].textContent) : '',
              score: teamScores.length > 0 ? cleanText(teamScores[0].textContent) : '',
            },
            team2: {
              name: teamNames.length > 1 ? cleanText(teamNames[1].textContent) : '',
              score: teamScores.length > 1 ? cleanText(teamScores[1].textContent) : '',
            },
          };
        });
      });

      logger.info(`✅ STEP 6: Extracted ${matches.length} matches`);
      return matches;
    } catch (error) {
      logger.error(`❌ Failed to extract matches: ${error.message}`);
      logger.error(`  Stack: ${error.stack}`);
      return [];
    }
  }

  // ============================================================
  // SAVE DEBUG DATA
  // ============================================================
  async saveDebugData(type, data, matchId = null) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const prefix = matchId ? `${matchId}_` : '';
      const filename = `Crex_${prefix}${type}_${timestamp}.html`;
      const filepath = path.join(this.debugDir, filename);

      await fs.mkdir(this.debugDir, { recursive: true });

      if (typeof data === 'string') {
        await fs.writeFile(filepath, data);
      } else {
        await fs.writeFile(filepath, JSON.stringify(data, null, 2));
      }

      logger.debug(`Saved debug: ${filepath}`);
      return filepath;
    } catch (error) {
      logger.error(`Failed to save debug data: ${error.message}`);
      return null;
    }
  }

  // ============================================================
  // STAGE 1: Discover matches
  // ============================================================
  async scrapeLive() {
    const url = 'https://crex.com/';
    logger.info(`Stage 1: Discovering matches from ${url}`);

    try {
      this.printMemoryUsage('start');

      logger.info('🔧 STEP 1: Initializing browser...');
      const initialized = await this.initialize();
      if (!initialized) {
        throw new Error('Failed to initialize browser');
      }
      logger.info('✅ STEP 1: Browser initialized');

      logger.info(`🔧 STEP 2: Navigating to ${url}...`);
      try {
        await this.page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
        logger.info('✅ STEP 2: Navigation complete');
      } catch (error) {
        logger.error(`❌ STEP 2: Navigation failed: ${error.message}`);
        logger.error(`  Stack: ${error.stack}`);
        
        try {
          const currentUrl = this.page ? this.page.url() : 'unknown';
          const title = this.page ? await this.page.title() : 'unknown';
          const content = this.page ? await this.page.content() : 'No content';
          
          await this.saveDebugData('navigation_failed', {
            url: currentUrl,
            title: title,
            content: content.substring(0, 5000),
          });
          
          if (this.page) {
            await this.page.screenshot({ 
              path: path.join(this.debugDir, `navigation_failed_${Date.now()}.png`) 
            });
          }
        } catch (e) {
          logger.error(`Failed to save debug data: ${e.message}`);
        }
        
        await this.close();
        return [];
      }

      logger.info('🔧 STEP 3: Waiting for page to stabilize...');
      await this.sleep(3000);
      logger.info('✅ STEP 3: Page stabilized');

      logger.info('🔧 STEP 4: Waiting for .live-card...');
      try {
        await this.page.waitForSelector('.live-card', { 
          timeout: 15000,
          state: 'visible'
        });
        logger.info('✅ STEP 4: .live-card found');
      } catch (error) {
        logger.error(`❌ STEP 4: .live-card not found: ${error.message}`);
        logger.error(`  Stack: ${error.stack}`);
        
        try {
          const currentUrl = this.page ? this.page.url() : 'unknown';
          const title = this.page ? await this.page.title() : 'unknown';
          const content = this.page ? await this.page.content() : 'No content';
          
          await this.saveDebugData('selector_not_found', {
            url: currentUrl,
            title: title,
            content: content.substring(0, 5000),
            selector: '.live-card'
          });
          
          if (this.page) {
            await this.page.screenshot({ 
              path: path.join(this.debugDir, `selector_not_found_${Date.now()}.png`) 
            });
          }
        } catch (e) {
          logger.error(`Failed to save debug data: ${e.message}`);
        }
        
        await this.close();
        return [];
      }

      logger.info('🔧 STEP 5: Counting live cards...');
      try {
        const cardCount = await this.page.locator('.live-card').count();
        logger.info(`✅ STEP 5: Found ${cardCount} live cards`);
        
        if (cardCount === 0) {
          logger.warn('⚠️ STEP 5: No live cards found on homepage');
          await this.close();
          return [];
        }
      } catch (error) {
        logger.error(`❌ STEP 5: Failed to count cards: ${error.message}`);
        logger.error(`  Stack: ${error.stack}`);
        await this.close();
        return [];
      }

      const matchCards = await this.extractMatchesFromPage();

      if (matchCards.length === 0) {
        logger.warn('⚠️ STEP 6: No match data extracted from cards');
        await this.close();
        return [];
      }

      logger.info(`✅ Discovered ${matchCards.length} matches from homepage`);

      const matches = [];
      const processedIds = new Set();

      for (const card of matchCards) {
        if (!card.matchUrl || processedIds.has(card.matchId)) continue;
        processedIds.add(card.matchId);

        const cleanMatchId = card.matchId ? card.matchId.split('?')[0] : '';

        matches.push({
          matchId: cleanMatchId || this.extractMatchId(card.matchUrl),
          url: card.matchUrl,
          series: card.series || '',
          team1: { name: card.team1?.name || '', score: card.team1?.score || '' },
          team2: { name: card.team2?.name || '', score: card.team2?.score || '' },
          commentary: `https://crex.com/match/${cleanMatchId}/commentary`,
          scorecard: `https://crex.com/match/${cleanMatchId}/scorecard`,
          preview: `https://crex.com/match/${cleanMatchId}/preview`,
          squads: `https://crex.com/match/${cleanMatchId}/squads`,
          statistics: `https://crex.com/match/${cleanMatchId}/stats`,
        });

        logger.info(`Match: ${card.series || 'N/A'} - ${card.team1?.name || 'N/A'} vs ${card.team2?.name || 'N/A'}`);

        if (matches.length >= this.maxMatches) break;
      }

      if (matches.length === 0) {
        logger.warn('⚠️ No valid matches found after processing cards');
        await this.close();
        return [];
      }

      logger.info('🔧 STEP 7: Closing homepage browser...');
      await this.close();
      this.printMemoryUsage('after homepage');

      logger.info(`🔧 STEP 8: Processing ${matches.length} matches...`);
      const detailedMatches = [];
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        try {
          logger.info(`\n========================================`);
          logger.info(`Processing match ${i + 1}/${matches.length}: ${match.matchId}`);
          logger.info(`URL: ${match.url}`);
          logger.info(`========================================\n`);

          if (i > 0) {
            await this.sleep(this.requestDelay);
          }

          this.printMemoryUsage(`before match ${i+1}`);

          await this.initialize();
          const detailedMatch = await this.scrapeMatchOptimized(match);
          await this.close();

          this.printMemoryUsage(`after match ${i+1}`);

          if (detailedMatch) {
            detailedMatches.push(detailedMatch);
            this.stats.returned++;
            logger.info(`✅ Processed ${match.matchId}`);
          }

          if (global.gc) {
            global.gc();
          }

        } catch (error) {
          logger.error(`Error processing match ${match.matchId}: ${error.message}`);
          logger.error(`  Stack: ${error.stack}`);
          await this.close();
        }
      }

      this.printMemoryUsage('end');
      return detailedMatches;

    } catch (error) {
      logger.error('❌ Error in Stage 1 (listing page):');
      logger.error(`  Message: ${error.message}`);
      logger.error(`  Stack: ${error.stack}`);
      await this.close();
      return [];
    }
  }

  // ============================================================
  // SCRAPE SINGLE MATCH - OPTIMIZED
  // ============================================================
  async scrapeMatchOptimized(match) {
    try {
      if (this.page) {
        await this.page.close().catch(() => {});
        this.page = null;
      }
      this.page = await this.context.newPage();

      const data = await this.fetchMatchDataWithEvaluate(match.url, 2);

      if (!data) {
        logger.error(`❌ Failed to extract data for: ${match.matchId}`);
        return this.buildMatchFromURL(match);
      }

      const result = this.buildMatchFromExtractedData(data, match);

      if (this.page) {
        await this.page.close().catch(() => {});
        this.page = null;
      }

      return result;

    } catch (error) {
      logger.error(`Error scraping match ${match.matchId}: ${error.message}`);
      logger.error(`  Stack: ${error.stack}`);
      return this.buildMatchFromURL(match);
    } finally {
      if (this.page) {
        await this.page.close().catch(() => {});
        this.page = null;
      }
    }
  }

  // ============================================================
  // BUILD MATCH FROM EXTRACTED DATA
  // ============================================================
  buildMatchFromExtractedData(data, match) {
    const result = {
      matchId: match.matchId,
      url: match.url,
      series: data.series || match.series || '',
      matchTitle: data.matchTitle || '',
      matchNumber: data.matchNumber || '',
      category: '',
      format: '',
      status: data.status || 'UPCOMING',
      venue: data.venue || '',
      date: data.date || '',
      startTime: data.startTime || '',
      startsIn: data.startsIn || '',
      result: data.result || '',
      winningTeam: data.winningTeam || '',
      margin: data.margin || '',
      marginType: data.marginType || '',
      playerOfMatch: {
        name: data.playerOfMatch || '',
        image: data.playerImage || '',
        profileUrl: '',
      },
      toss: {
        winner: data.tossWinner || '',
        decision: data.tossDecision || '',
      },
      officials: {
        umpires: data.umpires || [],
        thirdUmpire: data.thirdUmpire || '',
        matchReferee: data.matchReferee || '',
      },
      team1: {
        name: data.team1Name || match.team1?.name || '',
        short: this.getShortName(data.team1Name || match.team1?.name || ''),
        flag: data.team1Flag || '',
        innings: [],
        score: data.team1Score || match.team1?.score || '',
        wickets: data.team1Wickets || '',
        overs: data.team1Overs || '',
      },
      team2: {
        name: data.team2Name || match.team2?.name || '',
        short: this.getShortName(data.team2Name || match.team2?.name || ''),
        flag: data.team2Flag || '',
        innings: [],
        score: data.team2Score || match.team2?.score || '',
        wickets: data.team2Wickets || '',
        overs: data.team2Overs || '',
      },
      commentary: match.commentary,
      scorecard: match.scorecard,
      preview: match.preview,
      squads: match.squads,
      statistics: match.statistics,
      source: 'crex',
      scrapedAt: new Date().toISOString(),
      currentBatters: data.batsmen || [],
      currentBowler: {
        name: data.bowlerName || '',
        overs: data.bowlerOvers || '',
        maidens: data.bowlerMaidens || '',
        runs: data.bowlerRuns || '',
        wickets: data.bowlerWickets || '',
        economy: data.bowlerEconomy || '',
      },
      oversTimeline: data.oversTimeline || [],
    };

    if (!result.matchTitle && result.team1.name && result.team2.name) {
      let title = `${result.team1.name} vs ${result.team2.name}`;
      if (result.matchNumber) {
        title += `, ${result.matchNumber}`;
      }
      if (result.series) {
        title += `, ${result.series}`;
      }
      result.matchTitle = title;
    }

    result.category = this.detectCategory(result.series, result.matchTitle);
    result.format = this.detectFormat(result.series, result.matchTitle, result.status);

    if (result.status === 'UPCOMING') {
      result.team1.score = '';
      result.team1.wickets = '';
      result.team1.overs = '';
      result.team2.score = '';
      result.team2.wickets = '';
      result.team2.overs = '';
      result.result = '';
      result.winningTeam = '';
      result.margin = '';
      result.marginType = '';
      result.playerOfMatch = { name: '', image: '', profileUrl: '' };
      result.currentBatters = [];
      result.currentBowler = {};
      result.oversTimeline = [];
    }

    return result;
  }

  // ============================================================
  // BUILD MATCH FROM URL (FALLBACK)
  // ============================================================
  buildMatchFromURL(match) {
    const result = {
      matchId: match.matchId,
      url: match.url,
      series: match.series || '',
      matchTitle: '',
      matchNumber: '',
      category: '',
      format: '',
      status: 'UPCOMING',
      venue: '',
      date: '',
      startTime: '',
      startsIn: '',
      result: '',
      winningTeam: '',
      margin: '',
      marginType: '',
      playerOfMatch: { name: '', image: '', profileUrl: '' },
      toss: { winner: '', decision: '' },
      officials: { umpires: [], thirdUmpire: '', matchReferee: '' },
      team1: {
        name: match.team1?.name || '',
        short: this.getShortName(match.team1?.name || ''),
        flag: '',
        innings: [],
        score: match.team1?.score || '',
        wickets: '',
        overs: '',
      },
      team2: {
        name: match.team2?.name || '',
        short: this.getShortName(match.team2?.name || ''),
        flag: '',
        innings: [],
        score: match.team2?.score || '',
        wickets: '',
        overs: '',
      },
      commentary: match.commentary,
      scorecard: match.scorecard,
      preview: match.preview,
      squads: match.squads,
      statistics: match.statistics,
      source: 'crex',
      scrapedAt: new Date().toISOString(),
    };

    if (result.team1.name && result.team2.name) {
      let title = `${result.team1.name} vs ${result.team2.name}`;
      if (result.series) {
        title += `, ${result.series}`;
      }
      result.matchTitle = title;
    }

    result.category = this.detectCategory(result.series, result.matchTitle);
    result.format = this.detectFormat(result.series, result.matchTitle, result.status);
    result.team1.score = '';
    result.team1.wickets = '';
    result.team1.overs = '';
    result.team2.score = '';
    result.team2.wickets = '';
    result.team2.overs = '';

    return result;
  }

  // ============================================================
  // HELPER FUNCTIONS
  // ============================================================

  extractMatchId(url) {
    if (!url) return '';
    const match = url.match(/\/cricket-live-score\/([^/?]+)/);
    return match ? match[1] : '';
  }

  detectFormat(series, title, status) {
    const combined = `${series} ${title}`.toLowerCase();
    if (combined.includes('test')) return 'Test';
    if (combined.includes('odi') || combined.includes('one day')) return 'ODI';
    if (combined.includes('t20')) return 'T20';
    if (combined.includes('the hundred')) return 'The Hundred';
    if (combined.includes('first class')) return 'First Class';
    if (combined.includes('list a')) return 'List A';
    if (combined.includes('t10')) return 'T10';
    return 'T20';
  }

  detectCategory(series, title) {
    const combined = `${series} ${title}`.toLowerCase();
    if (combined.includes('women')) return 'Women';
    if (combined.includes('under-19') || combined.includes('u19') || combined.includes('youth'))
      return 'Youth';
    if (
      combined.includes('league') ||
      combined.includes('ipl') ||
      combined.includes('lpl') ||
      combined.includes('the hundred')
    ) {
      return 'League';
    }
    if (combined.includes('domestic') || combined.includes('county') || combined.includes('cup'))
      return 'Domestic';
    if (combined.includes('franchise')) return 'Franchise';
    return 'International';
  }

  getShortName(teamName) {
    if (!teamName) return '';
    const shortNames = {
      'Galle Gallants': 'GAG',
      'Dambulla Sixers': 'DAS',
      'Kandy Falcons': 'KFS',
      'Jaffna Kings': 'JKS',
      'Colombo Kaps': 'CLK',
      'Kandy Royals': 'KRL',
      'London Spirit': 'LDN',
      'Manchester Super Giants': 'MSG',
      'Southern Brave': 'SOU',
      'Welsh Fire': 'WEF',
      'Birmingham Phoenix': 'BIR',
      'Trent Rockets': 'TRE',
      'Oval Invincibles': 'OVAL',
      'Northern Superchargers': 'NOR',
      'Worcestershire': 'WORCS',
      'Derbyshire': 'DERBY',
      'Lahore Qalandars': 'LQ',
      'Perth Scorchers': 'PS',
      'Guyana Amazon Warriors': 'GAW',
      'San Francisco Unicorns': 'SFU',
      'Pakistan': 'PAK',
      'India': 'IND',
      'Australia': 'AUS',
      'England': 'ENG',
      'New Zealand': 'NZ',
      'South Africa': 'SA',
      'West Indies': 'WI',
      'Sri Lanka': 'SL',
      'Bangladesh': 'BAN',
      'Afghanistan': 'AFG',
      'Zimbabwe': 'ZIM',
      'Ireland': 'IRE',
      'Nepal': 'NEP',
      'Namibia': 'NAM',
      'IND': 'India',
      'ZIM': 'Zimbabwe',
    };
    for (const [full, short] of Object.entries(shortNames)) {
      if (teamName.includes(full)) return short;
    }
    const parts = teamName.split(' ');
    if (parts.length >= 2) {
      return parts
        .map((p) => p[0])
        .join('')
        .toUpperCase();
    }
    return teamName.substring(0, 3).toUpperCase();
  }

  cleanText(text) {
    if (!text) return '';
    return text
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[^\x20-\x7E]/g, '')
      .trim();
  }

  // ============================================================
  // REQUIRED INTERFACE METHODS
  // ============================================================
  async scrapeFixtures() {
    return [];
  }

  async scrapeMatch(matchId) {
    const url = `https://crex.com/cricket-live-score/${matchId}`;
    await this.initialize();
    const match = { matchId, url };
    const result = await this.scrapeMatchOptimized(match);
    await this.close();
    return result;
  }

  async scrapeCommentary(matchId) {
    return { matchId, commentary: [], count: 0 };
  }

  async scrapePoints() {
    return {};
  }

  async scrapeNews() {
    return [];
  }
}

module.exports = CrexScraper;