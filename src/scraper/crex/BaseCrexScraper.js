const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../logger');

class BaseCrexScraper {
  constructor() {
    this.baseUrl = 'https://crex.com';
    this.browser = null;
    this.context = null;
    this.page = null;
    this.usePlaywright = true;
    this.debugDir = path.join(process.cwd(), 'debug');
    this.apiResponses = [];
    this.maxMatches = 20;
    this.requestDelay = 2000;
    this.isBrowserInitialized = false;
    this.requestCount = 0;
    this.lastRequestTime = 0;
    this.stats = {
      downloaded: 0,
      parsed: 0,
      returned: 0,
    };
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================
  // BROWSER MANAGEMENT
  // ============================================================
  async initializeBrowser() {
    try {
      if (this.isBrowserInitialized && this.browser && this.browser.isConnected()) {
        logger.debug('Browser already initialized, reusing...');
        return true;
      }

      // Close existing browser if any
      if (this.browser) {
        await this.closeBrowser();
      }

      logger.info('🔧 Launching browser...');
      
      // Random user agents
      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
      ];
      
      const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

      this.browser = await chromium.launch({
        headless: process.env.NODE_ENV === 'production' ? true : false,
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
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-infobars',
        ],
        timeout: 45000,
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: randomUA,
        ignoreHTTPSErrors: true,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
      });

      // Add stealth scripts
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { 
          get: () => [1, 2, 3, 4, 5] 
        });
        Object.defineProperty(navigator, 'languages', { 
          get: () => ['en-US', 'en'] 
        });
        window.chrome = { runtime: {} };
      });

      // Selective resource blocking
      await this.context.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        const url = route.request().url();

        if (['font', 'media'].includes(resourceType)) {
          return route.abort();
        }

        if (
          url.includes('google-analytics') ||
          url.includes('googletagmanager') ||
          url.includes('facebook.com/tr') ||
          url.includes('doubleclick.net') ||
          url.includes('gtag') ||
          url.includes('analytics')
        ) {
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

      this.page = await this.context.newPage();
      this.page.setDefaultTimeout(45000);
      this.page.setDefaultNavigationTimeout(45000);
      
      this.isBrowserInitialized = true;
      logger.info(`✅ Browser initialized with user agent: ${randomUA}`);
      return true;
      
    } catch (error) {
      logger.error(`Failed to initialize browser: ${error.message}`);
      return false;
    }
  }

  async closeBrowser() {
    try {
      if (this.page) {
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
      this.isBrowserInitialized = false;
      if (global.gc) {
        global.gc();
      }
      logger.info('✅ Browser closed');
    } catch (error) {
      logger.error(`Error closing browser: ${error.message}`);
      this.browser = null;
      this.context = null;
      this.page = null;
      this.isBrowserInitialized = false;
    }
  }

  // ============================================================
  // PAGE NAVIGATION WITH RETRY AND RATE LIMITING
  // ============================================================
  async navigateWithRetry(url, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const delay = options.delay || this.requestDelay;
    
    if (!this.isBrowserInitialized || !this.page) {
      await this.initializeBrowser();
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Rate limiting
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < 2000) {
          const waitTime = 2000 - timeSinceLastRequest + Math.random() * 1000;
          logger.debug(`Rate limiting: waiting ${waitTime}ms`);
          await this.sleep(waitTime);
        }
        
        this.requestCount++;
        this.lastRequestTime = Date.now();
        
        logger.info(`Navigating to: ${url} (attempt ${attempt}/${maxRetries})`);
        
        // Random referrer
        const referrers = [
          'https://www.google.com/',
          'https://www.bing.com/',
          'https://www.yahoo.com/',
          'https://duckduckgo.com/',
        ];
        
        await this.page.setExtraHTTPHeaders({
          'Referer': referrers[Math.floor(Math.random() * referrers.length)]
        });
        
        const response = await this.page.goto(url, {
          waitUntil: options.waitUntil || 'domcontentloaded',
          timeout: options.timeout || 30000,
        });
        
        if (response && response.status() === 403) {
          logger.warn(`⚠️ Received 403 Forbidden, attempt ${attempt}/${maxRetries}`);
          
          // Rotate user agent
          const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          ];
          const newUA = userAgents[Math.floor(Math.random() * userAgents.length)];
          await this.context.setExtraHTTPHeaders({
            'User-Agent': newUA
          });
          logger.info(`Rotated User-Agent: ${newUA}`);
          
          if (attempt === maxRetries) {
            throw new Error(`Failed after ${maxRetries} attempts: 403 Forbidden`);
          }
          await this.sleep(delay * attempt + Math.random() * 1000);
          continue;
        }
        
        if (response && response.status() >= 400) {
          logger.warn(`⚠️ Received status ${response.status()}, attempt ${attempt}/${maxRetries}`);
          if (attempt === maxRetries) {
            throw new Error(`Failed after ${maxRetries} attempts: status ${response.status()}`);
          }
          await this.sleep(delay * attempt);
          continue;
        }
        
        // Wait for page to be interactive
        await this.page.waitForLoadState('domcontentloaded');
        await this.sleep(1000);
        
        // Check for consent
        try {
          const bodyText = await this.page.textContent('body');
          if (bodyText && (bodyText.includes('cookie') || bodyText.includes('Consent') || bodyText.includes('GDPR'))) {
            await this.acceptConsent();
          }
        } catch (e) {
          // Ignore consent errors
        }
        
        this.stats.downloaded++;
        return response;
        
      } catch (error) {
        logger.warn(`Navigation attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        if (attempt === maxRetries) {
          throw error;
        }
        await this.sleep(delay * attempt + Math.random() * 2000);
        
        // If browser issue, restart
        if (error.message.includes('browser') || 
            error.message.includes('disconnected') ||
            error.message.includes('closed')) {
          await this.closeBrowser();
          await this.initializeBrowser();
        }
      }
    }
    
    throw new Error(`Failed to navigate after ${maxRetries} attempts`);
  }

  async acceptConsent() {
    try {
      const selectors = [
        '#onetrust-accept-btn-handler',
        '#onetrust-close-btn-container button',
        '.onetrust-close-btn-handler',
        '#accept-recommended-btn-handler',
        '.btn-primary',
        '.cookie-accept',
        '.accept-cookies',
        'button:contains("Accept")',
        'button:contains("Accept All")',
      ];
      
      for (const selector of selectors) {
        try {
          const element = await this.page.$(selector);
          if (element && await element.isVisible()) {
            await element.click();
            logger.info('✅ Accepted consent');
            await this.sleep(1000);
            return true;
          }
        } catch (e) {
          // Continue
        }
      }
      
      // Try JavaScript click
      await this.page.evaluate(() => {
        const buttons = document.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          const text = (btn.textContent || '').toLowerCase();
          if (text.includes('accept') || text.includes('allow') || text.includes('agree')) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      
      return false;
    } catch (error) {
      logger.warn('Consent acceptance failed:', error.message);
      return false;
    }
  }

  // ============================================================
  // DOM HELPERS
  // ============================================================
  cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  }

  getText(element) {
    if (!element) return '';
    return element.textContent ? element.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  getAttribute(element, attr) {
    if (!element) return '';
    return element.getAttribute(attr) || '';
  }

  getImageSrc(element) {
    if (!element) return '';
    const img = element.querySelector('img');
    if (!img) return '';
    return img.getAttribute('src') || img.currentSrc || '';
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
  // MERGE RESULTS
  // ============================================================
  mergeResults(jsonData, apiData, domData, homepageData) {
    const merged = {};

    const sources = [
      { data: jsonData, label: 'JSON' },
      { data: apiData, label: 'API' },
      { data: domData, label: 'DOM' },
      { data: homepageData, label: 'Homepage' },
    ];

    for (const source of sources) {
      if (!source.data) continue;

      for (const [key, value] of Object.entries(source.data)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value) && value.length === 0) continue;
        if (typeof value === 'object' && value !== null && Object.keys(value).length === 0)
          continue;

        if (merged[key] !== undefined && merged[key] !== '' && merged[key] !== null) {
          if (typeof merged[key] === 'object' && Object.keys(merged[key]).length > 0) continue;
          if (Array.isArray(merged[key]) && merged[key].length > 0) continue;
          if (merged[key] !== '') continue;
        }

        merged[key] = value;
      }
    }

    return merged;
  }

  // ============================================================
  // EXTRACT HYDRATION DATA
  // ============================================================
  extractHydrationData(html) {
    const data = {};

    try {
      const sources = [
        { name: '__NEXT_DATA__', pattern: /__NEXT_DATA__\s*=\s*({.*?});/s },
        { name: '__INITIAL_STATE__', pattern: /window\.__INITIAL_STATE__\s*=\s*({.*?});/s },
        { name: '__APOLLO_STATE__', pattern: /window\.__APOLLO_STATE__\s*=\s*({.*?});/s },
        { name: '__NUXT__', pattern: /window\.__NUXT__\s*=\s*({.*?});/s },
        { name: '__RUNTIME__', pattern: /window\.__RUNTIME__\s*=\s*({.*?});/s },
        {
          name: 'Embedded JSON',
          pattern: /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
        },
      ];

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

      return data;
    } catch (error) {
      logger.debug(`Hydration extraction failed: ${error.message}`);
      return data;
    }
  }

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
  // DEBUG
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
  // SHARED HELPERS
  // ============================================================
  extractMatchId(url) {
    if (!url) return '';
    const match = url.match(/\/cricket-live-score\/([^/?]+)/);
    return match ? match[1] : '';
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
      Worcestershire: 'WORCS',
      Derbyshire: 'DERBY',
      'Lahore Qalandars': 'LQ',
      'Perth Scorchers': 'PS',
      'Guyana Amazon Warriors': 'GAW',
      'San Francisco Unicorns': 'SFU',
      Pakistan: 'PAK',
      India: 'IND',
      Australia: 'AUS',
      England: 'ENG',
      'New Zealand': 'NZ',
      'South Africa': 'SA',
      'West Indies': 'WI',
      'Sri Lanka': 'SL',
      Bangladesh: 'BAN',
      Afghanistan: 'AFG',
      Zimbabwe: 'ZIM',
      Ireland: 'IRE',
      Nepal: 'NEP',
      Namibia: 'NAM',
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

  logExtractedData(match) {
    logger.info(`\n📊 Extracted Data for ${match.matchId}:`);
    logger.info(`  Series: "${match.series}"`);
    logger.info(`  Match Title: "${match.matchTitle}"`);
    logger.info(`  Status: "${match.status}"`);
    logger.info(`  Venue: "${match.venue}"`);
    logger.info(`  Team 1: "${match.team1?.name}" (${match.team1?.short})`);
    logger.info(`  Team 2: "${match.team2?.name}" (${match.team2?.short})`);
    if (match.team1?.score) {
      logger.info(`  Team 1 Score: "${match.team1.score}"`);
    }
    if (match.team2?.score) {
      logger.info(`  Team 2 Score: "${match.team2.score}"`);
    }
    if (match.result) {
      logger.info(`  Result: "${match.result}"`);
    }
    if (match.winningTeam) {
      logger.info(`  Winning Team: "${match.winningTeam}"`);
    }
    if (match.playerOfMatch?.name) {
      logger.info(`  Player of Match: "${match.playerOfMatch.name}"`);
    }
  }

  logStatistics() {
    logger.info('\n========================================');
    logger.info('SCRAPING STATISTICS:');
    logger.info(`Downloaded pages: ${this.stats.downloaded}`);
    logger.info(`Parsed pages: ${this.stats.parsed}`);
    logger.info(`Returned matches: ${this.stats.returned}`);
    logger.info(`Total requests: ${this.requestCount}`);
    logger.info('========================================\n');
  }
}

module.exports = BaseCrexScraper;