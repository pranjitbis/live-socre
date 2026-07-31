// src/scraper/browser.js
const playwright = require('playwright');
const logger = require('../logger');
const config = require('../config');
const fs = require('fs');
const path = require('path');

class BrowserManager {
  constructor() {
    this.browser = null;
    this.context = null;
    this.isReady = false;
    this.maxRetries = 3;
    this.requestCount = 0;
    this.lastRequestTime = 0;
    this.proxyList = [];
    this.currentProxyIndex = 0;
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36 OPR/104.0.0.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
    ];
    this.currentUserAgentIndex = 0;
    
    // Load proxies if available
    this.loadProxies();
  }

  loadProxies() {
    try {
      const proxyFile = path.join(process.cwd(), 'proxies.txt');
      if (fs.existsSync(proxyFile)) {
        const content = fs.readFileSync(proxyFile, 'utf8');
        this.proxyList = content.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#') && line.includes(':'));
        logger.info(`Loaded ${this.proxyList.length} proxies from proxies.txt`);
      } else {
        logger.info('No proxies.txt found, using direct connection');
      }
    } catch (error) {
      logger.warn('Failed to load proxies:', error.message);
    }
  }

  getNextProxy() {
    if (this.proxyList.length === 0) return null;
    const proxy = this.proxyList[this.currentProxyIndex];
    this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxyList.length;
    return proxy;
  }

  getRandomUserAgent() {
    const ua = this.userAgents[this.currentUserAgentIndex];
    this.currentUserAgentIndex = (this.currentUserAgentIndex + 1) % this.userAgents.length;
    return ua;
  }

  async launch() {
    try {
      if (this.browser && this.isReady && this.browser.isConnected()) {
        logger.debug('Browser already launched and ready');
        return this.browser;
      }

      // Close existing browser if any
      if (this.browser) {
        await this.close();
      }

      logger.info('Launching browser with stealth settings...');

      const userAgent = this.getRandomUserAgent();
      const proxy = this.getNextProxy();

      const launchOptions = {
        headless: process.env.NODE_ENV === 'production' ? true : false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-web-security',
          '--disable-features=BlockInsecurePrivateNetworkRequests',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-component-extensions-with-background-pages',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--disable-renderer-backgrounding',
          '--disable-sync',
          '--force-color-profile=srgb',
          '--metrics-recording-only',
          '--no-first-run',
          '--enable-automation=false',
          '--disable-blink-features=AutomationControlled',
          '--disable-webgl',
          '--disable-software-rasterizer',
          '--disable-logging',
          '--log-level=3',
          '--silent',
          '--hide-scrollbars',
          '--mute-audio',
          '--disable-notifications',
          '--disable-popup-blocking',
          '--disable-prompt-on-repost',
          '--disable-hang-monitor',
          '--disable-client-side-phishing-detection',
          '--disable-component-update'
        ],
        timeout: config.scraper?.timeout || 45000,
        ignoreDefaultArgs: ['--enable-automation']
      };

      this.browser = await playwright.chromium.launch(launchOptions);

      // Context options with proxy if available
      const contextOptions = {
        viewport: { width: 1920, height: 1080 },
        userAgent: userAgent,
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        permissions: ['geolocation'],
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
          'Pragma': 'no-cache',
          'DNT': '1'
        }
      };

      // Add proxy if available
      if (proxy) {
        const [host, port] = proxy.split(':');
        contextOptions.proxy = {
          server: `http://${host}:${port}`,
          bypass: '*.local'
        };
        logger.info(`Using proxy: ${proxy}`);
      }

      this.context = await this.browser.newContext(contextOptions);

      // Add stealth scripts
      await this.addStealthScripts();

      this.isReady = true;
      logger.info(`Browser launched successfully with user agent: ${userAgent}${proxy ? ` and proxy: ${proxy}` : ''}`);

      this.monitorBrowser();
      return this.browser;
    } catch (error) {
      logger.error('Browser launch failed:', error);
      await this.close();
      throw error;
    }
  }

  async addStealthScripts() {
    await this.context.addInitScript(() => {
      // Override navigator properties
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { 
        get: () => {
          const plugins = [];
          for (let i = 0; i < 5; i++) {
            plugins.push({
              name: `Plugin ${i}`,
              filename: `plugin${i}.dll`,
              description: `Plugin ${i} Description`,
              length: 1
            });
          }
          return plugins;
        }
      });
      
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      
      // Add chrome object
      if (!window.chrome) {
        window.chrome = { 
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        };
      }
      
      // Override permissions
      const originalQuery = window.navigator.permissions?.query;
      if (originalQuery) {
        window.navigator.permissions.query = (parameters) => {
          if (parameters.name === 'notifications') {
            return Promise.resolve({ state: Notification.permission });
          }
          return originalQuery(parameters);
        };
      }
      
      // Override toString for functions
      const originalFunctionToString = Function.prototype.toString;
      Function.prototype.toString = function() {
        if (this === window.navigator.permissions?.query) {
          return 'function query() { [native code] }';
        }
        return originalFunctionToString.call(this);
      };
      
      // Override console
      const originalConsoleLog = console.log;
      console.log = function() {
        const args = Array.from(arguments);
        if (args.some(arg => typeof arg === 'string' && 
            (arg.includes('webdriver') || arg.includes('automation') || arg.includes('headless')))) {
          return;
        }
        originalConsoleLog.apply(console, arguments);
      };
      
      // Override document.querySelector to hide automation
      const originalQuerySelector = document.querySelector;
      document.querySelector = function(selector) {
        if (selector === 'html' || selector === 'body') {
          return originalQuerySelector.call(this, selector);
        }
        return originalQuerySelector.call(this, selector);
      };
    });
  }

  monitorBrowser() {
    if (this.browser) {
      this.browser.on('disconnected', async () => {
        logger.warn('Browser disconnected, restarting...');
        this.isReady = false;
        await this.restart();
      });

      this.browser.on('close', async () => {
        logger.warn('Browser closed, restarting...');
        this.isReady = false;
        await this.restart();
      });
    }
  }

  async restart() {
    let attempts = 0;
    while (attempts < this.maxRetries) {
      try {
        await this.close();
        await this.delay(2000 * (attempts + 1));
        await this.launch();
        logger.info('Browser restarted successfully');
        return;
      } catch (error) {
        attempts++;
        logger.error(`Browser restart attempt ${attempts} failed:`, error);
        await this.delay(1000 * Math.pow(2, attempts));
      }
    }
    logger.error('Browser restart failed after max retries');
  }

  async acceptConsent(page) {
    try {
      logger.info('Attempting to accept consent...');

      // Wait for consent overlay to load
      await page.waitForTimeout(2000);

      // Strategy 1: Try OneTrust specific selectors
      const oneTrustSelectors = [
        '#onetrust-accept-btn-handler',
        '#onetrust-close-btn-container button',
        '.onetrust-close-btn-handler',
        '#onetrust-pc-btn-handler',
        '.accept-recommended-btn-handler',
        '.ot-sdk-row .ot-btn-container button',
        '#accept-recommended-btn-handler',
        '.btn-primary',
        '.cookie-accept',
        '.accept-cookies'
      ];

      for (const selector of oneTrustSelectors) {
        try {
          const element = await page.$(selector);
          if (element && await element.isVisible()) {
            await element.click();
            logger.info(`✅ Clicked OneTrust button: ${selector}`);
            await page.waitForTimeout(2000);
            return true;
          }
        } catch (e) {
          // Continue
        }
      }

      // Strategy 2: Try all buttons with accept text
      const result = await page.evaluate(() => {
        const buttons = document.querySelectorAll(
          'button, [role="button"], .btn, [class*="button"], input[type="submit"]'
        );
        for (const btn of buttons) {
          const text = (btn.textContent || '').toLowerCase().trim();
          const isAccept = 
            text.includes('accept') ||
            text.includes('allow') ||
            text.includes('ok') ||
            text.includes('agree') ||
            text.includes('continue') ||
            text.includes('got it') ||
            text === 'yes' ||
            text === 'proceed' ||
            text === 'confirm' ||
            text.includes('consent');
          
          if (isAccept && btn.offsetParent !== null) {
            btn.click();
            return true;
          }
        }
        return false;
      });

      if (result) {
        logger.info('✅ Accepted consent via JavaScript button search');
        await page.waitForTimeout(2000);
        return true;
      }

      // Strategy 3: Try clicking any visible button
      const anyButton = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          if (btn.offsetParent !== null && btn.textContent && btn.textContent.length > 0) {
            const text = btn.textContent.trim();
            if (text.length < 20) {
              btn.click();
              return text;
            }
          }
        }
        return null;
      });

      if (anyButton) {
        logger.info(`✅ Clicked visible button: "${anyButton}"`);
        await page.waitForTimeout(2000);
        return true;
      }

      // Strategy 4: Set cookies directly
      await page.evaluate(() => {
        const cookies = [
          'cookieconsent_status=allow; path=/; domain=.espncricinfo.com',
          'euconsent-v2=CPSEtL5PSEtL5AcABBENB5CsAP_AAH_AAAY; path=/',
          'SOCS=CAISNQgBEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjUwMjA1LjA4X3ABGgJlbg; path=/',
          'CONSENT=YES+CB.en+20250601-15-0; path=/',
          'OptanonAlertBoxClosed=2024-01-01T00:00:00.000Z; path=/',
          'OptanonConsent=isIABGlobal=false&datestamp=2024-01-01T00:00:00.000Z&version=20240101.0.0&hosts=&consentId=test&interactionCount=1&landingPath=NotLandingPage&groups=1:1,2:1,3:1,4:1; path=/'
        ];
        cookies.forEach(cookie => {
          document.cookie = cookie;
        });
      });

      logger.info('✅ Set consent cookies');
      await page.waitForTimeout(2000);

      // Reload to apply cookies
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      return true;
    } catch (error) {
      logger.warn('Consent acceptance failed:', error.message);
      return false;
    }
  }

  async getPage(url, options = {}) {
    try {
      // Rate limiting
      await this.rateLimit();

      if (!this.isReady || !this.browser || !this.browser.isConnected()) {
        await this.launch();
      }

      const page = await this.context.newPage();
      page.setDefaultTimeout(45000);
      page.setDefaultNavigationTimeout(45000);

      // Add random delay before navigation
      await this.delay(Math.random() * 1000 + 500);

      let attempts = 0;
      let lastError = null;

      while (attempts < this.maxRetries) {
        try {
          // Random referrer
          const referrers = [
            'https://www.google.com/',
            'https://www.bing.com/',
            'https://www.yahoo.com/',
            'https://duckduckgo.com/',
            'https://www.facebook.com/',
            'https://www.twitter.com/'
          ];
          
          await page.setExtraHTTPHeaders({
            'Referer': referrers[Math.floor(Math.random() * referrers.length)]
          });

          // Navigate with networkidle for better loading
          const response = await page.goto(url, {
            waitUntil: options.waitUntil || 'domcontentloaded',
            timeout: options.timeout || 30000,
          });

          // Check for 403
          if (response && response.status() === 403) {
            logger.warn(`⚠️ 403 Forbidden for ${url}`);
            
            // Try rotating user agent
            const newUA = this.getRandomUserAgent();
            await this.context.setExtraHTTPHeaders({
              'User-Agent': newUA
            });
            logger.info(`Rotated User-Agent: ${newUA}`);
            
            attempts++;
            if (attempts < this.maxRetries) {
              const waitTime = 5000 * attempts + Math.random() * 3000;
              logger.info(`Waiting ${waitTime}ms before retry...`);
              await this.delay(waitTime);
              continue;
            }
            throw new Error('Access Denied (403)');
          }

          if (response && response.status() >= 400) {
            logger.warn(`⚠️ Status ${response.status()} for ${url}`);
            attempts++;
            if (attempts < this.maxRetries) {
              await this.delay(3000 * attempts);
              continue;
            }
            throw new Error(`HTTP ${response.status()}`);
          }

          // Wait for page to be interactive
          await page.waitForLoadState('domcontentloaded');
          await this.delay(2000);

          // Check for consent page
          const bodyText = await page.textContent('body').catch(() => '');
          if (
            bodyText &&
            (bodyText.includes('Privacy Preference Center') ||
            bodyText.includes('cookie') ||
            bodyText.includes('Cookie Settings') ||
            bodyText.includes('OneTrust') ||
            bodyText.includes('GDPR'))
          ) {
            logger.info('Consent page detected, accepting...');
            await this.acceptConsent(page);
          }

          // Simulate human behavior
          await this.simulateHumanBehavior(page);

          return page;
        } catch (error) {
          lastError = error;
          attempts++;
          logger.warn(`Navigation attempt ${attempts} failed for ${url}:`, error.message);

          if (attempts < this.maxRetries) {
            const waitTime = 3000 * attempts + Math.random() * 2000;
            await this.delay(waitTime);
            
            if (error.message.includes('browser') || 
                error.message.includes('disconnected') ||
                error.message.includes('closed')) {
              await this.restart();
            }
            
            // Rotate proxy if available
            if (error.message.includes('403') || error.message.includes('Access Denied')) {
              const proxy = this.getNextProxy();
              if (proxy) {
                logger.info(`Rotating to proxy: ${proxy}`);
                await this.restart();
              }
            }
          }
        }
      }

      throw lastError || new Error(`Failed to navigate to ${url} after ${this.maxRetries} attempts`);
    } catch (error) {
      logger.error('Page creation failed:', { url, error: error.message });
      throw error;
    }
  }

  async simulateHumanBehavior(page) {
    try {
      // Random scroll
      await page.evaluate(() => {
        const scrollHeight = document.documentElement.scrollHeight;
        const scrollStep = Math.floor(Math.random() * 300) + 50;
        let currentScroll = 0;
        
        for (let i = 0; i < 3; i++) {
          currentScroll += scrollStep;
          if (currentScroll < scrollHeight) {
            window.scrollTo(0, currentScroll);
          }
        }
      });

      // Random mouse movements
      for (let i = 0; i < 3; i++) {
        await page.mouse.move(
          Math.floor(Math.random() * 800) + 100,
          Math.floor(Math.random() * 600) + 100
        );
        await this.delay(100, 300);
      }

      await this.delay(500, 1500);
    } catch (error) {
      // Ignore simulation errors
    }
  }

  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minDelay = 2000; // 2 seconds minimum between requests
    
    if (timeSinceLastRequest < minDelay) {
      const waitTime = minDelay - timeSinceLastRequest + Math.random() * 1000;
      logger.debug(`Rate limiting: waiting ${waitTime}ms`);
      await this.delay(waitTime);
    }
    
    this.requestCount++;
    this.lastRequestTime = Date.now();
  }

  async closePage(page) {
    try {
      if (page && !page.isClosed()) {
        await page.close();
      }
    } catch (error) {
      // Ignore
    }
  }

  async close() {
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.context = null;
        this.isReady = false;
        logger.info('Browser closed');
      }
    } catch (error) {
      logger.error('Browser close failed:', error);
    }
  }

  async executeScrape(url, scrapeFn, options = {}) {
    let page = null;
    let attempts = 0;
    const maxRetries = options.maxRetries || this.maxRetries;

    while (attempts < maxRetries) {
      try {
        page = await this.getPage(url, options);
        const result = await scrapeFn(page);
        await this.closePage(page);
        return result;
      } catch (error) {
        attempts++;
        logger.error(`Scrape attempt ${attempts} failed:`, {
          url,
          error: error.message,
        });

        if (page) {
          await this.closePage(page);
        }

        if (attempts < maxRetries) {
          const backoffDelay = 3000 * attempts + Math.random() * 2000;
          logger.info(`Retrying in ${backoffDelay}ms...`);
          await this.delay(backoffDelay);

          if (error.message.includes('browser') || 
              error.message.includes('Access Denied') ||
              error.message.includes('403')) {
            await this.restart();
          }
        }
      }
    }

    throw new Error(`Scrape failed after ${maxRetries} attempts: ${url}`);
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async healthCheck() {
    try {
      if (!this.isReady || !this.browser || !this.browser.isConnected()) {
        return false;
      }

      const page = await this.context.newPage();
      await page.goto('about:blank', { timeout: 5000 });
      await page.close();
      return true;
    } catch (error) {
      logger.warn('Health check failed:', error.message);
      return false;
    }
  }

  // Get statistics
  getStats() {
    return {
      requestCount: this.requestCount,
      isReady: this.isReady,
      proxyCount: this.proxyList.length,
      currentProxy: this.proxyList[this.currentProxyIndex] || 'none',
      userAgent: this.userAgents[this.currentUserAgentIndex] || 'unknown'
    };
  }
}

// Export singleton
module.exports = new BrowserManager();