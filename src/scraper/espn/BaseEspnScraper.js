// src/scraper/espn/BaseEspnScraper.js
const { chromium } = require('playwright');
const logger = require('../../logger');

class BaseEspnScraper {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.headless = options.headless !== undefined ? options.headless : true;
    this.timeout = options.timeout || 120000;
    this.logger = logger;
    this.networkFallbackUsed = false;
  }

  async initializeBrowser() {
    try {
      this.browser = await chromium.launch({
        headless: this.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled'
        ]
      });
      
      this.context = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br'
        }
      });
      
      this.page = await this.context.newPage();
      this.page.setDefaultTimeout(this.timeout);
      
      // Enable request interception for network monitoring
      await this.page.route('**/*', (route) => {
        route.continue();
      });
      
      this.logger.info('✅ ESPN Browser initialized successfully');
      return this;
    } catch (error) {
      this.logger.error(`❌ Failed to initialize browser: ${error.message}`);
      throw error;
    }
  }

  async closeBrowser() {
    if (this.browser) {
      try {
        await this.browser.close();
        this.browser = null;
        this.context = null;
        this.page = null;
        this.logger.info('✅ Browser closed');
      } catch (error) {
        this.logger.warn(`⚠️ Error closing browser: ${error.message}`);
      }
    }
  }

  async waitForTimeout(ms) {
    await this.page.waitForTimeout(ms);
  }

  async getText(selector, fallback = '') {
    try {
      const element = await this.page.$(selector);
      if (element) {
        const text = await this.page.evaluate(el => el.textContent.trim(), element);
        return text || fallback;
      }
      return fallback;
    } catch (error) {
      return fallback;
    }
  }

  async getAttribute(selector, attribute, fallback = '') {
    try {
      const element = await this.page.$(selector);
      if (element) {
        const value = await this.page.evaluate((el, attr) => el.getAttribute(attr), element, attribute);
        return value || fallback;
      }
      return fallback;
    } catch (error) {
      return fallback;
    }
  }

  async getElements(selector) {
    try {
      return await this.page.$$(selector);
    } catch (error) {
      this.logger.debug(`⚠️ Error getting elements with selector ${selector}: ${error.message}`);
      return [];
    }
  }

  async evaluateAll(selector, pageFunction, ...args) {
    try {
      return await this.page.$$eval(selector, pageFunction, ...args);
    } catch (error) {
      this.logger.debug(`⚠️ Error evaluating all elements: ${error.message}`);
      return [];
    }
  }

  buildAbsoluteUrl(url, baseUrl = 'https://www.espncricinfo.com') {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    if (url.startsWith('/')) {
      return `${baseUrl}${url}`;
    }
    return `${baseUrl}/${url}`;
  }

  generateTeamId(name) {
    if (!name) return `team_${Date.now()}`;
    let id = name.toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return `team_${id}`;
  }

  generateSeriesId(name) {
    if (!name) return `series_${Date.now()}`;
    let id = name.toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return `series_${id}`;
  }

  cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  }

  extractNumber(text) {
    if (!text) return null;
    const match = text.match(/(\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  extractDecimal(text) {
    if (!text) return null;
    const match = text.match(/(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : null;
  }

  logStatistics() {
    this.logger.info('📊 Scraper Statistics:');
  }
}

module.exports = BaseEspnScraper;