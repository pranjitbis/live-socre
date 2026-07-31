// src/scraper/cricbuzzHomepage.js
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

class CricbuzzHomepageScraper {
  constructor() {
    this.timeout = 15000;
    this.maxRetries = 2;
    this.debug = true;
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    ];
    
    // Valid Cricbuzz endpoints only
    this.validUrls = [
      'https://www.cricbuzz.com/cricket-match/live-scores',
      'https://www.cricbuzz.com/cricket-match/live-scores/upcoming-matches',
      'https://www.cricbuzz.com/cricket-match/fixtures',
    ];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  getHeaders() {
    return {
      'User-Agent': this.getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Pragma': 'no-cache',
    };
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async fetchUrl(url, retryCount = 0) {
    try {
      await this.delay(Math.random() * 1000 + 500);

      logger.info(`Fetching: ${url}`);
      
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: this.getHeaders(),
        maxRedirects: 3,
        decompress: true,
        validateStatus: function (status) {
          return status >= 200 && status < 400;
        },
      });

      // Log response details
      logger.info(`Response Status: ${response.status}`);
      logger.info(`Final URL: ${response.config.url || url}`);
      
      const $ = cheerio.load(response.data);
      const title = $('title').text().trim();
      logger.info(`Page Title: ${title || 'No title'}`);

      return response;
    } catch (error) {
      // Log error properly
      if (error.response) {
        logger.error(`HTTP ${error.response.status} for ${url}: ${error.response.statusText}`);
      } else if (error.request) {
        logger.error(`No response for ${url}: ${error.message}`);
      } else {
        logger.error(`Error fetching ${url}: ${error.message}`);
      }
      
      // Don't retry 404s
      if (error.response && error.response.status === 404) {
        logger.warn(`Skipping ${url} - 404 Not Found`);
        return null;
      }
      
      if (retryCount < this.maxRetries) {
        const backoffDelay = 2000 * (retryCount + 1);
        logger.warn(`Retry ${retryCount + 1}/${this.maxRetries} for ${url} in ${backoffDelay}ms`);
        await this.delay(backoffDelay);
        return this.fetchUrl(url, retryCount + 1);
      }
      throw error;
    }
  }

  async scrape() {
    try {
      logger.info('Scraping matches from Cricbuzz...');

      let allMatches = [];

      for (const url of this.validUrls) {
        try {
          const response = await this.fetchUrl(url);
          
          // Skip if response is null (e.g., 404)
          if (!response) {
            continue;
          }

          if (response.status === 200) {
            const $ = cheerio.load(response.data);
            const text = $('body').text();

            // Check for empty state
            if (text.includes('No matches') || text.includes('Blank state')) {
              logger.info(`No matches available on ${url}`);
              continue;
            }

            const matches = this.extractMatches($, url);
            
            logger.info(`Found ${matches.length} match cards on ${url}`);
            
            if (matches.length > 0) {
              allMatches = allMatches.concat(matches);
            }
          }
        } catch (error) {
          logger.error(`Failed to scrape ${url}:`, error.message);
          continue;
        }
      }

      // Remove duplicates
      const uniqueMatches = this.removeDuplicates(allMatches);
      
      if (uniqueMatches.length === 0) {
        // Save debug info
        this.saveDebugInfo('No matches found - all URLs returned empty');
        return this.emptyResult('No matches currently scheduled or in progress. Checked all valid Cricbuzz endpoints.');
      }

      logger.info(`Found ${uniqueMatches.length} unique matches from Cricbuzz`);
      return {
        source: 'cricbuzz',
        matches: uniqueMatches,
        total: uniqueMatches.length,
        timestamp: new Date().toISOString(),
        message: `${uniqueMatches.length} matches found`,
      };
      
    } catch (error) {
      logger.error('Cricbuzz scraping failed:', error.message);
      this.saveDebugInfo(`Error: ${error.message}`);
      return this.emptyResult('Unable to fetch match data');
    }
  }

  extractMatches($, pageUrl) {
    const matches = [];
    const processed = new Set();

    // Find all match cards - updated selectors
    const matchSelectors = [
      '.cb-col-100 .cb-col-25',
      '.cb-col-100 .cb-col-33',
      '.cb-col-100 .cb-col-50',
      '.match-card',
      '.cb-match-card',
      '.cb-col .cb-col',
      'div[class*="match"]',
      'div[class*="score"]',
    ];

    let matchElements = [];
    for (const selector of matchSelectors) {
      const elements = $(selector);
      if (elements.length > 0) {
        matchElements = elements;
        break;
      }
    }

    // If no match elements found with selectors, look for match patterns in divs
    if (matchElements.length === 0) {
      const allDivs = $('div');
      for (let i = 0; i < allDivs.length; i++) {
        const $el = $(allDivs[i]);
        const elText = $el.text();
        if (elText && elText.length > 20 && elText.length < 2000) {
          const hasTeams = /[A-Z]{2,4}\s+(?:vs|v)\s+[A-Z]{2,4}/i.test(elText) ||
                          /[A-Za-z\s]+\s+vs\s+[A-Za-z\s]+/i.test(elText);
          const hasScore = /\d{1,3}\/\d{1,2}/.test(elText);
          const hasStatus = /LIVE|UPCOMING|RESULT|Stumps/i.test(elText);
          if (hasTeams || hasScore || hasStatus) {
            matchElements.push($el);
          }
        }
      }
    }

    // Process each match element
    matchElements.each(function() {
      const $card = $(this);
      const cardText = $card.text();
      
      if (!cardText || cardText.length < 20) return;
      if (cardText.includes('No matches') || cardText.includes('Blank state')) return;

      // Check if it's a match card
      const hasTeams = /[A-Z]{2,4}\s+(?:vs|v)\s+[A-Z]{2,4}/i.test(cardText) || 
                      /[A-Za-z\s]+\s+vs\s+[A-Za-z\s]+/i.test(cardText);
      const hasScore = /\d{1,3}\/\d{1,2}/.test(cardText);
      const hasStatus = /LIVE|UPCOMING|RESULT|Stumps/i.test(cardText);

      if (!hasTeams && !hasScore && !hasStatus) return;

      // Extract teams
      let team1 = '', team2 = '';
      const vsMatch = cardText.match(/([A-Za-z\s]+?)\s+(?:vs|v)\s+([A-Za-z\s]+?)(?=\s+(?:LIVE|UPCOMING|RESULT|\d|\(|$))/i);
      if (vsMatch) {
        team1 = vsMatch[1].trim();
        team2 = vsMatch[2].trim();
      } else {
        const abbrs = cardText.match(/\b[A-Z]{2,4}\b/g);
        if (abbrs && abbrs.length >= 2) {
          const exclude = ['VS', 'T20', 'ODI', 'IPL', 'LIVE', 'UPCOMING', 'RESULT'];
          const valid = abbrs.filter(a => !exclude.includes(a));
          if (valid.length >= 2) {
            team1 = valid[0];
            team2 = valid[1];
          }
        }
      }

      if (!team1 || !team2) return;

      // Extract match URL
      let matchUrl = '';
      const link = $card.find('a[href*="/cricket-match/"], a[href*="/live-cricket-score/"]').first();
      if (link.length) {
        const href = link.attr('href');
        if (href) {
          matchUrl = href.startsWith('http') ? href : `https://www.cricbuzz.com${href}`;
        }
      }

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
      if (cardText.includes('LIVE') || cardText.includes('Live')) status = 'LIVE';
      else if (cardText.includes('Upcoming')) status = 'UPCOMING';
      else if (cardText.includes('Result')) status = 'RESULT';
      else if (cardText.includes('Stumps')) status = 'STUMPS';

      // Extract series
      let series = '';
      const seriesMatch = cardText.match(/([A-Za-z\s]+(?:T20|ODI|Test|Series|League|Cup|Tour|Tournament))/i);
      if (seriesMatch) {
        series = seriesMatch[1].trim();
      }

      // Extract venue
      let venue = '';
      const venueMatch = cardText.match(/([A-Za-z\s]+(?:Stadium|Ground|Park|Centre|Venue))/i);
      if (venueMatch) {
        venue = venueMatch[1].trim();
      }

      // Extract start time
      let startTime = '';
      const timeMatch = cardText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/);
      if (timeMatch) {
        startTime = timeMatch[1];
      }

      // Extract starts in
      let startsIn = '';
      const startsMatch = cardText.match(/Match starts in\s+([\d\s]+(?:hrs|mins|hours|minutes))/i);
      if (startsMatch) {
        startsIn = startsMatch[1].trim();
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

      // Generate match ID
      const matchId = `cricbuzz_${Date.now()}_${matches.length}`;

      matches.push({
        matchId: matchId,
        url: matchUrl,
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
        startTime: startTime || '',
        startsIn: startsIn || '',
        tabs: [],
        category: this.determineCategory(cardText),
        matchTitle: this.extractMatchTitle(cardText),
      });
    });

    return matches;
  }

  determineCategory(text) {
    if (text.includes('International')) return 'International';
    if (text.includes('League')) return 'League';
    if (text.includes('Domestic')) return 'Domestic';
    if (text.includes('Women')) return 'Women';
    if (text.includes('U19') || text.includes('Under-19')) return 'Youth';
    return 'Other';
  }

  extractMatchTitle(text) {
    // Try to find a descriptive title
    const titleMatch = text.match(/^([^\n]+?)\s+(?:LIVE|UPCOMING|RESULT)/i);
    if (titleMatch) {
      return titleMatch[1].trim();
    }
    // Try to find series + teams
    const seriesTeamMatch = text.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)/i);
    if (seriesTeamMatch) {
      return `${seriesTeamMatch[1]} vs ${seriesTeamMatch[2]}`;
    }
    return '';
  }

  removeDuplicates(matches) {
    const seen = new Set();
    const unique = [];

    for (const match of matches) {
      const key = `${match.team1.name}|${match.team2.name}|${match.status}|${match.series}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(match);
      }
    }

    return unique;
  }

  saveDebugInfo(message) {
    try {
      const debugDir = path.join(__dirname, '../../debug');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = path.join(debugDir, `debug_${timestamp}.txt`);
      
      const content = `
Debug Info: ${message}
Timestamp: ${new Date().toISOString()}
Valid URLs attempted: ${this.validUrls.join(', ')}
      `;
      
      fs.writeFileSync(filename, content);
      logger.info(`Debug info saved to: ${filename}`);
    } catch (error) {
      logger.warn('Failed to save debug info:', error.message);
    }
  }

  emptyResult(message) {
    return {
      source: 'cricbuzz',
      matches: [],
      total: 0,
      timestamp: new Date().toISOString(),
      message: message,
    };
  }
}

module.exports = CricbuzzHomepageScraper;