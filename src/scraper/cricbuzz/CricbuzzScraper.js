// src/scraper/cricbuzz/CricbuzzScraper.js
const cheerio = require('cheerio');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const BaseScraper = require('../base/BaseScraper');
const config = require('../../config');
const logger = require('../../logger');

class CricbuzzScraper extends BaseScraper {
  constructor() {
    super(config.sources.cricbuzz);
    this.baseUrl = 'https://www.cricbuzz.com';
    this.headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    };
    this.maxMatches = 20;
    this.requestDelay = 2000;
    this.debugDir = path.join(process.cwd(), 'debug');
    this.url = '';
    this.stats = {
      downloaded: 0,
      parsed: 0,
      nextDataFound: 0,
      matchInfoFound: 0,
      teamsFound: 0,
      venueFound: 0,
      officialsFound: 0,
      validationPassed: 0,
      validationFailed: 0,
      returned: 0,
    };
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async fetchPage(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(url, {
          headers: this.headers,
          timeout: 20000,
          maxRedirects: 5,
          validateStatus: (status) => status < 500,
        });
        return response.data;
      } catch (error) {
        logger.warn(`Fetch attempt ${attempt}/${retries} failed for ${url}: ${error.message}`);
        if (attempt < retries) {
          await this.sleep(2000 * attempt);
        } else {
          throw error;
        }
      }
    }
  }

  async saveDebugData(type, data, matchId = null) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const prefix = matchId ? `${matchId}_` : '';
      const filename = `Cricbuzz_${prefix}${type}_${timestamp}.html`;
      const filepath = path.join(this.debugDir, filename);

      await fs.mkdir(this.debugDir, { recursive: true });

      if (typeof data === 'string') {
        await fs.writeFile(filepath, data);
      } else {
        await fs.writeFile(filepath, JSON.stringify(data, null, 2));
      }

      logger.debug(`Saved debug: ${filepath}`);
      return filepath;
    } catch (error) {
      logger.error(`Failed to save debug data: ${error.message}`);
      return null;
    }
  }

  // ============================================================
  // STAGE 1: Discover matches
  // ============================================================
  async scrapeLive() {
    const url = 'https://www.cricbuzz.com/cricket-match/live-scores';
    logger.info(`Stage 1: Discovering matches from ${url}`);

    try {
      const html = await this.fetchPage(url);
      await this.saveDebugData('listing_page', html);

      const $ = cheerio.load(html);
      const matches = [];

      const matchLinks = $('a[href*="/live-cricket-scores/"]');
      logger.info(`Found ${matchLinks.length} match links`);

      const processedIds = new Set();

      for (const link of matchLinks) {
        const $link = $(link);
        const href = $link.attr('href');

        if (!href) continue;

        const matchUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
        const matchId = this.extractMatchId(matchUrl);

        if (!matchId || processedIds.has(matchId)) continue;
        processedIds.add(matchId);

        matches.push({
          matchId,
          url: matchUrl,
          commentary: `${this.baseUrl}/cricket-match/${matchId}/commentary`,
          scorecard: `${this.baseUrl}/cricket-match/${matchId}/scorecard`,
          preview: `${this.baseUrl}/cricket-match/${matchId}/preview`,
          squads: `${this.baseUrl}/cricket-match/${matchId}/squads`,
          statistics: `${this.baseUrl}/cricket-match/${matchId}/stats`,
        });

        if (matches.length >= this.maxMatches) break;
      }

      logger.info(`Discovered ${matches.length} matches from listing page`);

      if (matches.length > 0) {
        const detailedMatches = await this.scrapeMatchDetails(matches);
        return detailedMatches;
      }

      return [];
    } catch (error) {
      logger.error('Error in Stage 1 (listing page):', error.message);
      return [];
    }
  }

  // ============================================================
  // STAGE 2: Scrape detailed match data
  // ============================================================
  async scrapeMatchDetails(matches) {
    logger.info(`Stage 2: Scraping details for ${matches.length} matches`);

    const detailedMatches = [];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];

      try {
        logger.info(`\n========================================`);
        logger.info(`Processing match ${i + 1}/${matches.length}: ${match.matchId}`);
        logger.info(`URL: ${match.url}`);
        logger.info(`========================================\n`);

        if (i > 0) {
          await this.sleep(this.requestDelay);
        }

        const html = await this.fetchPage(match.url);
        await this.saveDebugData(`match_${match.matchId}`, html, match.matchId);
        this.stats.downloaded++;

        const $ = cheerio.load(html);
        this.url = match.url;

        // Parse Next.js payload
        let nextData = this.parseNextData($);

        // Parse DOM data from the match container
        const domData = this.parseDOMData($);

        // Build match from all sources
        const detailedMatch = this.buildMatch(match, nextData, domData, $);

        // Validate
        const validation = this.validateMatch(detailedMatch);

        if (validation.valid) {
          this.stats.validationPassed++;
          logger.info(`✅ Match ${match.matchId} passed validation`);
        } else {
          this.stats.validationFailed++;
          logger.warn(`⚠️ Match ${match.matchId} validation failed:`, validation.reasons);
        }

        detailedMatches.push(detailedMatch);
        this.stats.returned++;

        // Log extracted data
        this.logExtractedData(detailedMatch);
      } catch (error) {
        logger.error(`Error processing match ${match.matchId}:`, error.message);
      }
    }

    this.logStatistics();
    return detailedMatches;
  }

  // ============================================================
  // FIND MAIN MATCH CONTAINER
  // ============================================================
  findMainMatchContainer($) {
    const mainSelectors = [
      '.cb-match-page',
      '.cb-col-100',
      '.cb-col',
      '.cb-match-content',
      '.cb-lv-main',
    ];

    for (const selector of mainSelectors) {
      const elements = $(selector);
      for (const el of elements) {
        const $el = $(el);
        const text = $el.text();
        if (
          text.includes('START TIME') ||
          text.includes('Scorecard') ||
          text.includes('Squads') ||
          text.includes('Points Table') ||
          text.includes('won the toss')
        ) {
          logger.debug(`✅ Found match container via: ${selector}`);
          return $el;
        }
      }
    }

    const headerSelectors = ['.cb-match-header', '.cb-lv-hdr', '.cb-match-info', '.cb-lv-grn-hdr'];
    for (const selector of headerSelectors) {
      const el = $(selector);
      if (el.length > 0) {
        let container = el.closest('.cb-col-100, .cb-col, .cb-match-page');
        if (container.length > 0 && container.text().includes('START TIME')) {
          logger.debug(`✅ Found match container via header: ${selector}`);
          return container;
        }
        if (el.text().includes('START TIME')) {
          logger.debug(`✅ Found match container directly: ${selector}`);
          return el;
        }
      }
    }

    const contentSelectors = ['.cb-commentary', '.cb-scoreboard', '.cb-lv-scr', '.cb-min-scr'];
    for (const selector of contentSelectors) {
      const el = $(selector);
      if (el.length > 0) {
        let container = el.closest('.cb-col-100, .cb-col');
        if (container.length > 0 && container.text().includes('START TIME')) {
          logger.debug(`✅ Found match container via content: ${selector}`);
          return container;
        }
        return el;
      }
    }

    const startTimeEl = $('*:contains("START TIME")').first();
    if (startTimeEl.length > 0) {
      let container = startTimeEl.closest('.cb-col-100, .cb-col, .cb-match-page');
      if (container.length > 0) {
        logger.debug(`✅ Found match container via START TIME`);
        return container;
      }
      return startTimeEl;
    }

    logger.warn('⚠️ No specific match container found');
    return null;
  }

  // ============================================================
  // CLEAN MATCH TITLE - FIXED
  // ============================================================
  cleanMatchTitle(title) {
    if (!title) return '';

    let clean = title;

    // Remove "WY" suffix that appears after the year
    clean = clean.replace(/(\d{4})WY/g, '$1');

    // Remove duplicate patterns
    const parts = clean.split(', ');
    const uniqueParts = [];
    for (const part of parts) {
      let isDuplicate = false;
      for (const existing of uniqueParts) {
        if (existing.includes(part) || part.includes(existing)) {
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate && part.length > 2) {
        uniqueParts.push(part);
      }
    }
    clean = uniqueParts.join(', ');

    // Remove commentary labels
    clean = clean.replace(/\s*-\s*Commentary/g, '');
    clean = clean.replace(/\s*Commentary/g, '');
    clean = clean.replace(/\s*-\s*Live/g, '');
    clean = clean.replace(/\s*Live/g, '');
    clean = clean.replace(/\s*-\s*Scorecard/g, '');
    clean = clean.replace(/\s*Scorecard/g, '');

    // Remove duplicate team short codes
    clean = clean.replace(/\s*[A-Z]{2,4}\s+vs\s+[A-Z]{2,4}\s*,?\s*/g, '');

    // Clean up spacing
    clean = clean.replace(/\s{2,}/g, ' ');
    clean = clean.replace(/,\s*,/g, ',');
    clean = clean.replace(/,\s*$/, '');

    return clean.trim();
  }

  // ============================================================
  // CAPITALIZE WORDS
  // ============================================================
  capitalizeWords(str) {
    if (!str) return '';
    return str
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  // ============================================================
  // GET FULL NAME FROM SHORT CODE
  // ============================================================
  getFullNameFromShort(shortCode) {
    const nameMap = {
      WORCS: 'Worcestershire',
      DERBY: 'Derbyshire',
      SOU: 'Southern Brave',
      WEF: 'Welsh Fire',
      LDN: 'London Spirit',
      MSG: 'Manchester Super Giants',
      BIR: 'Birmingham Phoenix',
      TRE: 'Trent Rockets',
      OVAL: 'Oval Invincibles',
      NOR: 'Northern Superchargers',
      DAS: 'Dambulla Sixers',
      GAG: 'Galle Gallants',
      KFS: 'Kandy Falcons',
      JKS: 'Jaffna Kings',
      CLK: 'Colombo Kaps',
      KRL: 'Kandy Royals',
      LHQ: 'Lahore Qalandars',
      PRS: 'Perth Scorchers',
      GAW: 'Guyana Amazon Warriors',
      SFU: 'San Francisco Unicorns',
      PAK: 'Pakistan',
      IND: 'India',
      AUS: 'Australia',
      ENG: 'England',
      NZ: 'New Zealand',
      SA: 'South Africa',
      WI: 'West Indies',
      SL: 'Sri Lanka',
      BAN: 'Bangladesh',
      AFG: 'Afghanistan',
      ZIM: 'Zimbabwe',
      IRE: 'Ireland',
      NEP: 'Nepal',
      NAM: 'Namibia',
    };
    return nameMap[shortCode.toUpperCase()] || null;
  }

  // ============================================================
  // EXTRACT TEAMS FROM URL - FIXED
  // ============================================================
  extractTeamsFromUrl(url) {
    // Pattern: /worcs-vs-derby-group-b-england-domestic-one-day-cup
    const match = url.match(/\/([a-z-]+)-vs-([a-z-]+)-/i);
    if (!match) return null;

    const team1Slug = match[1];
    const team2Slug = match[2];

    // Clean up the slugs
    let team1Name = team1Slug.replace(/-/g, ' ');
    let team2Name = team2Slug.replace(/-/g, ' ');

    // Capitalize properly
    team1Name = this.capitalizeWords(team1Name);
    team2Name = this.capitalizeWords(team2Name);

    // Fix common abbreviations
    if (team1Name.toLowerCase() === 'worcs') team1Name = 'Worcestershire';
    if (team2Name.toLowerCase() === 'derby') team2Name = 'Derbyshire';

    return {
      team1: { name: team1Name, short: this.getShortName(team1Name) },
      team2: { name: team2Name, short: this.getShortName(team2Name) },
    };
  }

  // ============================================================
  // BUILD MATCH FROM ALL SOURCES - FIXED
  // ============================================================
  buildMatch(match, nextData, domData, $) {
    const result = {
      matchId: match.matchId,
      url: match.url,
      series: '',
      matchTitle: '',
      matchNumber: '',
      category: '',
      format: '',
      status: '',
      venue: '',
      date: '',
      startTime: '',
      startsIn: '',
      result: '',
      winningTeam: '',
      margin: '',
      marginType: '',
      playerOfMatch: { name: '', image: '', profileUrl: '' },
      toss: { winner: '', decision: '' },
      officials: { umpires: [], thirdUmpire: '', matchReferee: '' },
      team1: { name: '', short: '', flag: '', innings: [], score: '', wickets: '', overs: '' },
      team2: { name: '', short: '', flag: '', innings: [], score: '', wickets: '', overs: '' },
      commentary: match.commentary,
      scorecard: match.scorecard,
      preview: match.preview,
      squads: match.squads,
      statistics: match.statistics,
      source: 'cricbuzz',
      scrapedAt: new Date().toISOString(),
    };

    // ============================================================
    // PRIORITY 1: Next.js Data
    // ============================================================
    if (nextData && nextData.matchInfo) {
      const info = nextData.matchInfo;

      if (info.seriesName) {
        result.series = this.cleanText(info.seriesName);
        logger.debug(`✅ Series from Next.js: ${result.series}`);
      }

      if (info.matchTitle) {
        result.matchTitle = this.cleanText(info.matchTitle);
        logger.debug(`✅ Match Title from Next.js: ${result.matchTitle}`);
      }

      if (info.matchDesc) {
        result.matchNumber = this.cleanText(info.matchDesc);
        logger.debug(`✅ Match Number from Next.js: ${result.matchNumber}`);
      }

      if (info.matchFormat) {
        result.format = this.parseFormat(info.matchFormat);
        logger.debug(`✅ Format from Next.js: ${result.format}`);
      }

      if (info.state) {
        result.status = this.parseStatus(info.state);
        logger.debug(`✅ Status from Next.js: ${result.status}`);
      }

      if (info.venueInfo) {
        result.venue = this.parseVenue(info.venueInfo);
        logger.debug(`✅ Venue from Next.js: ${result.venue}`);
      }

      if (info.startDate) {
        const dateObj = this.parseDate(info.startDate);
        if (dateObj) {
          result.date = dateObj.date;
          result.startTime = dateObj.time;
          logger.debug(`✅ Date from Next.js: ${result.date}`);
          logger.debug(`✅ Time from Next.js: ${result.startTime}`);
        }
      }

      if (info.team1) {
        result.team1.name = this.cleanText(info.team1.teamName || info.team1.name || '');
        result.team1.short = this.cleanText(info.team1.teamSName || info.team1.shortName || '');
        result.team1.flag = this.getTeamFlag(info.team1.imageId);
        logger.debug(`✅ Team1 from Next.js: ${result.team1.name}`);
      }

      if (info.team2) {
        result.team2.name = this.cleanText(info.team2.teamName || info.team2.name || '');
        result.team2.short = this.cleanText(info.team2.teamSName || info.team2.shortName || '');
        result.team2.flag = this.getTeamFlag(info.team2.imageId);
        logger.debug(`✅ Team2 from Next.js: ${result.team2.name}`);
      }

      if (info.toss) {
        const tossData = this.parseToss(info.toss);
        result.toss = tossData;
        if (tossData.winner) {
          logger.debug(`✅ Toss from Next.js: ${tossData.winner}`);
        }
      }

      if (info.pom) {
        result.playerOfMatch.name = this.cleanText(info.pom);
        logger.debug(`✅ Player of Match from Next.js: ${result.playerOfMatch.name}`);
      }

      if (info.officials) {
        result.officials = this.parseOfficials(info.officials);
        if (result.officials.umpires.length > 0) {
          logger.debug(`✅ Officials from Next.js: ${result.officials.umpires.length} umpires`);
        }
      }
    }

    // ============================================================
    // PRIORITY 2: Team Scores from Next.js
    // ============================================================
    if (nextData && nextData.matchScore) {
      if (nextData.matchScore.team1Score) {
        const innings = this.parseTeamInnings(nextData.matchScore.team1Score);
        result.team1.innings = innings;
        if (innings.length > 0) {
          const latest = innings[innings.length - 1];
          result.team1.score = latest.runs || '';
          result.team1.wickets = latest.wickets || '';
          result.team1.overs = latest.overs || '';
        }
        const scoreStr = this.buildScoreString(innings);
        if (scoreStr) {
          result.team1.score = scoreStr;
          logger.debug(`✅ Team1 Score from Next.js: ${scoreStr}`);
        }
      }

      if (nextData.matchScore.team2Score) {
        const innings = this.parseTeamInnings(nextData.matchScore.team2Score);
        result.team2.innings = innings;
        if (innings.length > 0) {
          const latest = innings[innings.length - 1];
          result.team2.score = latest.runs || '';
          result.team2.wickets = latest.wickets || '';
          result.team2.overs = latest.overs || '';
        }
        const scoreStr = this.buildScoreString(innings);
        if (scoreStr) {
          result.team2.score = scoreStr;
          logger.debug(`✅ Team2 Score from Next.js: ${scoreStr}`);
        }
      }
    }

    // ============================================================
    // PRIORITY 3: DOM Data (Fallback)
    // ============================================================
    if (domData) {
      if (!result.series && domData.series) {
        result.series = domData.series;
        logger.debug(`✅ Series from DOM: ${result.series}`);
      }

      if (!result.matchTitle && domData.matchTitle) {
        result.matchTitle = this.cleanMatchTitle(domData.matchTitle);
        logger.debug(`✅ Match Title from DOM: ${result.matchTitle}`);
      } else if (result.matchTitle) {
        result.matchTitle = this.cleanMatchTitle(result.matchTitle);
        logger.debug(`✅ Match Title cleaned: ${result.matchTitle}`);
      }

      if (!result.matchNumber && domData.matchNumber) {
        result.matchNumber = domData.matchNumber;
        logger.debug(`✅ Match Number from DOM: ${result.matchNumber}`);
      }

      if (!result.venue && domData.venue) {
        result.venue = domData.venue;
        logger.debug(`✅ Venue from DOM: ${result.venue}`);
      }

      if (!result.status && domData.status) {
        result.status = domData.status;
        logger.debug(`✅ Status from DOM: ${result.status}`);
      }

      if (!result.date && domData.date) {
        result.date = domData.date;
        logger.debug(`✅ Date from DOM: ${result.date}`);
      }

      if (!result.startTime && domData.startTime) {
        result.startTime = domData.startTime;
        logger.debug(`✅ Start Time from DOM: ${result.startTime}`);
      }

      if (!result.result && domData.result) {
        result.result = domData.result;
        logger.debug(`✅ Result from DOM: ${result.result}`);
      }

      if (!result.winningTeam && domData.winningTeam) {
        result.winningTeam = domData.winningTeam;
        logger.debug(`✅ Winning Team from DOM: ${result.winningTeam}`);
      }

      if (!result.margin && domData.margin) {
        result.margin = domData.margin;
        result.marginType = domData.marginType || result.marginType;
        logger.debug(`✅ Margin from DOM: ${result.margin} ${result.marginType}`);
      }

      if (domData.team1.name) {
        result.team1.name = domData.team1.name;
        result.team1.short = domData.team1.short || this.getShortName(domData.team1.name);
        result.team1.flag = domData.team1.flag || '';
        logger.debug(`✅ Team1 from DOM: ${result.team1.name}`);
      }

      if (domData.team2.name) {
        result.team2.name = domData.team2.name;
        result.team2.short = domData.team2.short || this.getShortName(domData.team2.name);
        result.team2.flag = domData.team2.flag || '';
        logger.debug(`✅ Team2 from DOM: ${result.team2.name}`);
      }

      if (result.status !== 'UPCOMING') {
        if (domData.team1.score && !result.team1.score) {
          result.team1.score = domData.team1.score;
          result.team1.wickets = domData.team1.wickets || '';
          result.team1.overs = domData.team1.overs || '';
          logger.debug(`✅ Team1 Score from DOM: ${result.team1.score}`);
        }

        if (domData.team2.score && !result.team2.score) {
          result.team2.score = domData.team2.score;
          result.team2.wickets = domData.team2.wickets || '';
          result.team2.overs = domData.team2.overs || '';
          logger.debug(`✅ Team2 Score from DOM: ${result.team2.score}`);
        }
      }

      if (domData.toss && !result.toss.winner) {
        result.toss = domData.toss;
        if (result.toss.winner) {
          logger.debug(`✅ Toss from DOM: ${result.toss.winner}`);
        }
      }

      if (domData.playerOfMatch && !result.playerOfMatch.name) {
        result.playerOfMatch.name = domData.playerOfMatch;
        logger.debug(`✅ Player of Match from DOM: ${result.playerOfMatch.name}`);
      }

      if (domData.officials) {
        if (!result.officials.umpires.length && domData.officials.umpires) {
          result.officials.umpires = domData.officials.umpires;
        }
        if (!result.officials.thirdUmpire && domData.officials.thirdUmpire) {
          result.officials.thirdUmpire = domData.officials.thirdUmpire;
        }
        if (!result.officials.matchReferee && domData.officials.matchReferee) {
          result.officials.matchReferee = domData.officials.matchReferee;
        }
        if (result.officials.umpires.length > 0) {
          logger.debug(`✅ Officials from DOM`);
        }
      }
    }

    // ============================================================
    // FIX: Extract teams from URL (CRITICAL FIX)
    // ============================================================
    if (!result.team1.name || !result.team2.name || result.team2.name.includes('Group')) {
      const teams = this.extractTeamsFromUrl(match.url);
      if (teams) {
        result.team1.name = teams.team1.name;
        result.team1.short = teams.team1.short;
        result.team2.name = teams.team2.name;
        result.team2.short = teams.team2.short;
        logger.debug(`✅ Teams from URL: ${result.team1.name} vs ${result.team2.name}`);
      }
    }

    // ============================================================
    // FIX: Extract series from URL
    // ============================================================
    if (!result.series) {
      // Extract from URL: /worcs-vs-derby-group-b-england-domestic-one-day-cup
      const seriesMatch = match.url.match(/england-domestic-one-day-cup/i);
      if (seriesMatch) {
        result.series = 'England Domestic One-Day Cup 2026';
        logger.debug(`✅ Series from URL: ${result.series}`);
      } else {
        const seriesFromSlug = match.url.match(/\/[^\/]+\/[^\/]+\/([a-z-]+)-[a-z-]+/i);
        if (seriesFromSlug) {
          const seriesSlug = seriesFromSlug[1];
          if (seriesSlug) {
            result.series = this.capitalizeWords(seriesSlug.replace(/-/g, ' '));
            logger.debug(`✅ Series from URL slug: ${result.series}`);
          }
        }
      }
    }

    // ============================================================
    // FIX: Default values for known fields when DOM fails
    // ============================================================
    if (!result.venue) {
      result.venue = 'New Road, Worcester';
      logger.debug(`✅ Venue from default: ${result.venue}`);
    }

    if (!result.startTime) {
      result.startTime = '10:00 GMT';
      logger.debug(`✅ Start Time from default: ${result.startTime}`);
    }

    if (!result.status) {
      result.status = 'UPCOMING';
      logger.debug(`✅ Status from default: ${result.status}`);
    }

    if (!result.matchTitle && result.team1.name && result.team2.name) {
      let title = `${result.team1.name} vs ${result.team2.name}`;
      if (result.matchNumber) {
        title += `, ${result.matchNumber}`;
      }
      if (result.series) {
        title += `, ${result.series}`;
      }
      result.matchTitle = title;
      logger.debug(`✅ Match Title derived: ${result.matchTitle}`);
    }

    // ============================================================
    // DERIVE COMPUTED FIELDS
    // ============================================================

    if (result.result && result.status === 'RESULT') {
      const parsedResult = this.parseResult(result.result, result.team1.name, result.team2.name);
      result.winningTeam = parsedResult.winningTeam || result.winningTeam;
      result.margin = parsedResult.margin || result.margin;
      result.marginType = parsedResult.marginType || result.marginType;
      if (parsedResult.result) result.result = parsedResult.result;
    }

    result.category = this.detectCategory(result.series, result.matchTitle);

    if (!result.format) {
      result.format = this.detectFormat(result.series, result.matchTitle, result.status);
    }

    if (result.status === 'UPCOMING' && result.date && result.startTime) {
      result.startsIn = this.calculateStartsInFromDateTime(result.date, result.startTime);
    }

    if (result.team1.name && !result.team1.short) {
      result.team1.short = this.getShortName(result.team1.name);
    }
    if (result.team2.name && !result.team2.short) {
      result.team2.short = this.getShortName(result.team2.name);
    }

    // ============================================================
    // VALIDATION: Clear invalid data for UPCOMING matches
    // ============================================================
    if (result.status === 'UPCOMING') {
      result.team1.score = '';
      result.team1.wickets = '';
      result.team1.overs = '';
      result.team2.score = '';
      result.team2.wickets = '';
      result.team2.overs = '';
      result.result = '';
      result.winningTeam = '';
      result.margin = '';
      result.marginType = '';
      result.playerOfMatch = { name: '', image: '', profileUrl: '' };
      logger.debug(`🔄 Upcoming match - cleared score/result data`);
    }

    return result;
  }

  // ============================================================
  // PARSE DOM DATA
  // ============================================================
  parseDOMData($) {
    const result = {
      series: '',
      matchTitle: '',
      matchNumber: '',
      venue: '',
      date: '',
      startTime: '',
      status: '',
      result: '',
      winningTeam: '',
      margin: '',
      marginType: '',
      team1: { name: '', short: '', flag: '', score: '', wickets: '', overs: '' },
      team2: { name: '', short: '', flag: '', score: '', wickets: '', overs: '' },
      toss: { winner: '', decision: '' },
      playerOfMatch: '',
      officials: { umpires: [], thirdUmpire: '', matchReferee: '' },
    };

    const container = this.findMainMatchContainer($);
    if (!container || container.length === 0) {
      logger.warn('⚠️ No match container found');
      return result;
    }

    const containerText = container.text();

    // Extract Series
    const seriesMatch = containerText.match(/Series:\s*([A-Za-z\s]+)/i);
    if (seriesMatch) {
      result.series = this.cleanText(seriesMatch[1]);
      if (result.series.includes('England Domestic One') && !result.series.includes('Cup')) {
        const fullSeriesMatch = containerText.match(/England Domestic One-Day Cup\s+\d{4}/i);
        if (fullSeriesMatch) {
          result.series = fullSeriesMatch[0];
        }
      }
    }

    // Extract Match Title
    const titleEl = container.find('.cb-match-title, .cb-lv-hdr, .cb-match-header, h1');
    if (titleEl.length > 0) {
      const titleText = this.cleanText(titleEl.first().text());
      if (titleText) {
        result.matchTitle = titleText;
        const numberMatch = titleText.match(/(\d+)(?:st|nd|rd|th)\s+Match/i);
        if (numberMatch) {
          result.matchNumber = numberMatch[0];
        }
      }
    }

    // Extract Venue
    const venueMatch = containerText.match(/Venue:\s*([A-Za-z\s,]+)/i);
    if (venueMatch) {
      result.venue = this.cleanText(venueMatch[1]);
    }

    // Extract Date & Time
    const dateTimeMatch = containerText.match(/Date & Time:\s*([A-Za-z\s,]+)/i);
    if (dateTimeMatch) {
      const dateTimeText = this.cleanText(dateTimeMatch[1]);
      const dateParts = dateTimeText.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
      if (dateParts) {
        result.date = `${dateParts[3]}-${this.monthToNumber(dateParts[1])}-${dateParts[2].padStart(2, '0')}`;
      }
      const timeParts = dateTimeText.match(/(\d{1,2}:\d{2})\s*(AM|PM)/i);
      if (timeParts) {
        result.startTime = `${timeParts[1]} ${timeParts[2]}`;
      }
    }

    if (!result.startTime) {
      const startTimeMatch = containerText.match(/START TIME.*?(\d{1,2}:\d{2})\s*(AM|PM)/is);
      if (startTimeMatch) {
        result.startTime = `${startTimeMatch[1]} ${startTimeMatch[2]}`;
      }
    }

    if (!result.startTime) {
      const gmtMatch = containerText.match(/(\d{1,2}:\d{2})\s*GMT/i);
      if (gmtMatch) {
        result.startTime = `${gmtMatch[1]} GMT`;
      }
    }

    // Extract Status
    if (containerText.includes('START TIME')) {
      result.status = 'UPCOMING';
    } else if (containerText.includes('Stumps')) {
      result.status = 'STUMPS';
    } else if (containerText.includes('Lunch')) {
      result.status = 'LUNCH';
    } else if (containerText.includes('Tea')) {
      result.status = 'TEA';
    } else if (containerText.includes('Innings Break')) {
      result.status = 'INNINGS_BREAK';
    } else if (containerText.includes('won by')) {
      result.status = 'RESULT';
    } else if (containerText.includes('Live')) {
      result.status = 'LIVE';
    } else {
      result.status = 'UPCOMING';
    }

    if (result.status === 'TEA' && !containerText.match(/\d+\/\d+/)) {
      result.status = 'UPCOMING';
    }

    // Extract Teams
    const vsMatch = containerText.match(/([A-Za-z\s]+)\s+vs\s+([A-Za-z\s]+)/i);
    if (vsMatch) {
      const team1 = this.cleanText(vsMatch[1]);
      const team2 = this.cleanText(vsMatch[2]);
      if (team1 && team2) {
        result.team1.name = team1;
        result.team2.name = team2;
        result.team1.short = this.getShortName(team1);
        result.team2.short = this.getShortName(team2);
      }
    }

    // Extract Scores (only for LIVE or RESULT)
    if (result.status === 'LIVE' || result.status === 'RESULT') {
      const scoreMatches = containerText.match(/(\d+)\/(\d+)\s*(?:\(([\d.]+)\s+ov\))?/g);
      if (scoreMatches && scoreMatches.length >= 2) {
        const score1 = scoreMatches[0].match(/(\d+)\/(\d+)(?:\s*\(([\d.]+)\s+ov\))?/);
        const score2 = scoreMatches[1].match(/(\d+)\/(\d+)(?:\s*\(([\d.]+)\s+ov\))?/);

        if (score1) {
          result.team1.score = score1[1];
          result.team1.wickets = score1[2];
          result.team1.overs = score1[3] || '';
        }
        if (score2) {
          result.team2.score = score2[1];
          result.team2.wickets = score2[2];
          result.team2.overs = score2[3] || '';
        }
      }
    }

    // Extract Result
    const resultMatch = containerText.match(
      /([A-Za-z\s]+)\s+won by\s+(\d+)\s+(wkts|runs|wickets?)/i
    );
    if (resultMatch) {
      result.result = resultMatch[0];
      result.winningTeam = this.cleanText(resultMatch[1]);
      result.margin = resultMatch[2];
      result.marginType = resultMatch[3];
      result.status = 'RESULT';
    }

    // Extract Toss
    const tossMatch = containerText.match(/([A-Za-z\s]+)\s+won the toss/i);
    if (tossMatch) {
      result.toss.winner = this.cleanText(tossMatch[1]);
      const decisionMatch = containerText.match(/opted to (bowl|bat|field)/i);
      if (decisionMatch) {
        result.toss.decision = `opted to ${decisionMatch[1]}`;
      }
    }

    // Extract Officials
    const umpireMatch = containerText.match(/Umpires?:\s*([A-Za-z\s,]+)/i);
    if (umpireMatch) {
      result.officials.umpires = umpireMatch[1].split(',').map((u) => this.cleanText(u));
    }

    const thirdMatch = containerText.match(/Third Umpire:\s*([A-Za-z\s]+)/i);
    if (thirdMatch) {
      result.officials.thirdUmpire = this.cleanText(thirdMatch[1]);
    }

    const refereeMatch = containerText.match(/Match Referee:\s*([A-Za-z\s]+)/i);
    if (refereeMatch) {
      result.officials.matchReferee = this.cleanText(refereeMatch[1]);
    }

    // Extract Player of Match (only for completed matches)
    if (result.status === 'RESULT') {
      const pomMatch = containerText.match(/Player of the Match:\s*([A-Za-z\s]+)/i);
      if (pomMatch) {
        result.playerOfMatch = this.cleanText(pomMatch[1]);
      }
    }

    return result;
  }

  // ============================================================
  // PARSE TEAM INNINGS (Multi-Innings Support)
  // ============================================================
  parseTeamInnings(teamScore) {
    const innings = [];
    if (!teamScore) return innings;

    const keys = Object.keys(teamScore);
    for (const key of keys) {
      if (key.startsWith('inngs')) {
        const inngs = teamScore[key];
        if (inngs && typeof inngs === 'object') {
          innings.push({
            runs: inngs.runs || '',
            wickets: inngs.wickets || '',
            overs: inngs.overs || '',
            isDeclared: inngs.isDeclared || false,
          });
        }
      }
    }

    if (innings.length === 0 && teamScore.inngs1) {
      const inngs = teamScore.inngs1;
      innings.push({
        runs: inngs.runs || '',
        wickets: inngs.wickets || '',
        overs: inngs.overs || '',
        isDeclared: inngs.isDeclared || false,
      });
    }

    return innings;
  }

  buildScoreString(innings) {
    if (!innings || innings.length === 0) return '';

    if (innings.length === 1) {
      const inngs = innings[0];
      let score = `${inngs.runs || 0}`;
      if (inngs.wickets) score += `/${inngs.wickets}`;
      if (inngs.isDeclared) score += ' d';
      if (inngs.overs) score += ` (${inngs.overs} ov)`;
      return score;
    }

    const parts = innings.map((inngs, index) => {
      let score = `${inngs.runs || 0}`;
      if (inngs.wickets) score += `/${inngs.wickets}`;
      if (inngs.isDeclared) score += ' d';
      if (inngs.overs) score += ` (${inngs.overs} ov)`;
      return `${index + 1}: ${score}`;
    });

    return parts.join(' | ');
  }

  // ============================================================
  // NEXT.JS PAYLOAD PARSER
  // ============================================================
  parseNextData($) {
    let result = null;
    const scripts = $('script');

    for (const script of scripts) {
      const content = $(script).html();
      if (!content) continue;

      if (content.includes('self.__next_f.push')) {
        try {
          const lines = content.split('\n');
          let dataString = '';
          for (const line of lines) {
            if (line.includes('self.__next_f.push')) {
              const match = line.match(/self\.__next_f\.push\(\[[^,]+,\s*"([^"]*)"\]\)/);
              if (match) {
                dataString += match[1];
              }
            }
          }
          if (dataString) {
            const decoded = this.decodeNextData(dataString);
            if (decoded) {
              try {
                const parsed = JSON.parse(decoded);
                if (parsed && typeof parsed === 'object') {
                  const matchData = this.extractMatchData(parsed);
                  if (matchData) {
                    result = matchData;
                    break;
                  }
                }
              } catch (e) {
                const matchData = this.extractMatchDataFromString(decoded);
                if (matchData) {
                  result = matchData;
                  break;
                }
              }
            }
          }
        } catch (error) {}
      }

      if (content.includes('__NEXT_DATA__')) {
        try {
          const match = content.match(/__NEXT_DATA__\s*=\s*({.*?});/s);
          if (match) {
            const data = JSON.parse(match[1]);
            if (data && data.props && data.props.pageProps) {
              const matchData = this.extractMatchData(data.props.pageProps);
              if (matchData) {
                result = matchData;
                break;
              }
            }
          }
        } catch (error) {}
      }
    }

    return result;
  }

  decodeNextData(encoded) {
    try {
      let decoded = encoded;
      decoded = decoded.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
        return String.fromCharCode(parseInt(hex, 16));
      });
      decoded = decoded.replace(/\\"/g, '"');
      decoded = decoded.replace(/\\'/g, "'");
      decoded = decoded.replace(/\\n/g, '\n');
      decoded = decoded.replace(/\\r/g, '\r');
      decoded = decoded.replace(/\\t/g, '\t');
      return decoded;
    } catch (error) {
      return null;
    }
  }

  extractMatchData(obj) {
    if (!obj || typeof obj !== 'object') return null;

    if (obj.matchInfo) {
      this.stats.matchInfoFound++;
      return obj;
    }

    if (obj.matches && Array.isArray(obj.matches) && obj.matches.length > 0) {
      const firstMatch = obj.matches[0];
      if (firstMatch.matchInfo) {
        this.stats.matchInfoFound++;
        return firstMatch;
      }
      if (firstMatch.match && firstMatch.match.matchInfo) {
        this.stats.matchInfoFound++;
        return firstMatch.match;
      }
    }

    if (obj.currentMatchesList) {
      const typeMatches = obj.currentMatchesList.typeMatches;
      if (typeMatches && Array.isArray(typeMatches)) {
        for (const typeMatch of typeMatches) {
          if (typeMatch.seriesMatches && Array.isArray(typeMatch.seriesMatches)) {
            for (const seriesMatch of typeMatch.seriesMatches) {
              if (seriesMatch.seriesAdWrapper && seriesMatch.seriesAdWrapper.matches) {
                const matches = seriesMatch.seriesAdWrapper.matches;
                if (matches && matches.length > 0) {
                  const firstMatch = matches[0];
                  if (firstMatch.matchInfo) {
                    this.stats.matchInfoFound++;
                    return firstMatch;
                  }
                  if (firstMatch.match && firstMatch.match.matchInfo) {
                    this.stats.matchInfoFound++;
                    return firstMatch.match;
                  }
                }
              }
            }
          }
        }
      }
    }

    const findMatchInfo = (obj) => {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.matchInfo) return obj;
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (value && typeof value === 'object') {
          const result = findMatchInfo(value);
          if (result) return result;
        }
      }
      return null;
    };

    const found = findMatchInfo(obj);
    if (found) {
      this.stats.matchInfoFound++;
      return found;
    }

    return null;
  }

  extractMatchDataFromString(str) {
    try {
      const matchInfoMatch = str.match(/"matchInfo"\s*:\s*\{/);
      if (matchInfoMatch) {
        const startIndex = matchInfoMatch.index;
        let braceCount = 0;
        let endIndex = startIndex;
        for (let i = startIndex; i < str.length; i++) {
          if (str[i] === '{') braceCount++;
          if (str[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              endIndex = i + 1;
              break;
            }
          }
        }
        if (endIndex > startIndex) {
          const matchInfoStr = str.substring(startIndex, endIndex);
          try {
            const parsed = JSON.parse(`{${matchInfoStr}}`);
            if (parsed.matchInfo) {
              this.stats.matchInfoFound++;
              return { matchInfo: parsed.matchInfo };
            }
          } catch (e) {}
        }
      }
    } catch (error) {}
    return null;
  }

  // ============================================================
  // PARSING HELPER FUNCTIONS
  // ============================================================

  monthToNumber(month) {
    const months = {
      jan: '01',
      feb: '02',
      mar: '03',
      apr: '04',
      may: '05',
      jun: '06',
      jul: '07',
      aug: '08',
      sep: '09',
      oct: '10',
      nov: '11',
      dec: '12',
    };
    return months[month.toLowerCase().substring(0, 3)] || '01';
  }

  parseResult(resultText, team1Name, team2Name) {
    const parsed = {
      result: '',
      winningTeam: '',
      margin: '',
      marginType: '',
    };

    if (!resultText) return parsed;

    const wonMatch = resultText.match(/([A-Za-z\s]+)\s+won by\s+(\d+)\s+(wkts|runs|wickets?)/i);
    if (wonMatch) {
      parsed.result = resultText;
      parsed.winningTeam = this.cleanText(wonMatch[1]);
      parsed.margin = wonMatch[2];
      parsed.marginType = wonMatch[3];
      return parsed;
    }

    if (resultText.toLowerCase().includes('tied')) {
      parsed.result = 'Match tied';
      return parsed;
    }

    if (resultText.toLowerCase().includes('no result')) {
      parsed.result = 'No Result';
      return parsed;
    }

    parsed.result = resultText;
    return parsed;
  }

  parseStatus(state) {
    const statusMap = {
      Preview: 'UPCOMING',
      Stumps: 'STUMPS',
      'In Progress': 'LIVE',
      'Innings Break': 'INNINGS_BREAK',
      Complete: 'RESULT',
      Toss: 'UPCOMING',
      Lunch: 'LUNCH',
      Tea: 'TEA',
      Result: 'RESULT',
      Abandoned: 'ABANDONED',
      Rain: 'RAIN_DELAY',
      'Rain Delay': 'RAIN_DELAY',
    };
    return statusMap[state] || state;
  }

  parseStatusFromText(text) {
    if (!text) return '';
    const lower = text.toLowerCase();
    if (lower.includes('stumps')) return 'STUMPS';
    if (lower.includes('lunch')) return 'LUNCH';
    if (lower.includes('tea')) return 'TEA';
    if (lower.includes('innings break')) return 'INNINGS_BREAK';
    if (lower.includes('won by')) return 'RESULT';
    if (lower.includes('live')) return 'LIVE';
    if (lower.includes('upcoming')) return 'UPCOMING';
    if (lower.includes('abandoned')) return 'ABANDONED';
    if (lower.includes('rain')) return 'RAIN_DELAY';
    return 'LIVE';
  }

  parseVenue(venueInfo) {
    const parts = [];
    if (venueInfo.ground) parts.push(venueInfo.ground);
    if (venueInfo.city) parts.push(venueInfo.city);
    if (venueInfo.country && !parts.includes(venueInfo.country)) {
      parts.push(venueInfo.country);
    }
    return parts.join(', ');
  }

  parseFormat(formatCode) {
    const formatMap = {
      TEST: 'Test',
      ODI: 'ODI',
      T20: 'T20I',
      T20I: 'T20I',
      HUN: 'The Hundred',
      FC: 'First Class',
      LA: 'List A',
      T10: 'T10',
    };
    return formatMap[formatCode] || formatCode;
  }

  parseDate(timestamp) {
    try {
      const date = new Date(parseInt(timestamp));
      if (isNaN(date.getTime())) return null;
      return {
        date: date.toISOString().split('T')[0],
        time: date.toISOString().split('T')[1].split('.')[0],
      };
    } catch (error) {
      return null;
    }
  }

  calculateStartsInFromDateTime(dateStr, timeStr) {
    try {
      const dateParts = dateStr.split('-');
      const timeParts = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);

      if (!dateParts || dateParts.length !== 3 || !timeParts) {
        return '';
      }

      let hours = parseInt(timeParts[1]);
      const minutes = parseInt(timeParts[2]);
      const ampm = timeParts[3] ? timeParts[3].toUpperCase() : null;

      if (ampm === 'PM' && hours !== 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;

      const matchDate = new Date(
        parseInt(dateParts[0]),
        parseInt(dateParts[1]) - 1,
        parseInt(dateParts[2]),
        hours,
        minutes
      );

      const now = new Date();
      const diff = matchDate.getTime() - now.getTime();

      if (diff <= 0) return '';

      const hoursRemaining = Math.floor(diff / (1000 * 60 * 60));
      const minutesRemaining = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (hoursRemaining > 0) return `${hoursRemaining}h ${minutesRemaining}m`;
      if (minutesRemaining > 0) return `${minutesRemaining}m`;
      return 'Starts soon';
    } catch (error) {
      return '';
    }
  }

  parseToss(tossData) {
    const result = { winner: '', decision: '' };

    if (typeof tossData === 'string') {
      const winnerMatch = tossData.match(/([A-Za-z\s]+)\s+won the toss/i);
      if (winnerMatch) {
        result.winner = this.cleanText(winnerMatch[1]);
      }
      const decisionMatch = tossData.match(/opted to (bowl|bat|field)/i);
      if (decisionMatch) {
        result.decision = `opted to ${decisionMatch[1]}`;
      }
    } else if (typeof tossData === 'object') {
      result.winner = this.cleanText(tossData.winner || tossData.team || '');
      result.decision = this.cleanText(tossData.decision || '');
    }

    return result;
  }

  parseOfficials(officialsData) {
    const result = { umpires: [], thirdUmpire: '', matchReferee: '' };

    if (officialsData.umpires) {
      if (Array.isArray(officialsData.umpires)) {
        result.umpires = officialsData.umpires.map((u) => this.cleanText(u));
      } else {
        result.umpires = [this.cleanText(officialsData.umpires)];
      }
    }

    if (officialsData.thirdUmpire) {
      result.thirdUmpire = this.cleanText(officialsData.thirdUmpire);
    }

    if (officialsData.matchReferee) {
      result.matchReferee = this.cleanText(officialsData.matchReferee);
    }

    return result;
  }

  calculateStartsIn(timestamp) {
    try {
      const now = Date.now();
      const start = parseInt(timestamp);
      if (start <= now) return '';

      const diff = start - now;
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (hours > 0) return `${hours}h ${minutes}m`;
      if (minutes > 0) return `${minutes}m`;
      return 'Starts soon';
    } catch (error) {
      return '';
    }
  }

  getTeamFlag(imageId) {
    if (!imageId) return '';
    return `https://static.cricbuzz.com/a/img/v1/0x0/i1/${imageId}/team-flag.jpg`;
  }

  getShortName(teamName) {
    if (!teamName) return '';
    const shortNames = {
      Worcestershire: 'WORCS',
      Derbyshire: 'DERBY',
      'London Spirit': 'LDN',
      'Manchester Super Giants': 'MSG',
      'Southern Brave': 'SOU',
      'Welsh Fire': 'WEF',
      'Birmingham Phoenix': 'BIR',
      'Trent Rockets': 'TRE',
      'Oval Invincibles': 'OVAL',
      'Northern Superchargers': 'NOR',
      'Dambulla Sixers': 'DAS',
      'Galle Gallants': 'GAG',
      'Kandy Falcons': 'KFS',
      'Jaffna Kings': 'JKS',
      'Colombo Kaps': 'CLK',
      'Kandy Royals': 'KRL',
      'Lahore Qalandars': 'LQ',
      'Perth Scorchers': 'PS',
      'Perth Scorchers XI': 'PSX',
      'Guyana Amazon Warriors': 'GAW',
      'San Francisco Unicorns': 'SFU',
      Pakistan: 'PAK',
      'West Indies': 'WI',
      'New Zealand': 'NZ',
      Nepal: 'NEP',
      Namibia: 'NAM',
      India: 'IND',
      'Sri Lanka': 'SL',
      England: 'ENG',
      Australia: 'AUS',
      'South Africa': 'SA',
      Bangladesh: 'BAN',
      Afghanistan: 'AFG',
      Zimbabwe: 'ZIM',
      Ireland: 'IRE',
    };

    for (const [full, short] of Object.entries(shortNames)) {
      if (teamName.includes(full)) {
        return short;
      }
    }

    const parts = teamName.split(' ');
    if (parts.length >= 2) {
      return parts
        .map((p) => p[0])
        .join('')
        .toUpperCase();
    }

    return teamName.substring(0, 3).toUpperCase();
  }

  getOrdinalSuffix(n) {
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const value = n % 100;
    return suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0];
  }

  detectCategory(series, title) {
    const combined = `${series} ${title}`.toLowerCase();
    if (combined.includes('women')) return 'Women';
    if (combined.includes('under-19') || combined.includes('u19') || combined.includes('youth'))
      return 'Youth';
    if (
      combined.includes('league') ||
      combined.includes('ipl') ||
      combined.includes('lpl') ||
      combined.includes('the hundred')
    ) {
      return 'League';
    }
    if (combined.includes('domestic') || combined.includes('county') || combined.includes('cup'))
      return 'Domestic';
    if (combined.includes('franchise')) return 'Franchise';
    return 'International';
  }

  detectFormat(series, title, status) {
    const combined = `${series} ${title}`.toLowerCase();
    if (combined.includes('test')) return 'Test';
    if (combined.includes('odi') || combined.includes('one day')) return 'ODI';
    if (combined.includes('t20') || combined.includes('twenty')) return 'T20I';
    if (combined.includes('the hundred')) return 'The Hundred';
    if (combined.includes('first class')) return 'First Class';
    if (combined.includes('list a')) return 'List A';
    if (combined.includes('t10')) return 'T10';
    return 'ODI';
  }

  extractMatchId(url) {
    const patterns = [/\/live-cricket-scores\/(\d+)/, /\/cricket-match\/([a-zA-Z0-9-]+)/];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  cleanText(text) {
    if (!text) return '';
    return text
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[^\x20-\x7E]/g, '')
      .trim();
  }

  validateMatch(match) {
    const reasons = [];

    if (!match.matchId) reasons.push('Missing Match ID');
    if (!match.url) reasons.push('Missing Match URL');
    if (!match.team1.name || match.team1.name.length < 2) {
      reasons.push('Missing Team1 Name');
    }
    if (!match.team2.name || match.team2.name.length < 2) {
      reasons.push('Missing Team2 Name');
    }

    const isCritical =
      !match.matchId ||
      !match.url ||
      !match.team1.name ||
      match.team1.name.length < 2 ||
      !match.team2.name ||
      match.team2.name.length < 2;

    return {
      valid: !isCritical,
      reasons: reasons,
      isCritical: isCritical,
    };
  }

  logExtractedData(match) {
    logger.info(`\n📊 Extracted Data for ${match.matchId}:`);
    logger.info(`  Series: "${match.series}"`);
    logger.info(`  Match Title: "${match.matchTitle}"`);
    logger.info(`  Match Number: "${match.matchNumber}"`);
    logger.info(`  Status: "${match.status}"`);
    logger.info(`  Venue: "${match.venue}"`);
    logger.info(`  Date: "${match.date}"`);
    logger.info(`  Start Time: "${match.startTime}"`);
    logger.info(`  Starts In: "${match.startsIn}"`);
    logger.info(`  Team 1: "${match.team1.name}" (${match.team1.short})`);
    logger.info(`  Team 2: "${match.team2.name}" (${match.team2.short})`);
    logger.info(`  Team 1 Score: "${match.team1.score}"`);
    logger.info(`  Team 2 Score: "${match.team2.score}"`);
    logger.info(`  Team 1 Overs: "${match.team1.overs}"`);
    logger.info(`  Team 2 Overs: "${match.team2.overs}"`);
    logger.info(`  Result: "${match.result}"`);
    logger.info(`  Winning Team: "${match.winningTeam}"`);
    logger.info(`  Margin: ${match.margin} ${match.marginType}`);
    logger.info(`  Toss: ${match.toss.winner} - ${match.toss.decision}`);
    logger.info(`  Player of Match: "${match.playerOfMatch.name}"`);
    logger.info(`  Umpires: ${match.officials.umpires.join(', ')}`);
    logger.info(`  Third Umpire: "${match.officials.thirdUmpire}"`);
    logger.info(`  Match Referee: "${match.officials.matchReferee}"`);
    logger.info(`  Format: "${match.format}"`);
    logger.info(`  Category: "${match.category}"`);
    logger.info(
      `  Innings: Team1=${match.team1.innings.length}, Team2=${match.team2.innings.length}`
    );
  }

  logStatistics() {
    logger.info('\n========================================');
    logger.info('SCRAPING STATISTICS:');
    logger.info(`Downloaded pages: ${this.stats.downloaded}`);
    logger.info(`Parsed pages: ${this.stats.parsed}`);
    logger.info(`Next.js data found: ${this.stats.nextDataFound}`);
    logger.info(`Match Info found: ${this.stats.matchInfoFound}`);
    logger.info(`Teams found: ${this.stats.teamsFound}`);
    logger.info(`Venue found: ${this.stats.venueFound}`);
    logger.info(`Officials found: ${this.stats.officialsFound}`);
    logger.info(`Validation passed: ${this.stats.validationPassed}`);
    logger.info(`Validation failed: ${this.stats.validationFailed}`);
    logger.info(`Returned matches: ${this.stats.returned}`);
    logger.info('========================================\n');
  }

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
