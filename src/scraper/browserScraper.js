// src/scraper/browserScraper.js
const playwright = require('playwright');
const cheerio = require('cheerio');
const crypto = require('crypto');
const logger = require('../logger');

class BrowserScraper {
  constructor() {
    this.browser = null;
    this.context = null;
    this.timeout = 45000;
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  async launch() {
    if (this.browser) {
      return this.browser;
    }

    logger.info('Launching browser for scraping...');

    try {
      this.browser = await playwright.chromium.launch({
        headless: process.env.NODE_ENV === 'production',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-web-security',
        ],
        timeout: this.timeout,
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: this.getRandomUserAgent(),
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        extraHTTPHeaders: {
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
      });

      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
      });

      logger.info('Browser launched successfully');
      return this.browser;
    } catch (error) {
      logger.error('Browser launch failed:', error.message);
      throw error;
    }
  }

  async handleConsentPage(page) {
    logger.info('Attempting to handle consent page...');

    try {
      // Wait for the consent page to load
      await page.waitForTimeout(3000);

      // Try multiple selectors for accept buttons
      const selectors = [
        'button:has-text("Accept")',
        'button:has-text("ACCEPT")',
        'button:has-text("Accept All")',
        'button:has-text("Allow All")',
        'button:has-text("OK")',
        'button:has-text("I Agree")',
        'button:has-text("Continue")',
        'button:has-text("Got It")',
        '#onetrust-accept-btn-handler',
        '#accept-cookies',
        '.accept-btn',
        '.cookie-accept',
        '.btn-primary',
        '[aria-label="Accept"]',
        '[aria-label*="accept"]',
        'button[class*="accept"]',
        'button[class*="cookie"]',
      ];

      let accepted = false;

      // Try clicking buttons
      for (const selector of selectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            await element.click();
            logger.info(`✅ Clicked accept button: ${selector}`);
            accepted = true;
            await page.waitForTimeout(2000);
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      // If no button found, try JavaScript evaluation
      if (!accepted) {
        logger.info('No accept button found, trying JavaScript...');
        accepted = await page.evaluate(() => {
          // Try to find any button with accept-related text
          const buttons = document.querySelectorAll(
            'button, [role="button"], .btn, [class*="button"]'
          );
          for (const btn of buttons) {
            const text = (btn.textContent || '').toLowerCase();
            if (
              text.includes('accept') ||
              text.includes('allow') ||
              text.includes('ok') ||
              text.includes('agree') ||
              text.includes('continue') ||
              text.includes('got it')
            ) {
              btn.click();
              return true;
            }
          }
          return false;
        });

        if (accepted) {
          logger.info('✅ Clicked accept button via JavaScript');
          await page.waitForTimeout(2000);
        }
      }

      // Try to set cookies directly
      if (!accepted) {
        logger.info('Trying to set cookies directly...');
        await page.evaluate(() => {
          document.cookie = 'cookieconsent_status=allow; path=/';
          document.cookie = 'euconsent-v2=CPSEtL5PSEtL5AcABBENB5CsAP_AAH_AAAY; path=/';
          document.cookie =
            'SOCS=CAISNQgBEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjUwMjA1LjA4X3ABGgJlbg; path=/';
          document.cookie = 'CONSENT=YES+CB.en+20250601-15-0; path=/';
        });
        await page.waitForTimeout(1000);
      }

      // Reload the page
      logger.info('Reloading page after consent handling...');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      return true;
    } catch (error) {
      logger.error('Error handling consent page:', error.message);
      return false;
    }
  }

  async scrapeUrl(url, type) {
    try {
      await this.launch();

      const page = await this.context.newPage();
      page.setDefaultTimeout(this.timeout);

      logger.info(`Navigating to: ${url}`);

      // Navigate to the page
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      });

      // Wait for page to settle
      await page.waitForTimeout(3000);

      // Check if we're on a consent page
      let pageContent = await page.content();
      let $ = cheerio.load(pageContent);
      let bodyText = $('body').text();

      // Handle consent if detected
      if (
        bodyText.includes('Privacy Preference Center') ||
        bodyText.includes('cookie') ||
        bodyText.includes('Cookie Settings')
      ) {
        logger.info('Consent page detected, handling...');

        // Try to handle consent
        await this.handleConsentPage(page);

        // Get the updated page content
        pageContent = await page.content();
        $ = cheerio.load(pageContent);
        bodyText = $('body').text();

        // Check if consent is still there
        if (bodyText.includes('Privacy Preference Center') || bodyText.includes('cookie')) {
          logger.warn('Still on consent page after handling, trying one more time...');

          // Try handling again with more aggressive approach
          await page.waitForTimeout(5000);

          // Try to close any overlays
          await page.evaluate(() => {
            // Try to close overlays
            const overlays = document.querySelectorAll(
              '[class*="overlay"], [class*="modal"], [class*="popup"]'
            );
            for (const overlay of overlays) {
              const closeBtn = overlay.querySelector(
                '[class*="close"], [class*="dismiss"], [aria-label*="close"]'
              );
              if (closeBtn) {
                closeBtn.click();
              }
            }
          });

          await page.waitForTimeout(2000);

          // Try clicking accept again with different approach
          try {
            await page.click(
              'button:has-text("Accept"), button:has-text("ACCEPT"), button:has-text("OK")',
              { timeout: 5000 }
            );
            await page.waitForTimeout(2000);
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(3000);
          } catch (e) {}

          // Get final content
          pageContent = await page.content();
          $ = cheerio.load(pageContent);
          bodyText = $('body').text();
        }

        // If still on consent page, we need to try a different approach
        if (bodyText.includes('Privacy Preference Center') || bodyText.includes('cookie')) {
          logger.warn(
            'Still on consent page after all attempts, trying to extract from consent page anyway...'
          );

          // Sometimes the consent page has match data hidden behind it
          // Try to find any match-related content
          const matches = this.extractMatches($, type);
          if (matches && matches.length > 0) {
            const validatedMatches = this.validateAndCleanMatches(matches);
            logger.info(
              `✅ Found ${validatedMatches.length} valid ${type} matches on consent page`
            );
            await page.close();
            return {
              source: 'browser',
              matches: validatedMatches,
              total: validatedMatches.length,
              timestamp: new Date().toISOString(),
            };
          }

          await page.close();
          return {
            source: 'browser',
            matches: [],
            total: 0,
            timestamp: new Date().toISOString(),
            error: 'Consent page could not be bypassed',
          };
        }
      }

      // Extract matches from the page
      const matches = this.extractMatches($, type);

      await page.close();

      if (matches && matches.length > 0) {
        const validatedMatches = this.validateAndCleanMatches(matches);
        logger.info(`✅ Found ${validatedMatches.length} valid ${type} matches`);
        return {
          source: 'browser',
          matches: validatedMatches,
          total: validatedMatches.length,
          timestamp: new Date().toISOString(),
        };
      }

      logger.warn(`No ${type} matches found`);
      return {
        source: 'browser',
        matches: [],
        total: 0,
        timestamp: new Date().toISOString(),
        error: 'No matches found',
      };
    } catch (error) {
      logger.error(`Browser scraping failed for ${url}:`, error.message);
      return {
        source: 'browser',
        matches: [],
        total: 0,
        timestamp: new Date().toISOString(),
        error: error.message,
      };
    }
  }

  async scrapeLive() {
    return this.scrapeUrl('https://www.espncricinfo.com/live-cricket-score', 'live');
  }

  async scrapeFixtures() {
    return this.scrapeUrl('https://www.espncricinfo.com/matches', 'fixtures');
  }

  async scrapeResults() {
    return this.scrapeUrl('https://www.espncricinfo.com/results', 'results');
  }

  extractMatches($, type) {
    try {
      const matches = [];
      const processedCards = new Set();

      const allDivs = $('div');

      for (let i = 0; i < allDivs.length; i++) {
        const el = allDivs[i];
        const $el = $(el);
        const html = $el.html();
        if (!html || processedCards.has(html)) continue;

        const text = $el.text();
        if (!text || text.length < 20 || text.length > 3000) continue;

        const hasStatus = /LIVE|UPCOMING|RESULT|Stumps|Innings Break/i.test(text);
        const hasTeams = /[A-Z]{2,4}\s+(?:vs|v)\s+[A-Z]{2,4}/i.test(text);
        const hasScore = /\d{1,3}\/\d{1,2}/.test(text);
        const hasOvers = /\((\d+\.?\d*)\s*(?:ov|overs?)\)/.test(text);
        const hasDate = /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(text);
        const hasTime = /\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)/.test(text);

        let indicators = 0;
        if (hasStatus) indicators++;
        if (hasTeams) indicators++;
        if (hasScore) indicators++;
        if (hasOvers) indicators++;
        if (hasDate) indicators++;
        if (hasTime) indicators++;

        const isNav =
          $el.closest('nav').length > 0 ||
          $el.closest('header').length > 0 ||
          $el.closest('footer').length > 0 ||
          $el.closest('aside').length > 0;

        let minIndicators = 2;
        if (type === 'fixtures') minIndicators = 1;

        if (indicators >= minIndicators && !isNav) {
          processedCards.add(html);
          const matchData = this.extractMatchData($el, type);
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

  extractMatchData($card, type) {
    try {
      const text = $card.text();
      if (!text || text.length < 10) return null;

      const status = this.extractStatus(text, type);
      const url = this.extractMatchUrl($card);
      const matchId = url ? this.hashUrl(url) : null;
      const series = this.extractSeries($card, text);
      const teams = this.extractTeams($card, text);

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
        matchId: matchId || '',
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

  hashUrl(url) {
    return crypto.createHash('md5').update(url).digest('hex').substring(0, 16);
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

  extractMatchUrl($card) {
    const selectors = [
      'a[href*="/match/"]',
      'a[href*="/cricket-match/"]',
      'a[href*="/live-cricket-score/"]',
    ];

    for (const selector of selectors) {
      try {
        const link = $card.find(selector).first();
        if (link && link.length) {
          const href = link.attr('href');
          if (href) {
            if (href.startsWith('/')) {
              return `https://www.espncricinfo.com${href}`;
            }
            return href;
          }
        }
      } catch (e) {}
    }

    return '';
  }

  extractSeries($card, text) {
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

  extractTeams($card, text) {
    const result = {
      team1: '',
      team1Short: '',
      team2: '',
      team2Short: '',
    };

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
        return result;
      } else if (unique.length === 1) {
        result.team1 = unique[0];
        return result;
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
        return result;
      } else if (unique.length === 1) {
        result.team1 = unique[0];
        return result;
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
      if (text.includes(tab)) {
        tabs.push(tab);
      }
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
        match.matchId = match.url ? this.hashUrl(match.url) : null;
        if (!match.matchId) continue;
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

    return validated;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      logger.info('Browser closed');
    }
  }
}

module.exports = BrowserScraper;