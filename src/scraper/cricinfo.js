const playwright = require('playwright');
const logger = require('../logger');
const config = require('../config');

class BrowserManager {
  constructor() {
    this.browser = null;
    this.context = null;
    this.isReady = false;
    this.maxRetries = 3;
  }

  async launch() {
    try {
      if (this.browser && this.isReady) {
        return this.browser;
      }

      logger.info('Launching browser with stealth settings...');

      this.browser = await playwright.chromium.launch({
        headless: process.env.NODE_ENV === 'production',
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
        ],
        timeout: config.scraper.timeout,
      });

      // Create context with realistic headers
      this.context = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: this.getRandomUserAgent(),
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        permissions: ['geolocation'],
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
        extraHTTPHeaders: {
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
          Pragma: 'no-cache',
        },
      });

      // Add advanced stealth scripts
      await this.addStealthScripts();

      this.isReady = true;
      logger.info('Browser launched successfully with stealth settings');

      this.monitorBrowser();
      return this.browser;
    } catch (error) {
      logger.error('Browser launch failed:', error);
      await this.close();
      throw error;
    }
  }

  getRandomUserAgent() {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  async addStealthScripts() {
    await this.context.addInitScript(() => {
      // Override navigator properties
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

      // Override chrome property
      window.chrome = { runtime: {} };

      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);

      // Override navigator properties
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

      // Override connection
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          rtt: 50,
          downlink: 10,
        }),
      });

      // Override screen
      Object.defineProperty(screen, 'availWidth', { get: () => 1920 });
      Object.defineProperty(screen, 'availHeight', { get: () => 1040 });
      Object.defineProperty(screen, 'width', { get: () => 1920 });
      Object.defineProperty(screen, 'height', { get: () => 1080 });
      Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
      Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
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

  async getPage(url) {
    try {
      if (!this.isReady || !this.browser) {
        await this.launch();
      }

      const page = await this.context.newPage();
      page.setDefaultTimeout(config.scraper.timeout);
      page.setDefaultNavigationTimeout(config.scraper.timeout);

      // Add human-like behavior
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      // Navigate with retry and human-like delays
      let attempts = 0;
      let lastError = null;

      while (attempts < 3) {
        try {
          // Random delay before navigation (human behavior)
          await this.delay(Math.random() * 2000 + 1000);

          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: config.scraper.timeout,
          });

          // Wait for network to be idle
          await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

          // Random scrolling (human behavior)
          await this.humanScroll(page);

          // Random mouse movements
          await this.humanMouseMovement(page);

          // Wait random time after page load
          await this.delay(Math.random() * 2000 + 1000);

          return page;
        } catch (error) {
          lastError = error;
          attempts++;
          logger.warn(`Navigation attempt ${attempts} failed for ${url}:`, error.message);
          await this.delay(2000 * attempts);
        }
      }

      throw lastError || new Error(`Failed to navigate to ${url}`);
    } catch (error) {
      logger.error('Page creation failed:', { url, error: error.message });
      throw error;
    }
  }

  async humanScroll(page) {
    try {
      // Scroll in human-like manner
      const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
      const viewportHeight = 1080;
      const steps = Math.ceil(scrollHeight / viewportHeight);

      for (let i = 0; i < Math.min(steps, 5); i++) {
        await page.evaluate(
          (scrollY) => {
            window.scrollTo({
              top: scrollY,
              behavior: 'smooth',
            });
          },
          i * viewportHeight * 0.8
        );
        await this.delay(Math.random() * 1000 + 500);
      }

      // Scroll back to top
      await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      await this.delay(500);
    } catch (error) {
      logger.debug('Human scroll failed:', error.message);
    }
  }

  async humanMouseMovement(page) {
    try {
      // Random mouse movements
      const x = Math.floor(Math.random() * 1000);
      const y = Math.floor(Math.random() * 500);
      await page.mouse.move(x, y);
      await this.delay(Math.random() * 500 + 200);
      await page.mouse.move(x + 100, y + 50);
      await this.delay(Math.random() * 300 + 100);
    } catch (error) {
      logger.debug('Human mouse movement failed:', error.message);
    }
  }

  async closePage(page) {
    try {
      if (page && !page.isClosed()) {
        await page.close();
      }
    } catch (error) {
      logger.error('Page close failed:', error);
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

  async executeScrape(url, scrapeFn) {
    let page = null;
    let attempts = 0;
    const maxRetries = config.scraper.maxRetries || 3;

    while (attempts < maxRetries) {
      try {
        page = await this.getPage(url);
        const result = await scrapeFn(page);
        await this.closePage(page);
        return result;
      } catch (error) {
        attempts++;
        logger.error(`Scrape attempt ${attempts} failed:`, {
          url,
          error: error.message,
          stack: error.stack,
        });

        if (page) {
          await this.closePage(page);
        }

        if (attempts < maxRetries) {
          const backoffDelay = config.scraper.retryBackoffBase * Math.pow(2, attempts - 1);
          logger.info(`Retrying in ${backoffDelay}ms...`);
          await this.delay(backoffDelay);

          if (error.message.includes('browser') || error.message.includes('Access Denied')) {
            await this.restart();
          }
        }
      }
    }

    throw new Error(`Scrape failed after ${maxRetries} attempts: ${url}`);
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async healthCheck() {
    try {
      if (!this.isReady || !this.browser) {
        return false;
      }

      const page = await this.context.newPage();
      await page.goto('about:blank');
      await page.close();
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new BrowserManager();
