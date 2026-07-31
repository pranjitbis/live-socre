// src/scraper/cricbuzzOnly.js
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../logger');

class CricbuzzOnlyScraper {
  constructor() {
    this.timeout = 15000;
    this.maxRetries = 2;
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    ];
    // Updated URLs - Cricbuzz has changed their structure
    this.urls = {
      live: 'https://www.cricbuzz.com/',
      matches: 'https://www.cricbuzz.com/',
      fixtures: 'https://www.cricbuzz.com/',
      home: 'https://www.cricbuzz.com',
    };
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  getHeaders() {
    return {
      'User-Agent': this.getRandomUserAgent(),
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      Pragma: 'no-cache',
    };
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async fetchUrl(url, retryCount = 0) {
    try {
      await this.delay(Math.random() * 1000 + 500);

      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: this.getHeaders(),
        maxRedirects: 3,
        decompress: true,
        validateStatus: function (status) {
          return status >= 200 && status < 400;
        },
      });

      return response;
    } catch (error) {
      if (retryCount < this.maxRetries) {
        const backoffDelay = 2000 * (retryCount + 1);
        logger.warn(`Retry ${retryCount + 1}/${this.maxRetries} for ${url} in ${backoffDelay}ms`);
        await this.delay(backoffDelay);
        return this.fetchUrl(url, retryCount + 1);
      }
      throw error;
    }
  }

  async scrapeLive() {
    // Try multiple URLs
    const urlsToTry = [this.urls.live, this.urls.matches, this.urls.home];

    for (const url of urlsToTry) {
      try {
        logger.info(`Scraping live matches from Cricbuzz: ${url}`);

        const response = await this.fetchUrl(url);

        if (response.status === 200) {
          const $ = cheerio.load(response.data);
          const text = $('body').text();

          // Check for empty state
          if (text.includes('Blank state') || text.includes('Nothing to show')) {
            logger.info('No matches available on Cricbuzz - Empty state detected');
            continue;
          }

          const matches = this.extractMatches($, text);

          if (matches.length > 0) {
            const uniqueMatches = this.removeDuplicates(matches);
            logger.info(`Found ${uniqueMatches.length} matches from Cricbuzz`);
            return {
              source: 'cricbuzz',
              matches: uniqueMatches,
              total: uniqueMatches.length,
              timestamp: new Date().toISOString(),
              message: `${uniqueMatches.length} matches found`,
            };
          }
        }
      } catch (error) {
        logger.warn(`Failed to scrape ${url}:`, error.message);
        continue;
      }
    }

    return {
      source: 'cricbuzz',
      matches: [],
      total: 0,
      timestamp: new Date().toISOString(),
      message: 'No matches currently available',
    };
  }

  extractMatches($, text) {
    const matches = [];

    // Try to find match cards using various selectors
    const selectors = [
      '.cb-col-100 .cb-col-25',
      '.cb-col-100 .cb-col-33',
      '.cb-col-100 .cb-col-50',
      '.cb-col-100 .cb-col-75',
      '.cb-col',
      '.match-card',
      '.score-card',
      '.cb-match-card',
    ];

    let matchElements = [];
    for (const selector of selectors) {
      const elements = $(selector);
      if (elements.length > 0) {
        matchElements = elements;
        break;
      }
    }

    // If no match elements found with selectors, try to find by text patterns
    if (matchElements.length === 0) {
      // Look for divs containing match patterns
      const allDivs = $('div');
      for (let i = 0; i < allDivs.length; i++) {
        const $el = $(allDivs[i]);
        const elText = $el.text();
        if (elText && elText.length > 20 && elText.length < 2000) {
          const hasTeams =
            /[A-Z]{2,4}\s+(?:vs|v)\s+[A-Z]{2,4}/i.test(elText) ||
            /[A-Za-z\s]+\s+vs\s+[A-Za-z\s]+/i.test(elText);
          const hasScore = /\d{1,3}\/\d{1,2}/.test(elText);
          const hasStatus = /LIVE|UPCOMING|RESULT|Stumps/i.test(elText);
          if (hasTeams || hasScore || hasStatus) {
            matchElements.push($el);
          }
        }
      }
    }

    matchElements.each(function () {
      const $card = $(this);
      const cardText = $card.text();

      if (!cardText || cardText.length < 20) return;
      if (cardText.includes('Blank state') || cardText.includes('Nothing to show')) return;

      const hasTeams =
        /[A-Z]{2,4}\s+(?:vs|v)\s+[A-Z]{2,4}/i.test(cardText) ||
        /[A-Za-z\s]+\s+vs\s+[A-Za-z\s]+/i.test(cardText);
      const hasScore = /\d{1,3}\/\d{1,2}/.test(cardText);
      const hasStatus = /LIVE|UPCOMING|RESULT|Stumps/i.test(cardText);

      if (!hasTeams && !hasScore && !hasStatus) return;

      // Extract teams
      let team1 = '',
        team2 = '';
      const vsMatch = cardText.match(
        /([A-Za-z\s]+?)\s+(?:vs|v)\s+([A-Za-z\s]+?)(?=\s+(?:LIVE|UPCOMING|RESULT|\d|\(|$))/i
      );
      if (vsMatch) {
        team1 = vsMatch[1].trim();
        team2 = vsMatch[2].trim();
      } else {
        const abbrs = cardText.match(/\b[A-Z]{2,4}\b/g);
        if (abbrs && abbrs.length >= 2) {
          const exclude = ['VS', 'T20', 'ODI', 'IPL', 'LIVE', 'UPCOMING', 'RESULT'];
          const valid = abbrs.filter((a) => !exclude.includes(a));
          if (valid.length >= 2) {
            team1 = valid[0];
            team2 = valid[1];
          }
        }
      }

      if (!team1 || !team2) return;

      // Extract score
      let score = '';
      const scoreMatch = cardText.match(/\b(\d{1,3}\/\d{1,2})\b/);
      if (scoreMatch) {
        score = scoreMatch[1];
      }

      // Extract overs
      let overs = '';
      const oversMatch = cardText.match(/\((\d+\.?\d*)\s*ov\)/);
      if (oversMatch) {
        overs = oversMatch[1];
      }

      // Determine status
      let status = 'UNKNOWN';
      if (cardText.includes('LIVE')) status = 'LIVE';
      else if (cardText.includes('Upcoming')) status = 'UPCOMING';
      else if (cardText.includes('Result')) status = 'RESULT';
      else if (cardText.includes('Stumps')) status = 'STUMPS';

      // Extract series
      let series = '';
      const seriesMatch = cardText.match(/([A-Za-z\s]+(?:T20|ODI|Test|Series|League|Cup|Tour))/i);
      if (seriesMatch) {
        series = seriesMatch[1].trim();
      }

      // Extract venue
      let venue = '';
      const venueMatch = cardText.match(/([A-Za-z\s]+(?:Stadium|Ground|Park|Centre|Venue))/i);
      if (venueMatch) {
        venue = venueMatch[1].trim();
      }

      // Extract result
      let result = '';
      const resultMatch = cardText.match(/([A-Za-z\s]+)\s+won by\s+(\d+)\s+(wickets|runs)/i);
      if (resultMatch) {
        result = resultMatch[0];
      }

      // Extract winning team
      let winningTeam = '';
      const winnerMatch = cardText.match(/([A-Za-z\s]+)\s+won by/i);
      if (winnerMatch) {
        winningTeam = winnerMatch[1].trim();
      }

      matches.push({
        matchId: `cricbuzz_${Date.now()}_${matches.length}`,
        url: '',
        series: series || '',
        status: status,
        format: '',
        venue: venue || '',
        team1: {
          name: team1,
          short: team1.substring(0, 3).toUpperCase(),
          flag: '',
          score: score || '',
          overs: overs || '',
        },
        team2: {
          name: team2,
          short: team2.substring(0, 3).toUpperCase(),
          flag: '',
          score: '',
          overs: '',
        },
        result: result || '',
        winningTeam: winningTeam || '',
        startTime: '',
        startsIn: '',
        tabs: [],
      });
    });

    return matches;
  }

  async scrapeFixtures() {
    return this.scrapeLive();
  }

  async scrapeResults() {
    return this.scrapeLive();
  }

  removeDuplicates(matches) {
    const seen = new Set();
    const unique = [];

    for (const match of matches) {
      const key = `${match.team1.name}|${match.team2.name}|${match.status}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(match);
      }
    }

    return unique;
  }
}

module.exports = CricbuzzOnlyScraper;
