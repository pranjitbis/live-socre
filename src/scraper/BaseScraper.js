// src/scraper/BaseScraper.js
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

class BaseScraper {
  constructor(config = {}) {
    this.name = config.name || 'BaseScraper';
    this.timeout = config.timeout || 30000;
    this.maxRetries = config.maxRetries || 3;
    this.debugDir = path.join(__dirname, '../../debug');
    this.ensureDebugDir();
    this.selectors = config.selectors || {};
  }

  ensureDebugDir() {
    if (!fs.existsSync(this.debugDir)) {
      fs.mkdirSync(this.debugDir, { recursive: true });
    }
  }

  async scrape(page) {
    throw new Error('scrape() must be implemented by subclass');
  }

  async extractMatches($) {
    throw new Error('extractMatches() must be implemented by subclass');
  }

  async extractMatchData($card) {
    throw new Error('extractMatchData() must be implemented by subclass');
  }

  async saveDebugHTML(html, name) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${this.name}_${name}_${timestamp}.html`;
      const filepath = path.join(this.debugDir, filename);
      fs.writeFileSync(filepath, html);
      logger.debug(`Saved debug HTML: ${filepath}`);
      return filepath;
    } catch (error) {
      logger.error('Failed to save debug HTML:', error);
      return null;
    }
  }

  async saveScreenshot(page, name) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${this.name}_${name}_${timestamp}.png`;
      const filepath = path.join(this.debugDir, filename);
      await page.screenshot({ path: filepath, fullPage: true });
      logger.debug(`Saved screenshot: ${filepath}`);
      return filepath;
    } catch (error) {
      logger.error('Failed to save screenshot:', error);
      return null;
    }
  }

  logSelectorFailure(selector, html, reason) {
    logger.warn(`Selector failure in ${this.name}:`, {
      selector,
      reason,
      htmlSnippet: html?.substring(0, 200) || 'No HTML',
    });
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  removeDuplicates(matches) {
    const seen = new Set();
    const unique = [];
    for (const match of matches) {
      const key = match.matchId || `${match.team1?.name}|${match.team2?.name}|${match.status}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(match);
      }
    }
    return unique;
  }

  isValidMatch(matchData) {
    if (!matchData) return false;
    if (!matchData.team1?.name && !matchData.team2?.name) return false;
    if (matchData.status === 'UNKNOWN') return false;
    if (!matchData.matchId) return false;
    return true;
  }

  validateAndClean(matches) {
    const validated = [];
    for (const match of matches) {
      if (this.isValidMatch(match)) {
        validated.push(match);
      }
    }
    return validated;
  }
}

module.exports = BaseScraper;
