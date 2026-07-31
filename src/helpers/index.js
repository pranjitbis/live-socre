const crypto = require('crypto');

class Helpers {
  static generateId(prefix = '') {
    const id = crypto.randomBytes(16).toString('hex');
    return prefix ? `${prefix}_${id}` : id;
  }

  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static formatDate(date) {
    return new Date(date).toISOString();
  }

  static parseDate(dateString) {
    try {
      return new Date(dateString);
    } catch (error) {
      return null;
    }
  }

  static isValidUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  static sanitizeString(str) {
    if (!str) return '';
    return str
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static parseScore(scoreString) {
    if (!scoreString) return { runs: 0, wickets: 0, overs: 0 };
    
    const parts = scoreString.split('/');
    if (parts.length === 2) {
      return {
        runs: parseInt(parts[0]) || 0,
        wickets: parseInt(parts[1]) || 0,
        overs: 0,
      };
    }
    
    return { runs: 0, wickets: 0, overs: 0 };
  }

  static calculateRunRate(runs, overs) {
    if (!overs || overs === 0) return 0;
    return (runs / overs).toFixed(2);
  }

  static extractMatchId(url) {
    const matchIdMatch = url.match(/(?:match|series)\/([a-f0-9-]+)/i);
    return matchIdMatch ? matchIdMatch[1] : null;
  }

  static extractPlayerName(fullName) {
    return fullName.replace(/[^a-zA-Z\s-]/g, '').trim();
  }

  static groupBy(array, key) {
    return array.reduce((result, item) => {
      const groupKey = item[key];
      if (!result[groupKey]) {
        result[groupKey] = [];
      }
      result[groupKey].push(item);
      return result;
    }, {});
  }

  static deduplicate(array, key) {
    const seen = new Set();
    return array.filter(item => {
      const value = item[key];
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
  }

  static async retry(fn, retries = 3, delay = 1000) {
    let lastError;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (i < retries - 1) {
          await this.sleep(delay * Math.pow(2, i));
        }
      }
    }
    throw lastError;
  }

  static getErrorMessage(error) {
    if (error.response) {
      return error.response.data?.message || error.response.statusText;
    }
    if (error.request) {
      return 'No response received from server';
    }
    return error.message || 'Unknown error';
  }

  static isProduction() {
    return process.env.NODE_ENV === 'production';
  }

  static getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
      rss: Math.round(usage.rss / 1024 / 1024) + 'MB',
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB',
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
      external: Math.round(usage.external / 1024 / 1024) + 'MB',
    };
  }

  static getUptime() {
    return process.uptime();
  }

  static getSystemInfo() {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      pid: process.pid,
      title: process.title,
      memory: this.getMemoryUsage(),
      uptime: this.getUptime(),
    };
  }
}

module.exports = Helpers;