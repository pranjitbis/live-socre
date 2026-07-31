// src/scraper/FlashscoreScraper.js
const BaseScraper = require('./BaseScraper');
const logger = require('../logger');
const cheerio = require('cheerio');

class FlashscoreScraper extends BaseScraper {
  constructor(config = {}) {
    super({ name: 'Flashscore', ...config });
    this.baseUrl = 'https://www.flashscore.com';
  }

  async scrape(page) {
    try {
      logger.info('[Flashscore] Scraping matches...');

      await page.goto('https://www.flashscore.com/cricket/', {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      });

      // Wait for dynamic content
      await page.waitForSelector('.event__match', { timeout: 10000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await this.delay(3000);

      const html = await page.content();
      await this.saveDebugHTML(html, 'page');

      const $ = cheerio.load(html);
      const matches = await this.extractMatches($);

      const uniqueMatches = this.removeDuplicates(matches);
      const validatedMatches = this.validateAndClean(uniqueMatches);

      logger.info(`[Flashscore] Found ${validatedMatches.length} matches`);

      return {
        source: 'flashscore',
        matches: validatedMatches,
        total: validatedMatches.length,
        timestamp: new Date().toISOString(),
        message:
          validatedMatches.length > 0
            ? `${validatedMatches.length} matches found`
            : 'No matches available',
      };
    } catch (error) {
      logger.error('[Flashscore] Scraping failed:', error.message);
      await this.saveScreenshot(page, 'error');
      return this.emptyResult(error.message);
    }
  }

  async extractMatches($) {
    const matches = [];
    const processed = new Set();

    const cards = [];
    const selectors = ['.event__match', '.event__row', '.match-info', '.scoreboard'];

    for (const selector of selectors) {
      const elements = $(selector);
      for (let i = 0; i < elements.length; i++) {
        cards.push(elements[i]);
      }
    }

    const uniqueCards = [...new Set(cards)];

    for (const card of uniqueCards) {
      const $card = $(card);
      const html = $card.html();
      if (!html || processed.has(html)) continue;

      const text = $card.text();
      if (!text || text.length < 20 || text.length > 5000) continue;

      const isNav =
        $card.closest('nav').length > 0 ||
        $card.closest('header').length > 0 ||
        $card.closest('footer').length > 0 ||
        $card.closest('aside').length > 0;

      if (isNav) continue;

      const hasStatus = /LIVE|UPCOMING|FT|Finished/i.test(text);
      const hasTeams =
        /[A-Z]{2,4}\s+(?:vs|v)\s+[A-Z]{2,4}/i.test(text) ||
        /[A-Za-z\s]+\s+-\s+[A-Za-z\s]+/i.test(text);
      const hasScore = /\d{1,3}\s*-\s*\d{1,3}/.test(text);

      if (!hasTeams && !hasScore) continue;

      processed.add(html);
      const matchData = this.extractMatchData($card);
      if (matchData && this.isValidMatch(matchData)) {
        matches.push(matchData);
      }
    }

    return matches;
  }

  extractMatchData($card) {
    try {
      const text = $card.text();

      let status = 'UNKNOWN';
      if (text.includes('LIVE')) status = 'LIVE';
      else if (text.includes('FT') || text.includes('Finished')) status = 'RESULT';
      else if (text.includes('UPCOMING')) status = 'UPCOMING';

      let url = '';
      const link = $card.find('a[href*="/match/"]').first();
      if (link.length) {
        const href = link.attr('href');
        url = href && href.startsWith('http') ? href : `https://www.flashscore.com${href}`;
      }

      const matchId = this.extractMatchId(url);
      const teams = this.extractTeams($card, text);
      const scores = this.extractScores(text);
      const overs = this.extractOvers(text);
      const venue = this.extractVenue(text);
      const startTime = this.extractStartTime(text);

      if (!teams.team1 && !teams.team2) return null;

      return {
        matchId:
          matchId || `flashscore_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        url: url || '',
        series: '',
        matchTitle: `${teams.team1 || ''} vs ${teams.team2 || ''}`,
        category: '',
        status: status,
        format: '',
        venue: venue || '',
        team1: {
          name: teams.team1 || '',
          short: teams.team1Short || '',
          flag: '',
          score: scores.team1 || '',
          overs: overs.team1 || '',
        },
        team2: {
          name: teams.team2 || '',
          short: teams.team2Short || '',
          flag: '',
          score: scores.team2 || '',
          overs: overs.team2 || '',
        },
        toss: '',
        result: '',
        winningTeam: '',
        startTime: startTime || '',
        startsIn: '',
        commentary: '',
        scorecard: '',
        preview: '',
        squads: '',
        statistics: '',
      };
    } catch (error) {
      logger.warn('[Flashscore] Failed to extract match data:', error.message);
      return null;
    }
  }

  extractMatchId(url) {
    if (!url) return null;
    const match = url.match(/\/match\/([a-f0-9-]+)/i);
    return match ? match[1] : null;
  }

  extractTeams($card, text) {
    const result = { team1: '', team1Short: '', team2: '', team2Short: '' };

    const teamSelectors = ['.team-name', '.participant-name', '.homeTeam', '.awayTeam'];
    for (const selector of teamSelectors) {
      const teams = $card.find(selector);
      if (teams.length >= 2) {
        result.team1 = $(teams[0]).text().trim();
        result.team2 = $(teams[1]).text().trim();
        result.team1Short = result.team1.substring(0, 3).toUpperCase();
        result.team2Short = result.team2.substring(0, 3).toUpperCase();
        return result;
      }
    }

    const vsMatch = text.match(
      /([A-Za-z\s]+?)\s+(?:vs|v|-)\s+([A-Za-z\s]+?)(?=\s+(?:LIVE|UPCOMING|FT|\d|\(|$))/i
    );
    if (vsMatch) {
      result.team1 = vsMatch[1].trim();
      result.team2 = vsMatch[2].trim();
      result.team1Short = result.team1.substring(0, 3).toUpperCase();
      result.team2Short = result.team2.substring(0, 3).toUpperCase();
      return result;
    }

    const abbrs = text.match(/\b[A-Z]{2,4}\b/g);
    if (abbrs && abbrs.length >= 2) {
      const exclude = ['VS', 'T20', 'ODI', 'IPL', 'LIVE', 'UPCOMING', 'FT'];
      const valid = abbrs.filter((a) => !exclude.includes(a) && a.length >= 2);
      if (valid.length >= 2) {
        result.team1Short = valid[0];
        result.team2Short = valid[1];
        result.team1 = valid[0];
        result.team2 = valid[1];
        return result;
      }
    }

    return result;
  }

  extractScores(text) {
    const result = { team1: '', team2: '' };
    const scoreMatch = text.match(/(\d{1,3})\s*-\s*(\d{1,3})/);
    if (scoreMatch) {
      result.team1 = scoreMatch[1];
      result.team2 = scoreMatch[2];
    }
    return result;
  }

  extractOvers(text) {
    const result = { team1: '', team2: '' };
    const oversMatch = text.match(/\((\d+\.?\d*)\s*(?:ov|overs?)\)/);
    if (oversMatch) {
      result.team1 = oversMatch[1];
    }
    return result;
  }

  extractVenue(text) {
    const patterns = [/([A-Za-z\s]+(?:Stadium|Ground|Park|Centre|Venue))/i, /@\s+([A-Za-z\s]+)/i];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const venue = match[1].trim();
        if (venue && venue.length > 3) {
          return venue;
        }
      }
    }
    return '';
  }

  extractStartTime(text) {
    const match = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/);
    if (match) return match[1];
    const dateMatch = text.match(
      /(Today|Tomorrow|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/i
    );
    if (dateMatch) return dateMatch[1];
    return '';
  }

  emptyResult(message) {
    return {
      source: 'flashscore',
      matches: [],
      total: 0,
      timestamp: new Date().toISOString(),
      message: message || 'No matches available',
    };
  }
}

module.exports = FlashscoreScraper;
