// src/scraper/multiSourceScraper.js
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const logger = require('../logger');
const proxyManager = require('../config/proxyManager');

class MultiSourceScraper {
  constructor() {
    this.timeout = 15000;
    this.maxRetries = 2;
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    ];
    this.invalidTeamNames = [
      'URL',
      'ODI',
      'T20',
      'TEST',
      'IPL',
      'MLC',
      'LPL',
      'BAN',
      'ZIM',
      'ENG',
      'IND',
      'NZ',
      'WI',
      'USA',
      'SA',
      'PAK',
      'SL',
      'AUS',
      'AFG',
      'IRE',
      'NED',
      'OMA',
      'PNG',
      'SCOT',
      'UAE',
      'RESULT',
      'LIVE',
      'UPCOMING',
      'STUMPS',
      'TEA',
      'LUNCH',
      'See all',
      'PRE',
      'POST',
      'ICC',
      'RUN',
      'WIDE',
      'CMS',
      'FILM',
      'AFP',
      'DARK',
      'GTM',
    ];
    this.debug = true;

    // Define sources with CORRECT URLs
    this.sources = {
      cricbuzz: {
        name: 'Cricbuzz',
        baseUrl: 'https://www.cricbuzz.com',
        // FIXED: Use homepage as primary URL
        liveScore: 'https://www.cricbuzz.com',
        matches: 'https://www.cricbuzz.com',
        fixtures: 'https://www.cricbuzz.com',
        enabled: true,
        priority: 1,
        useBrowser: false,
        fallbackUrls: {
          live: ['https://www.cricbuzz.com', 'https://www.cricbuzz.com/cricket-match'],
          fixtures: ['https://www.cricbuzz.com', 'https://www.cricbuzz.com/cricket-fixtures'],
          results: ['https://www.cricbuzz.com', 'https://www.cricbuzz.com/cricket-match'],
        },
        selectors: {
          matchCard:
            '.cb-col-100 .cb-col-25, .cb-col-100 .cb-col-33, .cb-col-100 .cb-col-50, .match-card',
          matchLink: 'a[href*="/cricket-match/"], a[href*="/live-cricket-scoreboard/"]',
          team1: '.cb-font-20.text-hvr-underline, .cb-text-link',
          team2: '.cb-font-20.text-hvr-underline, .cb-text-link',
          score: '.cb-font-18, .cb-score',
          status: '.cb-text-gray, .cb-status',
          series: '.cb-font-12, .cb-series',
        },
      },
      espncricinfo: {
        name: 'ESPNcricinfo',
        baseUrl: 'https://www.espncricinfo.com',
        liveScore: 'https://www.espncricinfo.com/live-cricket-score',
        matches: 'https://www.espncricinfo.com/matches',
        fixtures: 'https://www.espncricinfo.com/matches',
        enabled: false, // Disabled due to consent page blocking
        priority: 2,
        useBrowser: true,
        fallbackUrls: {
          live: [
            'https://www.espncricinfo.com/live-cricket-score',
            'https://m.espncricinfo.com/live-cricket-score',
          ],
          fixtures: [
            'https://www.espncricinfo.com/matches',
            'https://www.espncricinfo.com/ci/engine/match/index.html',
          ],
          results: ['https://www.espncricinfo.com/results', 'https://www.espncricinfo.com/matches'],
        },
        selectors: {
          matchCard: '.ds-grow.ds-px-4.ds-py-3, .ds-flex.ds-flex-col.ds-border',
          matchLink: 'a[href*="/match/"]',
          team1: '.ds-text-tight-m.ds-font-bold',
          team2: '.ds-text-tight-m.ds-font-bold',
          score: '.ds-text-title-m.ds-font-bold',
          status: '.ds-text-tight-m.ds-font-regular',
          series: '.ds-text-tight-s.ds-font-bold',
        },
      },
    };

    // Track source failures
    this.failedSources = new Map();
    this.consecutiveFailures = 0;
    this.lastFailureReset = Date.now();
    this.browserScraper = null;

    proxyManager.loadProxies();
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

  hashUrl(url) {
    return crypto.createHash('md5').update(url).digest('hex').substring(0, 16);
  }

  async getBrowserScraper() {
    if (!this.browserScraper) {
      const BrowserScraper = require('./browserScraper');
      this.browserScraper = new BrowserScraper();
      await this.browserScraper.launch();
    }
    return this.browserScraper;
  }

  async fetchUrl(url, retryCount = 0) {
    try {
      const proxy = proxyManager.getProxyForAxios();
      await this.delay(Math.random() * 1000 + 500);

      const config = {
        timeout: this.timeout,
        headers: this.getHeaders(),
        maxRedirects: 3,
        decompress: true,
        validateStatus: function (status) {
          return status >= 200 && status < 400;
        },
      };

      if (proxy) {
        config.proxy = proxy;
      }

      const response = await axios.get(url, config);
      return response;
    } catch (error) {
      if (retryCount < this.maxRetries) {
        const backoffDelay = Math.min(3000 * Math.pow(2, retryCount), 10000);
        logger.warn(`Retry ${retryCount + 1}/${this.maxRetries} for ${url} in ${backoffDelay}ms`);
        await this.delay(backoffDelay);
        return this.fetchUrl(url, retryCount + 1);
      }
      throw error;
    }
  }

  async scrapeWithBrowser(url, type) {
    try {
      const browserScraper = await this.getBrowserScraper();
      const result = await browserScraper.scrapeUrl(url, type);
      return result;
    } catch (error) {
      logger.error(`Browser scraping failed for ${url}:`, error.message);
      return null;
    }
  }

  getEnabledSources(type) {
    const enabled = [];
    const now = Date.now();

    if (now - this.lastFailureReset > 300000) {
      this.failedSources.clear();
      this.lastFailureReset = now;
      this.consecutiveFailures = 0;
    }

    if (this.consecutiveFailures > 10) {
      logger.warn(`Too many consecutive failures (${this.consecutiveFailures}), waiting 30s...`);
      return [];
    }

    for (const [key, source] of Object.entries(this.sources)) {
      if (source.enabled) {
        const failureTime = this.failedSources.get(key);
        if (!failureTime || now - failureTime > 120000) {
          enabled.push({
            key: key,
            source: source,
          });
        }
      }
    }
    return enabled.sort((a, b) => a.source.priority - b.source.priority);
  }

  async scrapeWithFallback(type, urlType) {
    const sources = this.getEnabledSources(type);
    let lastError = null;

    if (sources.length === 0) {
      logger.warn(`No enabled sources available for ${type}`);
      return {
        source: 'none',
        matches: [],
        total: 0,
        timestamp: new Date().toISOString(),
        error: 'No sources available',
        message: 'No cricket matches available at this time',
      };
    }

    for (const sourceInfo of sources) {
      const fallbackUrls = sourceInfo.source.fallbackUrls[type] || [sourceInfo.source[urlType]];

      for (const url of fallbackUrls) {
        try {
          logger.info(`Scraping ${type} from ${sourceInfo.key}: ${url}`);

          let matches = [];
          let result = null;

          // Try browser first if enabled
          if (sourceInfo.source.useBrowser) {
            logger.info(`Using browser for ${sourceInfo.key}`);
            result = await this.scrapeWithBrowser(url, type);
            if (result && result.matches && result.matches.length > 0) {
              matches = result.matches;
            }
          }

          // If no matches from browser, try HTTP
          if (matches.length === 0) {
            logger.info(`Trying HTTP for ${sourceInfo.key}`);
            try {
              const response = await this.fetchUrl(url);

              if (response.status === 200) {
                const html = response.data;

                // Check for consent page
                if (html.includes('Privacy Preference Center') || html.includes('cookie')) {
                  logger.warn(`${sourceInfo.key} returned consent page`);
                  continue;
                }

                // Check for 404/empty page
                if (html.includes('404') || html.includes('Page not found')) {
                  logger.warn(`${sourceInfo.key} returned 404 page`);
                  continue;
                }

                const $ = cheerio.load(html);
                matches = this.extractMatches($, sourceInfo.source, type);
              } else {
                logger.warn(`${sourceInfo.key} returned status ${response.status}`);
                continue;
              }
            } catch (httpError) {
              logger.warn(`HTTP failed for ${sourceInfo.key}:`, httpError.message);
              continue;
            }
          }

          // If still no matches and we have browser HTML, try extracting from it
          if (matches.length === 0 && result && result.html) {
            try {
              logger.info(`Trying to extract from browser HTML for ${sourceInfo.key}`);
              const $ = cheerio.load(result.html);
              matches = this.extractMatches($, sourceInfo.source, type);
            } catch (extractError) {
              logger.warn(`Extract from browser HTML failed:`, extractError.message);
            }
          }

          // Validate matches
          if (matches && matches.length > 0) {
            const validatedMatches = this.validateAndCleanMatches(matches);
            if (validatedMatches.length > 0) {
              logger.info(
                `✅ Found ${validatedMatches.length} valid ${type} matches from ${sourceInfo.key}`
              );
              this.failedSources.delete(sourceInfo.key);
              this.consecutiveFailures = 0;
              return {
                source: sourceInfo.key,
                matches: validatedMatches,
                total: validatedMatches.length,
                timestamp: new Date().toISOString(),
                message: `${validatedMatches.length} matches found`,
              };
            }
          }

          if (this.debug) {
            logger.debug(`No matches found from ${sourceInfo.key} for ${type} at ${url}`);
          }
        } catch (error) {
          lastError = error.message;
          logger.warn(`Source ${sourceInfo.key} failed for ${url}:`, error.message);
        }
      }

      this.failedSources.set(sourceInfo.key, Date.now());
    }

    this.consecutiveFailures++;
    logger.error(
      `All sources failed for ${type} (${this.consecutiveFailures} consecutive failures)`
    );

    return {
      source: 'none',
      matches: [],
      total: 0,
      timestamp: new Date().toISOString(),
      error: lastError || 'All sources failed',
      message: 'No matches currently available. Please check back later.',
    };
  }

  async scrapeLive() {
    return this.scrapeWithFallback('live', 'liveScore');
  }

  async scrapeFixtures() {
    return this.scrapeWithFallback('fixtures', 'fixtures');
  }

  async scrapeResults() {
    return this.scrapeWithFallback('results', 'matches');
  }

  // ==================== EXTRACTION METHODS ====================

  extractMatches($, source, type) {
    try {
      const matches = [];
      const processedCards = new Set();
      const selectors = source.selectors;

      // Try multiple selectors to find match cards
      const cardSelectors = [
        selectors.matchCard,
        '.cb-col-100 .cb-col-25',
        '.cb-col-100 .cb-col-33',
        '.cb-col-100 .cb-col-50',
        '.match-card',
        '.cb-col',
        'div[class*="match"]',
        'div[class*="score"]',
      ];

      let allElements = [];
      for (const selector of cardSelectors) {
        const elements = $(selector);
        if (elements.length > 0) {
          allElements = allElements.concat(elements.get());
        }
      }

      // Also look for match links
      const matchLinks = $(selectors.matchLink || 'a[href*="/cricket-match/"]');
      for (let i = 0; i < matchLinks.length; i++) {
        const linkEl = matchLinks[i];
        const $link = $(linkEl);
        let $parent = $link.parent();
        let depth = 0;
        while ($parent.length && depth < 4) {
          const text = $parent.text();
          if (text && text.length > 30) {
            allElements.push($parent.get(0));
            break;
          }
          $parent = $parent.parent();
          depth++;
        }
      }

      // Remove duplicates
      const uniqueElements = [...new Set(allElements)];

      for (let i = 0; i < uniqueElements.length; i++) {
        const el = uniqueElements[i];
        const $el = $(el);
        const html = $el.html();
        if (!html || processedCards.has(html)) continue;

        const text = $el.text();
        if (!text || text.length < 20 || text.length > 5000) continue;

        // Skip navigation/header/footer
        const isNav =
          $el.closest('nav').length > 0 ||
          $el.closest('header').length > 0 ||
          $el.closest('footer').length > 0 ||
          $el.closest('aside').length > 0;

        if (isNav) continue;

        // Check for match indicators
        const hasStatus = /LIVE|UPCOMING|RESULT|Stumps|Innings Break/i.test(text);
        const hasTeams =
          /[A-Z]{2,4}\s+(?:vs|v)\s+[A-Z]{2,4}/i.test(text) ||
          /[A-Za-z\s]+\s+vs\s+[A-Za-z\s]+/i.test(text);
        const hasScore = /\d{1,3}\/\d{1,2}/.test(text);
        const hasOvers = /\((\d+\.?\d*)\s*(?:ov|overs?)\)/.test(text);

        let indicators = 0;
        if (hasStatus) indicators++;
        if (hasTeams) indicators++;
        if (hasScore) indicators++;
        if (hasOvers) indicators++;

        let minIndicators = 2;
        if (type === 'fixtures') minIndicators = 1;

        if (indicators >= minIndicators) {
          processedCards.add(html);
          const matchData = this.extractMatchData($el, source, type);
          if (matchData && this.isValidMatchData(matchData)) {
            matches.push(matchData);
          }
        }
      }

      return matches;
    } catch (error) {
      logger.error('Extract matches failed:', error.message);
      return [];
    }
  }

  extractMatchData($card, source, type) {
    try {
      const text = $card.text();
      if (!text || text.length < 10) return null;

      const status = this.extractStatus(text, type);
      const url = this.extractMatchUrl($card, source);
      const matchId = url ? this.hashUrl(url) : null;
      const series = this.extractSeries($card, text, source);
      const teams = this.extractTeams($card, text, source);

      if (!teams.team1 || !teams.team2) {
        const teamMatch = text.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)/i);
        if (teamMatch) {
          teams.team1 = teamMatch[1].trim();
          teams.team2 = teamMatch[2].trim();
          teams.team1Short = this.getTeamShortName(teams.team1);
          teams.team2Short = this.getTeamShortName(teams.team2);
        }
      }

      if (!teams.team1 || !teams.team2) return null;

      if (
        this.invalidTeamNames.includes(teams.team1.toUpperCase()) ||
        this.invalidTeamNames.includes(teams.team2.toUpperCase())
      ) {
        return null;
      }

      const scores = this.extractScores(text);
      const overs = this.extractOvers(text);
      const venue = this.extractVenue(text);
      const result = this.extractResult(text);
      const winningTeam = this.extractWinningTeam(text);
      const startTime = this.extractStartTime(text);
      const startsIn = this.extractStartsIn(text);
      const format = this.extractFormat(text);
      const tabs = this.extractTabs($card, text);
      const flags = this.extractFlags($card);

      return {
        matchId: matchId || `match_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        url: url || '',
        series: series || '',
        status: status,
        format: format || '',
        venue: venue || '',
        team1: {
          name: teams.team1 || '',
          short: teams.team1Short || this.getTeamShortName(teams.team1),
          flag: flags.team1 || '',
          score: scores.team1 || '',
          overs: overs.team1 || '',
        },
        team2: {
          name: teams.team2 || '',
          short: teams.team2Short || this.getTeamShortName(teams.team2),
          flag: flags.team2 || '',
          score: scores.team2 || '',
          overs: overs.team2 || '',
        },
        result: result || '',
        winningTeam: winningTeam || '',
        startTime: startTime || '',
        startsIn: startsIn || '',
        tabs: tabs || [],
      };
    } catch (error) {
      return null;
    }
  }

  extractStatus(text, type) {
    if (type === 'fixtures') {
      if (/LIVE/i.test(text)) return 'LIVE';
      if (/RESULT/i.test(text)) return 'RESULT';
      return 'UPCOMING';
    }
    if (type === 'results') return 'RESULT';

    if (/LIVE/i.test(text) && !/RESULT/i.test(text)) return 'LIVE';
    if (/UPCOMING/i.test(text)) return 'UPCOMING';
    if (/RESULT/i.test(text) || /won by/i.test(text)) return 'RESULT';
    if (/Stumps/i.test(text)) return 'STUMPS';
    if (/TEA/i.test(text) && !/STEA/i.test(text)) return 'TEA';
    if (/LUNCH/i.test(text)) return 'LUNCH';
    if (/ABANDONED/i.test(text)) return 'ABANDONED';
    if (/Rain\s+Delay/i.test(text)) return 'RAIN DELAY';
    if (/No\s+Result/i.test(text)) return 'NO RESULT';
    return 'UNKNOWN';
  }

  extractMatchUrl($card, source) {
    const selectors = [
      'a[href*="/match/"]',
      'a[href*="/cricket-match/"]',
      'a[href*="/live-cricket-scoreboard/"]',
    ];

    if (source.selectors.matchLink) {
      selectors.unshift(source.selectors.matchLink);
    }

    for (const selector of selectors) {
      try {
        const link = $card.find(selector).first();
        if (link && link.length) {
          const href = link.attr('href');
          if (href) {
            if (href.startsWith('/')) {
              return `https://www.cricbuzz.com${href}`;
            }
            if (!href.startsWith('http')) {
              return `${source.baseUrl}${href}`;
            }
            return href;
          }
        }
      } catch (e) {}
    }

    return '';
  }

  extractSeries($card, text, source) {
    if (source.selectors.series) {
      try {
        const seriesEl = $card.find(source.selectors.series).first();
        if (seriesEl && seriesEl.length) {
          let seriesText = seriesEl.text().trim();
          if (seriesText) {
            seriesText = this.cleanSeriesName(seriesText);
            if (seriesText && seriesText.length > 3) {
              return seriesText;
            }
          }
        }
      } catch (e) {}
    }

    try {
      const seriesLink = $card.find('a[href*="/cricket-series/"], a[href*="/series/"]').first();
      if (seriesLink && seriesLink.length) {
        let seriesText = seriesLink.text().trim();
        if (seriesText) {
          seriesText = this.cleanSeriesName(seriesText);
          if (seriesText && seriesText.length > 3) {
            return seriesText;
          }
        }
      }
    } catch (e) {}

    const statusMatch = text.match(/(UPCOMING|RESULT|LIVE|Stumps|Innings Break)/i);
    if (statusMatch) {
      const before = text.substring(0, statusMatch.index).trim();
      let clean = before
        .replace(/^\d+\.\s*/, '')
        .replace(/^[•●]\s*/, '')
        .replace(/See all$/i, '')
        .replace(/Live$/i, '')
        .replace(/Result$/i, '')
        .trim();

      if (clean && clean.length > 3 && clean.length < 100) {
        return this.cleanSeriesName(clean);
      }
    }

    return '';
  }

  cleanSeriesName(series) {
    if (!series) return '';
    return series
      .replace(/See all$/i, '')
      .replace(/Live$/i, '')
      .replace(/Result$/i, '')
      .replace(/•/g, '')
      .replace(/●/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  extractTeams($card, text, source) {
    const result = {
      team1: '',
      team1Short: '',
      team2: '',
      team2Short: '',
    };

    if (source.selectors.team1 && source.selectors.team2) {
      try {
        const team1El = $card.find(source.selectors.team1).first();
        const team2El = $card.find(source.selectors.team2).first();
        if (team1El && team1El.length && team2El && team2El.length) {
          let team1 = team1El.text().trim();
          let team2 = team2El.text().trim();
          if (this.isValidTeamName(team1) && this.isValidTeamName(team2)) {
            result.team1 = this.getFullTeamName(team1);
            result.team2 = this.getFullTeamName(team2);
            result.team1Short = this.getTeamShortName(result.team1);
            result.team2Short = this.getTeamShortName(result.team2);
            return result;
          }
        }
      } catch (e) {}
    }

    const vsMatch = text.match(
      /([A-Za-z\s&]+?)\s+(?:vs|v)\s+([A-Za-z\s&]+?)(?=\s+(?:UPCOMING|RESULT|LIVE|Stumps|\d|\(|$))/i
    );
    if (vsMatch) {
      let team1 = vsMatch[1]
        .trim()
        .replace(/\s+\(.*?\)/g, '')
        .trim();
      let team2 = vsMatch[2]
        .trim()
        .replace(/\s+\(.*?\)/g, '')
        .trim();

      if (this.isValidTeamName(team1) && this.isValidTeamName(team2)) {
        result.team1 = this.getFullTeamName(team1);
        result.team2 = this.getFullTeamName(team2);
        result.team1Short = this.getTeamShortName(result.team1);
        result.team2Short = this.getTeamShortName(result.team2);
        return result;
      }
    }

    const abbrs = text.match(/\b([A-Z]{2,4})\b/g);
    if (abbrs && abbrs.length >= 2) {
      const valid = abbrs.filter(
        (a) => this.isValidTeamName(a) && !this.invalidTeamNames.includes(a.toUpperCase())
      );
      if (valid.length >= 2) {
        result.team1Short = valid[0];
        result.team2Short = valid[1];
        result.team1 = this.getFullTeamName(valid[0]);
        result.team2 = this.getFullTeamName(valid[1]);
        return result;
      }
    }

    return result;
  }

  isValidTeamName(name) {
    if (!name) return false;
    const upper = name.toUpperCase();
    return !this.invalidTeamNames.includes(upper) && name.length > 1;
  }

  getFullTeamName(abbr) {
    const teamMap = {
      ENG: 'England',
      IND: 'India',
      AUS: 'Australia',
      NZ: 'New Zealand',
      WI: 'West Indies',
      PAK: 'Pakistan',
      SL: 'Sri Lanka',
      SA: 'South Africa',
      BAN: 'Bangladesh',
      ZIM: 'Zimbabwe',
      AFG: 'Afghanistan',
      IRE: 'Ireland',
      NED: 'Netherlands',
      OMA: 'Oman',
      PNG: 'Papua New Guinea',
      SCOT: 'Scotland',
      UAE: 'UAE',
      USA: 'USA',
      MI: 'Mumbai Indians',
      CSK: 'Chennai Super Kings',
      RCB: 'Royal Challengers Bangalore',
      KKR: 'Kolkata Knight Riders',
      DC: 'Delhi Capitals',
      PBKS: 'Punjab Kings',
      RR: 'Rajasthan Royals',
      SRH: 'Sunrisers Hyderabad',
      LSG: 'Lucknow Super Giants',
      GT: 'Gujarat Titans',
    };
    return teamMap[abbr.toUpperCase()] || abbr;
  }

  getTeamShortName(name) {
    const reverseMap = {
      England: 'ENG',
      India: 'IND',
      Australia: 'AUS',
      'New Zealand': 'NZ',
      'West Indies': 'WI',
      Pakistan: 'PAK',
      'Sri Lanka': 'SL',
      'South Africa': 'SA',
      Bangladesh: 'BAN',
      Zimbabwe: 'ZIM',
      Afghanistan: 'AFG',
      Ireland: 'IRE',
      Netherlands: 'NED',
      Oman: 'OMA',
      'Papua New Guinea': 'PNG',
      Scotland: 'SCOT',
      UAE: 'UAE',
      USA: 'USA',
      'Mumbai Indians': 'MI',
      'Chennai Super Kings': 'CSK',
      'Royal Challengers Bangalore': 'RCB',
      'Kolkata Knight Riders': 'KKR',
      'Delhi Capitals': 'DC',
      'Punjab Kings': 'PBKS',
      'Rajasthan Royals': 'RR',
      'Sunrisers Hyderabad': 'SRH',
      'Lucknow Super Giants': 'LSG',
      'Gujarat Titans': 'GT',
    };
    return reverseMap[name] || name.substring(0, 3).toUpperCase();
  }

  extractScores(text) {
    const result = { team1: '', team2: '' };
    const scorePatterns = text.match(/\b(\d{1,3}\/\d{1,2})\b/g);
    if (scorePatterns) {
      const unique = [...new Set(scorePatterns)];
      if (unique.length >= 2) {
        result.team1 = unique[0];
        result.team2 = unique[1];
      } else if (unique.length === 1) {
        result.team1 = unique[0];
      }
    }
    return result;
  }

  extractOvers(text) {
    const result = { team1: '', team2: '' };
    const overs = text.match(/\((\d+\.?\d*)\s*(?:ov|overs?)\)/g);
    if (overs) {
      const ovs = overs
        .map((o) => {
          const match = o.match(/(\d+\.?\d*)/);
          return match ? match[1] : '';
        })
        .filter((o) => o);
      const unique = [...new Set(ovs)];
      if (unique.length >= 2) {
        result.team1 = unique[0];
        result.team2 = unique[1];
      } else if (unique.length === 1) {
        result.team1 = unique[0];
      }
    }
    return result;
  }

  extractVenue(text) {
    const patterns = [
      /([A-Za-z\s]+(?:Stadium|Ground|Park|Centre|Venue))/i,
      /at\s+([A-Za-z\s]+)(?:,|\.|\s|$)/i,
      /Venue:\s*([A-Za-z\s]+)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const venue = match[1].trim();
        if (
          venue &&
          !venue.includes('Score') &&
          !venue.includes('Live') &&
          !venue.includes('Cricket') &&
          venue.length > 3
        ) {
          return venue;
        }
      }
    }
    return '';
  }

  extractResult(text) {
    const match = text.match(/([A-Za-z\s]+)\s+won by\s+(\d+)\s+(wickets|runs)/i);
    if (match) return match[0];
    if (/Match\s+Tied/i.test(text)) return 'Match Tied';
    if (/No\s+Result/i.test(text)) return 'No Result';
    if (/Abandoned/i.test(text)) return 'Abandoned';
    if (/Drawn/i.test(text)) return 'Match Drawn';
    return '';
  }

  extractWinningTeam(text) {
    const match = text.match(/([A-Za-z\s]+)\s+won by/i);
    if (match) {
      let team = match[1].trim();
      team = team.replace(/^[•●]\s*/, '').trim();
      if (this.isValidTeamName(team)) {
        return this.getFullTeamName(team);
      }
    }
    return '';
  }

  extractStartTime(text) {
    const timeMatch = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/);
    if (timeMatch) return timeMatch[1];
    const dateMatch = text.match(
      /(Today|Tomorrow|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/i
    );
    if (dateMatch) return dateMatch[1];
    return '';
  }

  extractStartsIn(text) {
    const match = text.match(/Match starts in\s+([\d\s]+(?:hrs|mins|hours|minutes))/i);
    if (match) return match[1].trim();
    return '';
  }

  extractFormat(text) {
    const formats = [
      { name: 'Test', patterns: ['Test', 'Tests'] },
      { name: 'ODI', patterns: ['ODI', 'ODIs'] },
      { name: 'T20I', patterns: ['T20I', 'T20Is'] },
      { name: 'T20', patterns: ['T20', 'Twenty20'] },
      { name: 'IPL', patterns: ['IPL'] },
      { name: 'MLC', patterns: ['MLC'] },
      { name: 'LPL', patterns: ['LPL'] },
    ];
    for (const format of formats) {
      for (const pattern of format.patterns) {
        if (text.includes(pattern)) {
          return format.name;
        }
      }
    }
    return '';
  }

  extractTabs($card, text) {
    const tabs = [];
    const tabPatterns = [
      'Scorecard',
      'Commentary',
      'Squads',
      'Preview',
      'News',
      'Videos',
      'Schedule',
      'Table',
    ];
    for (const tab of tabPatterns) {
      if (text.includes(tab)) tabs.push(tab);
    }
    try {
      const links = $card.find('a[href]');
      for (let i = 0; i < links.length; i++) {
        const linkEl = links[i];
        const $link = $(linkEl);
        const linkText = $link.text().trim().toLowerCase();
        const href = $link.attr('href') || '';
        for (const tab of tabPatterns) {
          if (
            (linkText.includes(tab.toLowerCase()) || href.includes(tab.toLowerCase())) &&
            !tabs.includes(tab)
          ) {
            tabs.push(tab);
          }
        }
      }
    } catch (e) {}
    return tabs;
  }

  extractFlags($card) {
    const result = { team1: '', team2: '' };
    try {
      const flags = $card.find('img[alt*="Flag"], img[alt]');
      const flagData = [];
      for (let i = 0; i < flags.length; i++) {
        const flagEl = flags[i];
        const $flag = $(flagEl);
        const alt = $flag.attr('alt') || '';
        const src = $flag.attr('src') || $flag.attr('data-src') || '';
        if (alt && (alt.includes('Flag') || alt.length > 3)) {
          let name = alt.replace(/\s*Flag/i, '').trim();
          if (name && name.length > 1) {
            let imageUrl = src;
            if (src && !src.startsWith('http')) {
              imageUrl = `https://www.espncricinfo.com${src}`;
            }
            flagData.push({ name, src: imageUrl });
          }
        }
      }
      if (flagData.length >= 2) {
        result.team1 = flagData[0].src;
        result.team2 = flagData[1].src;
      }
    } catch (e) {}
    return result;
  }

  isValidMatchData(matchData) {
    if (!matchData) return false;
    if (!matchData.team1?.name && !matchData.team2?.name) return false;
    const team1Name = matchData.team1?.name || '';
    const team2Name = matchData.team2?.name || '';
    if (
      this.invalidTeamNames.includes(team1Name.toUpperCase()) ||
      this.invalidTeamNames.includes(team2Name.toUpperCase())
    ) {
      return false;
    }
    if (team1Name.length < 2 || team2Name.length < 2) return false;
    if (matchData.status === 'UNKNOWN') return false;
    return true;
  }

  validateAndCleanMatches(matches) {
    const validated = [];
    const seen = new Map();
    for (const match of matches) {
      if (!this.isValidMatchData(match)) continue;
      if (match.series) {
        match.series = this.cleanSeriesName(match.series);
      }
      if (!match.matchId) {
        match.matchId = match.url
          ? this.hashUrl(match.url)
          : `match_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      }
      if (match.team1?.name) {
        const fullName = this.getFullTeamName(match.team1.name);
        if (fullName && !this.invalidTeamNames.includes(fullName.toUpperCase())) {
          match.team1.name = fullName;
          match.team1.short = this.getTeamShortName(fullName);
        }
      }
      if (match.team2?.name) {
        const fullName = this.getFullTeamName(match.team2.name);
        if (fullName && !this.invalidTeamNames.includes(fullName.toUpperCase())) {
          match.team2.name = fullName;
          match.team2.short = this.getTeamShortName(fullName);
        }
      }
      if (!match.team1?.name || !match.team2?.name) continue;
      if (
        this.invalidTeamNames.includes(match.team1.name.toUpperCase()) ||
        this.invalidTeamNames.includes(match.team2.name.toUpperCase())
      ) {
        continue;
      }
      const key = `${match.team1.name}|${match.team2.name}|${match.status}|${match.series || ''}`;
      if (!seen.has(key)) {
        seen.set(key, match);
        validated.push(match);
      }
    }
    if (matches.length > validated.length) {
      logger.info(`Validation: ${matches.length} -> ${validated.length} matches`);
    }
    return validated;
  }
}

module.exports = MultiSourceScraper;
