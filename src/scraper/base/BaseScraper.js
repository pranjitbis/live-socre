const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const logger = require('../../logger');

class BaseScraper {
  constructor(sourceConfig) {
    if (new.target === BaseScraper) {
      throw new TypeError('Cannot instantiate abstract class BaseScraper');
    }

    this.source = sourceConfig.name || 'Unknown';
    this.config = sourceConfig;
    this.baseUrl = sourceConfig.baseUrl || '';
    this.headers = sourceConfig.headers || {};
    this.debugDir = path.join(process.cwd(), 'debug');
    this.ensureDebugDir();
  }

  async ensureDebugDir() {
    try {
      await fs.mkdir(this.debugDir, { recursive: true });
    } catch (error) {
      logger.error(`Failed to create debug directory: ${error.message}`);
    }
  }

  async saveDebugData(type, data, suffix = '') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${this.source}_${type}_${timestamp}${suffix}`;

    try {
      if (typeof data === 'string') {
        const filepath = path.join(this.debugDir, `${filename}.html`);
        await fs.writeFile(filepath, data);
        logger.debug(`Saved HTML debug: ${filepath}`);
        return filepath;
      } else if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
        const filepath = path.join(this.debugDir, `${filename}.png`);
        await fs.writeFile(filepath, data);
        logger.debug(`Saved screenshot: ${filepath}`);
        return filepath;
      } else {
        const filepath = path.join(this.debugDir, `${filename}.json`);
        await fs.writeFile(filepath, JSON.stringify(data, null, 2));
        logger.debug(`Saved JSON debug: ${filepath}`);
        return filepath;
      }
    } catch (error) {
      logger.error(`Failed to save debug data: ${error.message}`);
      return null;
    }
  }

  async fetchPage(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get(url, {
          headers: this.headers,
          timeout: 30000,
          maxRedirects: 5,
          validateStatus: (status) => status < 500,
        });
        return response.data;
      } catch (error) {
        if (i === retries - 1) {
          logger.error(`Failed to fetch ${url}:`, error.message);
          throw error;
        }
        logger.warn(`Retry ${i + 1}/${retries} for ${url}`);
        await this.sleep(1000 * (i + 1));
      }
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  validateMatch(match) {
    // Relaxed validation - don't require URL
    const required = ['matchId', 'matchTitle', 'team1', 'team2'];
    const missing = required.filter((field) => !match[field]);

    if (missing.length > 0) {
      logger.debug(`Match ${match.matchId} missing fields: ${missing.join(', ')}`);
      return false;
    }

    if (!match.team1?.name || !match.team1?.short) {
      logger.debug(`Match ${match.matchId} missing team1 data`);
      return false;
    }

    if (!match.team2?.name || !match.team2?.short) {
      logger.debug(`Match ${match.matchId} missing team2 data`);
      return false;
    }

    return true;
  }

  generateMatchId(url) {
    if (!url) {
      return `match_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    const patterns = [
      /\/match\/([a-zA-Z0-9-]+)/,
      /\/cricket-match\/([a-zA-Z0-9-]+)/,
      /\/live-cricket-score\/([a-zA-Z0-9-]+)/,
      /\/match-id\/([a-zA-Z0-9-]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    return `match_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  cleanText(text) {
    if (!text) return '';
    return text
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[^\x20-\x7E]/g, '') // Remove non-printable characters
      .trim();
  }

  extractScore(scoreText) {
    if (!scoreText) return { score: null, overs: null };

    const clean = this.cleanText(scoreText);
    const scoreMatch = clean.match(/(\d+)\/(\d+)/);
    const oversMatch = clean.match(/(\d+\.\d+)\s*(?:ov|overs?)/i);
    const runsMatch = clean.match(/(\d+)\s*(?:runs?)/i);

    return {
      score: scoreMatch ? `${scoreMatch[1]}/${scoreMatch[2]}` : null,
      runs: runsMatch ? parseInt(runsMatch[1]) : null,
      overs: oversMatch ? oversMatch[1] : null,
    };
  }

  extractTime(timeText) {
    if (!timeText) return { startTime: null, startsIn: null };

    const clean = this.cleanText(timeText);
    const timeMatch = clean.match(/(\d{1,2}:\d{2})\s*(AM|PM)/i);
    if (timeMatch) {
      return {
        startTime: `${timeMatch[1]} ${timeMatch[2]}`,
        startsIn: this.calculateStartsIn(timeMatch[0]),
      };
    }

    // Try to extract just the time
    const timeOnly = clean.match(/(\d{1,2}:\d{2})/);
    if (timeOnly) {
      return {
        startTime: timeOnly[1],
        startsIn: null,
      };
    }

    return { startTime: clean, startsIn: null };
  }

  calculateStartsIn(timeStr) {
    if (!timeStr) return null;

    try {
      const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!match) return null;

      let hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      const period = match[3].toUpperCase();

      if (period === 'PM' && hours < 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;

      const now = new Date();
      const matchTime = new Date(now);
      matchTime.setHours(hours, minutes, 0, 0);

      // If match time is in the past, assume tomorrow
      if (matchTime < now) {
        matchTime.setDate(matchTime.getDate() + 1);
      }

      const diff = matchTime - now;
      if (diff > 0) {
        const hoursUntil = Math.floor(diff / (1000 * 60 * 60));
        const minsUntil = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        return `${hoursUntil}h ${minsUntil}m`;
      }

      return 'Starts soon';
    } catch (error) {
      return null;
    }
  }

  detectCategory(title, series) {
    const combined = `${title} ${series}`.toLowerCase();

    if (combined.includes('women') || combined.includes('womens')) return 'Women';
    if (combined.includes('under-19') || combined.includes('u19')) return 'Under-19';
    if (combined.includes('ipl') || combined.includes('ipl 202')) return 'League';
    if (combined.includes('test') || combined.includes('odi') || combined.includes('t20')) {
      return 'International';
    }
    if (combined.includes('domestic') || combined.includes('state')) return 'Domestic';
    if (combined.includes('league') || combined.includes('championship')) return 'League';

    return 'International';
  }

  detectFormat(title, series, status) {
    const combined = `${title} ${series}`.toLowerCase();

    if (combined.includes('test') || combined.includes('test match')) return 'Test';
    if (combined.includes('odi') || combined.includes('one day')) return 'ODI';
    if (combined.includes('t20') || combined.includes('t-20') || combined.includes('t20i'))
      return 'T20I';
    if (combined.includes('ipl')) return 'IPL';
    if (combined.includes('big bash') || combined.includes('bbl')) return 'Big Bash';
    if (combined.includes('hundred')) return 'The Hundred';
    if (combined.includes('cpl')) return 'CPL';
    if (combined.includes('psl')) return 'PSL';
    if (combined.includes('the hundred')) return 'The Hundred';

    return 'T20I'; // Default
  }

  getShortName(teamName) {
    if (!teamName) return 'UNK';

    const shortNames = {
      India: 'IND',
      Australian: 'AUS',
      Australia: 'AUS',
      England: 'ENG',
      'New Zealand': 'NZ',
      'South Africa': 'SA',
      Pakistan: 'PAK',
      'Sri Lanka': 'SL',
      'West Indies': 'WI',
      Bangladesh: 'BAN',
      Afghanistan: 'AFG',
      Zimbabwe: 'ZIM',
      Ireland: 'IRE',
      Netherlands: 'NED',
      Scotland: 'SCO',
      'United Arab Emirates': 'UAE',
      Nepal: 'NEP',
      Oman: 'OMA',
      'Papua New Guinea': 'PNG',
      'United States': 'USA',
      'Mumbai Indians': 'MI',
      'Chennai Super Kings': 'CSK',
      'Royal Challengers Bangalore': 'RCB',
      'Kolkata Knight Riders': 'KKR',
      'Rajasthan Royals': 'RR',
      'Delhi Capitals': 'DC',
      'Sunrisers Hyderabad': 'SRH',
      'Lucknow Super Giants': 'LSG',
      'Gujarat Titans': 'GT',
      'Punjab Kings': 'PBKS',
    };

    for (const [full, short] of Object.entries(shortNames)) {
      if (teamName.includes(full)) {
        return short;
      }
    }

    // Extract initials for other teams
    const parts = teamName.split(' ');
    if (parts.length >= 2) {
      return parts
        .map((p) => p[0])
        .join('')
        .toUpperCase()
        .substring(0, 3);
    }

    return teamName.substring(0, 3).toUpperCase();
  }

  getFlagUrl(teamName) {
    if (!teamName) return null;

    const flags = {
      India: 'https://flagcdn.com/in.svg',
      Australia: 'https://flagcdn.com/au.svg',
      England: 'https://flagcdn.com/gb-eng.svg',
      'New Zealand': 'https://flagcdn.com/nz.svg',
      'South Africa': 'https://flagcdn.com/za.svg',
      Pakistan: 'https://flagcdn.com/pk.svg',
      'Sri Lanka': 'https://flagcdn.com/lk.svg',
      'West Indies': 'https://flagcdn.com/bb.svg',
      Bangladesh: 'https://flagcdn.com/bd.svg',
      Afghanistan: 'https://flagcdn.com/af.svg',
      Zimbabwe: 'https://flagcdn.com/zw.svg',
      Ireland: 'https://flagcdn.com/ie.svg',
      Netherlands: 'https://flagcdn.com/nl.svg',
      Scotland: 'https://flagcdn.com/gb-sct.svg',
      'United Arab Emirates': 'https://flagcdn.com/ae.svg',
      Nepal: 'https://flagcdn.com/np.svg',
      Oman: 'https://flagcdn.com/om.svg',
      'Papua New Guinea': 'https://flagcdn.com/pg.svg',
      'United States': 'https://flagcdn.com/us.svg',
    };

    for (const [full, flag] of Object.entries(flags)) {
      if (teamName.includes(full)) {
        return flag;
      }
    }

    return null;
  }

  logScrape(type, count = 0, error = null, metadata = {}) {
    const logData = {
      source: this.source,
      type,
      count,
      timestamp: new Date().toISOString(),
      ...metadata,
    };

    if (error) {
      logger.error(`Scrape ${type} failed`, { ...logData, error: error.message });
    } else {
      logger.info(`Scrape ${type} completed`, logData);
    }
  }

  // Abstract methods to be implemented by child classes
  async scrapeLive() {
    throw new Error('scrapeLive() must be implemented by child class');
  }

  async scrapeFixtures() {
    throw new Error('scrapeFixtures() must be implemented by child class');
  }

  async scrapeMatch(matchId) {
    throw new Error('scrapeMatch() must be implemented by child class');
  }

  async scrapeCommentary(matchId) {
    throw new Error('scrapeCommentary() must be implemented by child class');
  }

  async scrapePoints() {
    throw new Error('scrapePoints() must be implemented by child class');
  }

  async scrapeNews() {
    throw new Error('scrapeNews() must be implemented by child class');
  }
}

module.exports = BaseScraper;
