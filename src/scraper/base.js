const cheerio = require('cheerio');
const logger = require('../logger');

class BaseScraper {
  constructor(config = {}) {
    this.selectors = config.selectors || {};
    this.timeout = config.timeout || 30000;
    this.retries = config.retries || 3;
  }

  async scrape(page) {
    throw new Error('Scrape method must be implemented by subclass');
  }

  async getHtml(page) {
    return await page.content();
  }

  parseHtml(html) {
    return cheerio.load(html);
  }

  async extractText($, selector, defaultValue = '') {
    try {
      const element = $(selector);
      return element.length ? element.text().trim() : defaultValue;
    } catch (error) {
      logger.warn('Extract text failed:', { selector, error: error.message });
      return defaultValue;
    }
  }

  async extractAttribute($, selector, attribute, defaultValue = '') {
    try {
      const element = $(selector);
      return element.length ? element.attr(attribute) || defaultValue : defaultValue;
    } catch (error) {
      logger.warn('Extract attribute failed:', { selector, attribute, error: error.message });
      return defaultValue;
    }
  }

  async extractList($, selector, callback) {
    try {
      const elements = $(selector);
      return elements.map((index, element) => {
        const $element = $(element);
        return callback($element, index);
      }).get();
    } catch (error) {
      logger.warn('Extract list failed:', { selector, error: error.message });
      return [];
    }
  }

  validateUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  sanitizeData(data) {
    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeData(item));
    }
    
    if (data && typeof data === 'object') {
      const sanitized = {};
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null) {
          sanitized[key] = this.sanitizeData(value);
        }
      }
      return sanitized;
    }
    
    if (typeof data === 'string') {
      return data.replace(/\s+/g, ' ').trim();
    }
    
    return data;
  }

  async retryOperation(operation, context = {}) {
    let lastError;
    for (let i = 0; i < this.retries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        logger.warn(`Operation failed (attempt ${i + 1}/${this.retries}):`, {
          ...context,
          error: error.message,
        });
        
        if (i < this.retries - 1) {
          const delay = Math.pow(2, i) * 1000;
          await this.delay(delay);
        }
      }
    }
    throw lastError;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = BaseScraper;