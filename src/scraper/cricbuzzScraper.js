// src/scraper/cricbuzz/CricbuzzScraper.js - API-based approach
const axios = require('axios');
const BaseScraper = require('../base/BaseScraper');
const config = require('../../config');
const logger = require('../../logger');

class CricbuzzScraper extends BaseScraper {
  constructor() {
    super(config.sources.cricbuzz);
    this.baseUrl = 'https://www.cricbuzz.com';
    this.apiBase = 'https://www.cricbuzz.com/api';
    this.headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
      Referer: 'https://www.cricbuzz.com/',
      Origin: 'https://www.cricbuzz.com',
    };
  }

  async fetchAPI(endpoint) {
    try {
      const response = await axios.get(`${this.apiBase}${endpoint}`, {
        headers: this.headers,
        timeout: 10000,
      });
      return response.data;
    } catch (error) {
      logger.error(`API fetch failed: ${endpoint}`, error.message);
      return null;
    }
  }

  async scrapeLive() {
    logger.info('Scraping Cricbuzz via API...');

    try {
      // Try the matches API endpoint
      const data = await this.fetchAPI('/matches');

      if (!data) {
        // Fallback: try the live scores API
        const liveData = await this.fetchAPI('/cricket-match/live-scores');
        if (liveData) {
          return this.parseLiveData(liveData);
        }
        return [];
      }

      return this.parseMatchData(data);
    } catch (error) {
      logger.error('Cricbuzz API scrape failed:', error.message);
      return [];
    }
  }

  parseMatchData(data) {
    const matches = [];

    if (data && data.matchList) {
      for (const match of data.matchList) {
        try {
          const parsed = {
            matchId: match.matchId || `match_${Date.now()}`,
            url: `${this.baseUrl}/cricket-match/${match.matchId}`,
            series: match.seriesName || 'Unknown Series',
            matchTitle: `${match.team1?.name || 'Team 1'} vs ${match.team2?.name || 'Team 2'}`,
            category: this.detectCategory(match.seriesName, match.matchTitle),
            status: match.status || 'LIVE',
            format: this.detectFormat(match.seriesName, match.matchTitle, match.status),
            venue: match.venue || '',
            team1: {
              name: match.team1?.name || 'Team 1',
              short: this.getShortName(match.team1?.name || 'Team 1'),
              flag: this.getFlagUrl(match.team1?.name),
              score: match.team1?.score || '',
              overs: match.team1?.overs || '',
            },
            team2: {
              name: match.team2?.name || 'Team 2',
              short: this.getShortName(match.team2?.name || 'Team 2'),
              flag: this.getFlagUrl(match.team2?.name),
              score: match.team2?.score || '',
              overs: match.team2?.overs || '',
            },
            toss: match.toss || '',
            result: match.result || '',
            winningTeam: match.winningTeam || '',
            startTime: match.startTime || '',
            startsIn: match.startsIn || '',
            commentary: `${this.baseUrl}/cricket-match/${match.matchId}/commentary`,
            scorecard: `${this.baseUrl}/cricket-match/${match.matchId}/scorecard`,
            preview: `${this.baseUrl}/cricket-match/${match.matchId}/preview`,
            squads: `${this.baseUrl}/cricket-match/${match.matchId}/squads`,
            statistics: `${this.baseUrl}/cricket-match/${match.matchId}/stats`,
            source: 'cricbuzz',
            scrapedAt: new Date().toISOString(),
          };

          if (this.validateMatchData(parsed)) {
            matches.push(parsed);
          }
        } catch (error) {
          logger.error('Error parsing match:', error.message);
        }
      }
    }

    logger.info(`Extracted ${matches.length} matches from Cricbuzz API`);
    return matches;
  }

  parseLiveData(data) {
    // Parse live score data from the API response
    const matches = [];
    // Implementation depends on the actual API response structure
    return matches;
  }

  validateMatchData(match) {
    if (!match.matchId) return false;
    if (!match.team1.name || match.team1.name === 'Team 1') return false;
    if (!match.team2.name || match.team2.name === 'Team 2') return false;
    return true;
  }

  // Keep other required methods
  async scrapeFixtures() {
    return [];
  }
  async scrapeMatch(matchId) {
    return null;
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

module.exports = CricbuzzScraper;
