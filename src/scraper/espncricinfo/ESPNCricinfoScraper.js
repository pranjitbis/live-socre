// src/scraper/espncricinfo/ESPNCricinfoScraper.js
const cheerio = require('cheerio');
const axios = require('axios');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const { chromium } = require('playwright');
const BaseScraper = require('../base/BaseScraper');
const config = require('../../config');
const logger = require('../../logger');
const proxyManager = require('../../config/proxyManager');

class ESPNCricinfoScraper extends BaseScraper {
  constructor() {
    super(config.sources.espncricinfo);
    this.baseUrl = 'https://www.espncricinfo.com';
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0',
      'Connection': 'keep-alive',
    };
    this.cookieJar = null;
    this.maxMatches = 20;
    this.requestDelay = 3000;
    this.debugDir = path.join(process.cwd(), 'debug');
    this.usePlaywright = true;
    this.sessionCookie = null;
    this.proxyManager = proxyManager;
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    ];
    this.userAgentIndex = 0;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getNextUserAgent() {
    const ua = this.userAgents[this.userAgentIndex % this.userAgents.length];
    this.userAgentIndex++;
    return ua;
  }

  // ============================================================
  // CHECK IF PAGE IS 404
  // ============================================================
  is404Page(html) {
    const indicators = [
      'page does not exist',
      'something went wrong',
      '404 Not Found',
      'Oops… looks like something went wrong'
    ];
    
    const lowerHtml = html.toLowerCase();
    for (const indicator of indicators) {
      if (lowerHtml.includes(indicator.toLowerCase())) {
        return true;
      }
    }
    
    const hasNav = html.includes('Live Scores') || html.includes('Series');
    const hasMatchContent = html.includes('ci-team-score') || 
                           html.includes('scoreboard') || 
                           html.includes('matchInfo');
    
    if (hasNav && !hasMatchContent && html.length < 50000) {
      return true;
    }
    
    return false;
  }

  // ============================================================
  // CHECK IF PAGE IS ACCESS DENIED
  // ============================================================
  isAccessDenied(html) {
    return html.includes('Access Denied') || html.includes('access denied');
  }

  // ============================================================
  // FETCH PAGE WITH PLAYWRIGHT
  // ============================================================
  async fetchPageWithPlaywright(url, retries = 3) {
    let browser = null;
    let context = null;
    let page = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const proxy = this.proxyManager.getProxy();
        const userAgent = this.getNextUserAgent();
        
        logger.info(`🌐 Launching Playwright for: ${url} (attempt ${attempt}/${retries})`);
        if (proxy) {
          logger.info(`  Using proxy: ${proxy.host}:${proxy.port}`);
        }
        logger.info(`  User-Agent: ${userAgent.substring(0, 50)}...`);
        
        const proxyConfig = proxy ? {
          server: `http://${proxy.host}:${proxy.port}`
        } : undefined;

        browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-web-security',
            '--disable-features=BlockInsecurePrivateNetworkRequests',
            '--window-size=1920,1080',
          ]
        });

        context = await browser.newContext({
          userAgent: userAgent,
          viewport: { width: 1920, height: 1080 },
          proxy: proxyConfig,
          extraHTTPHeaders: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'max-age=0',
            'Connection': 'keep-alive',
          }
        });

        page = await context.newPage();

        // Only add valid cookies
        if (this.sessionCookie && typeof this.sessionCookie === 'string' && this.sessionCookie.includes('=')) {
          try {
            const cookiePairs = this.sessionCookie.split('; ');
            const validCookies = [];
            
            for (const pair of cookiePairs) {
              const [name, value] = pair.split('=');
              if (name && value && name.length > 0 && value.length > 0) {
                validCookies.push({
                  name: name.trim(),
                  value: value.trim(),
                  domain: '.espncricinfo.com',
                  path: '/',
                  httpOnly: false,
                  secure: false,
                  sameSite: 'Lax'
                });
              }
            }
            
            if (validCookies.length > 0) {
              await context.addCookies(validCookies);
            }
          } catch (cookieError) {
            logger.warn(`⚠️ Failed to add cookies: ${cookieError.message}`);
          }
        }

        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });

        const status = response ? response.status() : 0;
        const finalUrl = page.url();
        
        logger.info(`📄 Playwright response status: ${status}`);
        logger.info(`📍 Final URL: ${finalUrl}`);

        // Handle 404
        if (status === 404) {
          logger.error(`❌ Page returned 404 - match does not exist`);
          const html = await page.content();
          await this.saveDebugData('404_page', html, this.extractMatchId(url));
          return { html: null, error: '404_NOT_FOUND' };
        }

        // Handle 403
        if (status === 403) {
          logger.warn(`⚠️ Received 403, trying to bypass...`);
          await page.waitForTimeout(3000);
          
          try {
            const acceptButtons = await page.$$('button:has-text("Accept"), button:has-text("Allow"), button:has-text("Agree")');
            for (const btn of acceptButtons) {
              await btn.click();
              await page.waitForTimeout(1000);
            }
          } catch (e) {}

          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(2000);
        }

        // Wait for match content
        await this.waitForMatchContent(page);

        const html = await page.content();
        const contentLength = html.length;
        logger.info(`📊 HTML size: ${contentLength} characters`);

        // Check if it's a 404 page
        if (this.is404Page(html)) {
          logger.error(`❌ 404 page detected - match not found`);
          await this.saveDebugData('404_page', html, this.extractMatchId(url));
          return { html: null, error: '404_NOT_FOUND' };
        }

        // Check for Access Denied
        if (this.isAccessDenied(html)) {
          logger.error(`❌ Access Denied page detected`);
          await this.saveDebugData('access_denied', html, this.extractMatchId(url));
          return { html: null, error: 'ACCESS_DENIED' };
        }

        // Save cookies
        try {
          const cookies = await context.cookies();
          if (cookies && cookies.length > 0) {
            this.sessionCookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
          }
        } catch (cookieError) {
          logger.warn(`⚠️ Failed to save cookies: ${cookieError.message}`);
        }

        await this.logHtmlPreview(html, url);

        // Verify page content
        const verification = this.verifyPageContent(html);
        
        if (!verification.isValid) {
          logger.error(`❌ Page verification failed: ${verification.reason}`);
          await this.saveDebugData('invalid_page', html, this.extractMatchId(url));
          
          if (attempt < retries) {
            logger.info(`🔄 Retrying...`);
            continue;
          }
          return { html: null, error: 'INVALID_CONTENT' };
        }

        logger.info(`✅ Page verification passed: ${verification.reason}`);
        await this.saveDebugData('raw_match_page', html, this.extractMatchId(url));

        return { html, error: null };

      } catch (error) {
        logger.error(`❌ Playwright fetch failed (attempt ${attempt}): ${error.message}`);
        if (attempt < retries) {
          await this.sleep(5000 * attempt);
        }
      } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
      }
    }

    logger.error(`❌ All Playwright attempts failed for: ${url}`);
    return { html: null, error: 'ALL_ATTEMPTS_FAILED' };
  }

  async waitForMatchContent(page) {
    try {
      const selectors = [
        '.ci-team-score',
        '.scoreboard',
        '.match-header',
        '.ds-flex-col.ds-gap-4',
        '.match-details',
        '.scorecard-details',
        '.ci-scorecard'
      ];

      for (const selector of selectors) {
        try {
          await page.waitForSelector(selector, { timeout: 8000 });
          logger.info(`✅ Found match content: ${selector}`);
          return true;
        } catch (e) {}
      }

      const content = await page.content();
      if (content.length > 5000 && !content.includes('Access Denied') && !content.includes('page does not exist')) {
        logger.info(`✅ Page has content (${content.length} chars), proceeding...`);
        return true;
      }

      return false;
    } catch (error) {
      logger.warn(`⚠️ Waiting for match content failed: ${error.message}`);
      return false;
    }
  }

  // ============================================================
  // FETCH PAGE WITH AXIOS
  // ============================================================
  async fetchPageWithAxios(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const proxy = this.proxyManager.getProxy();
        const userAgent = this.getNextUserAgent();
        
        logger.info(`🌐 Fetching with Axios (attempt ${attempt}/${retries}): ${url}`);
        if (proxy) {
          logger.info(`  Using proxy: ${proxy.host}:${proxy.port}`);
        }
        
        const proxyConfig = proxy ? {
          host: proxy.host,
          port: proxy.port,
          protocol: 'http'
        } : undefined;

        const response = await axios.get(url, {
          headers: {
            ...this.headers,
            'User-Agent': userAgent,
            'Cookie': this.sessionCookie || this.cookieJar || '',
          },
          timeout: 30000,
          maxRedirects: 5,
          validateStatus: (status) => status < 500,
          httpsAgent: new https.Agent({
            rejectUnauthorized: false,
          }),
          proxy: proxyConfig,
        });

        const status = response.status;
        logger.info(`📄 Axios response status: ${status}`);

        if (status === 404) {
          logger.error(`❌ Page returned 404 - match does not exist`);
          return { html: null, error: '404_NOT_FOUND' };
        }

        if (status === 403) {
          logger.warn(`⚠️ Received 403 with Axios, trying Playwright fallback`);
          const result = await this.fetchPageWithPlaywright(url, 1);
          if (result.html) {
            return result;
          }
          if (attempt < retries) {
            continue;
          }
          return { html: null, error: 'ACCESS_DENIED' };
        }

        const html = response.data;
        
        if (this.is404Page(html)) {
          logger.error(`❌ 404 page detected`);
          return { html: null, error: '404_NOT_FOUND' };
        }

        if (this.isAccessDenied(html)) {
          logger.warn(`⚠️ Access Denied, trying Playwright`);
          const result = await this.fetchPageWithPlaywright(url, 1);
          if (result.html) {
            return result;
          }
          return { html: null, error: 'ACCESS_DENIED' };
        }

        return { html, error: null };

      } catch (error) {
        logger.warn(`Axios attempt ${attempt}/${retries} failed: ${error.message}`);
        if (attempt < retries) {
          await this.sleep(3000 * attempt);
        } else {
          return { html: null, error: error.message };
        }
      }
    }
    
    return { html: null, error: 'ALL_ATTEMPTS_FAILED' };
  }

  // ============================================================
  // FETCH PAGE - MAIN METHOD
  // ============================================================
  async fetchPage(url, retries = 3, forceAxios = false) {
    if (this.usePlaywright && !forceAxios && url.includes('/live-cricket-score')) {
      logger.info(`🌐 Using Playwright for match page: ${url}`);
      const result = await this.fetchPageWithPlaywright(url, retries);
      if (result.html && !result.error) {
        return result.html;
      }
      logger.warn(`⚠️ Playwright returned error: ${result.error}, falling back to Axios`);
    }

    const result = await this.fetchPageWithAxios(url, retries);
    if (result.html && !result.error) {
      return result.html;
    }
    
    logger.error(`❌ All fetch methods failed for: ${url}`);
    return null;
  }

  // ============================================================
  // LOG HTML PREVIEW
  // ============================================================
  async logHtmlPreview(html, url) {
    const preview = html.substring(0, 2000);
    
    logger.info('📄 HTML PREVIEW (first 2000 chars):');
    logger.info('--- START HTML PREVIEW ---');
    
    const doctypeMatch = preview.match(/<!DOCTYPE[^>]*>/i);
    if (doctypeMatch) logger.info(`DOCTYPE: ${doctypeMatch[0]}`);
    
    const titleMatch = preview.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) {
      logger.info(`Title: ${titleMatch[1]}`);
      if (titleMatch[1].includes('Access Denied')) {
        logger.error('⚠️ ACCESS DENIED DETECTED');
      }
      if (titleMatch[1].includes('something went wrong')) {
        logger.error('⚠️ 404 PAGE DETECTED');
      }
    }
    
    const indicators = [
      'ci-team-score',
      'scoreboard',
      'matchInfo',
      'playerOfMatch',
      'team1',
      'team2',
      'series',
      'match-details',
      '__NEXT_DATA__'
    ];

    logger.info('🔍 Key indicators found:');
    for (const indicator of indicators) {
      const found = preview.includes(indicator);
      logger.info(`  ${indicator}: ${found ? '✅' : '❌'}`);
    }

    logger.info('--- END HTML PREVIEW ---');
  }

  // ============================================================
  // VERIFY PAGE CONTENT
  // ============================================================
  verifyPageContent(html) {
    if (this.is404Page(html)) {
      return { isValid: false, reason: '404 page detected' };
    }

    if (this.isAccessDenied(html)) {
      return { isValid: false, reason: 'Access Denied' };
    }

    const hasTeamScore = html.includes('ci-team-score');
    const hasScoreboard = html.includes('scoreboard') || html.includes('scorecard');
    const hasMatchInfo = html.includes('matchInfo') || html.includes('match');
    const hasMatchDetails = html.includes('match-details') || html.includes('match-header');
    const hasNextData = html.includes('__NEXT_DATA__');
    const hasTeam1 = html.includes('"team1"') || html.includes('team1');
    const hasTeam2 = html.includes('"team2"') || html.includes('team2');
    
    if (hasTeamScore || hasScoreboard || hasMatchInfo || hasMatchDetails || hasNextData || hasTeam1 || hasTeam2) {
      return { isValid: true, reason: 'Match content found' };
    }
    
    if (html.length > 10000 && !html.includes('page does not exist')) {
      return { isValid: true, reason: 'Page has substantial content' };
    }
    
    return { isValid: false, reason: 'No match content detected' };
  }

  async saveDebugData(type, data, matchId = null) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const prefix = matchId ? `${matchId}_` : '';
      const filename = `ESPNCricinfo_${prefix}${type}_${timestamp}.html`;
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
    const url = 'https://www.espncricinfo.com/live-cricket-score';
    logger.info(`Stage 1: Discovering matches from ${url}`);

    try {
      const html = await this.fetchPage(url, 3, true);
      
      if (!html || this.is404Page(html)) {
        logger.error('❌ Failed to get listing page');
        return [];
      }
      
      await this.saveDebugData('listing_page', html);

      const $ = cheerio.load(html);
      const uniqueMatches = new Map();

      const matchAnchors = $('a[href*="/series/"]');
      logger.info(`Found ${matchAnchors.length} potential match anchors`);

      for (const anchor of matchAnchors) {
        const $anchor = $(anchor);
        const href = $anchor.attr('href');
        if (!href) continue;
        if (!this.isValidMatchUrl(href)) continue;

        const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
        const matchId = this.extractMatchId(fullUrl);
        if (!matchId) continue;
        
        if (uniqueMatches.has(matchId)) continue;

        const container = $anchor.closest(
          '.match-card, .ds-border-b, .ds-flex-col, .ds-p-4, .ds-mb-4, .ds-justify-between, .ds-flex'
        );

        const matchData = {
          matchId: matchId,
          url: fullUrl,
          seriesSlug: this.extractSeriesSlug(fullUrl),
          matchSlug: this.extractMatchSlug(fullUrl),
          matchTitle: '',
          series: '',
          team1: { name: '', shortName: '', logo: '', innings: [] },
          team2: { name: '', shortName: '', logo: '', innings: [] },
          status: '',
          venue: '',
          date: '',
          startTime: '',
          result: '',
          winningTeam: '',
          margin: '',
          marginType: '',
          commentary: `${this.baseUrl}/match/${matchId}/commentary`,
          scorecard: `${this.baseUrl}/match/${matchId}/scorecard`,
          preview: `${this.baseUrl}/match/${matchId}/preview`,
          squads: `${this.baseUrl}/match/${matchId}/squads`,
          statistics: `${this.baseUrl}/match/${matchId}/stats`,
          source: 'espncricinfo',
          scrapedAt: new Date().toISOString(),
        };

        if (container.length > 0) {
          const seriesElement = container.find(
            '.series, .ds-text-tight-xs, .ds-text-compact-s, .match-title'
          );
          if (seriesElement.length > 0) {
            matchData.series = this.cleanText(seriesElement.first().text());
          }

          const teamElements = container.find(
            '.team, .ds-flex-col .ds-text-tight-s, .ds-flex .ds-items-center'
          );
          let teamIndex = 0;
          for (const teamEl of teamElements) {
            const $team = $(teamEl);
            const teamText = this.cleanText($team.text());
            const teamMatch = teamText.match(/([A-Za-z\s]+)\s+(\d+)\/?(\d*)/);
            if (teamMatch) {
              const name = this.cleanText(teamMatch[1]);
              const runs = teamMatch[2];
              const wickets = teamMatch[3] || '';
              const logo = $team.find('img').attr('src') || '';

              const teamData = {
                name: name || 'Team ' + (teamIndex + 1),
                shortName: this.getShortName(name),
                logo: logo,
                innings: [
                  {
                    runs: runs || '',
                    wickets: wickets || '',
                    overs: '',
                    declared: false,
                  },
                ],
              };

              if (teamIndex === 0) {
                matchData.team1 = teamData;
                teamIndex++;
              } else if (teamIndex === 1) {
                matchData.team2 = teamData;
                teamIndex++;
              }
            }
          }

          const statusElement = container.find('.status, .ds-text-compact-s, .ds-text-center');
          if (statusElement.length > 0) {
            matchData.status = this.parseStatus(statusElement.first().text());
          }
        }

        if (matchData.team1.name && matchData.team2.name) {
          matchData.matchTitle = `${matchData.team1.name} vs ${matchData.team2.name}`;
        }

        uniqueMatches.set(matchId, matchData);
      }

      const matches = Array.from(uniqueMatches.values());
      logger.info(`Discovered ${matches.length} unique matches`);

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
        logger.info(`Processing match ${i + 1}/${matches.length}: ${match.matchId}`);
        logger.info(`  URL: ${match.url}`);

        if (i > 0) {
          await this.sleep(this.requestDelay);
        }

        const detailedMatch = await this.scrapeMatchPage(match);

        if (detailedMatch) {
          detailedMatches.push(detailedMatch);
          logger.info(`✅ Successfully processed match ${match.matchId}`);
          logger.info(`  Title: ${detailedMatch.matchTitle || 'Unknown'}`);
          logger.info(
            `  Teams: ${detailedMatch.team1?.name || 'N/A'} vs ${detailedMatch.team2?.name || 'N/A'}`
          );
          logger.info(`  Series: ${detailedMatch.series || 'N/A'}`);
          logger.info(`  Venue: ${detailedMatch.venue || 'N/A'}`);
          logger.info(`  Status: ${detailedMatch.status || 'N/A'}`);
        }
      } catch (error) {
        logger.error(`Error processing match ${match.matchId}:`, error.message);
      }
    }

    logger.info(`Successfully processed ${detailedMatches.length} matches`);
    return detailedMatches;
  }

  // ============================================================
  // SCRAPE MATCH PAGE
  // ============================================================
  async scrapeMatchPage(match) {
    try {
      const html = await this.fetchPage(match.url);
      
      if (!html) {
        logger.error(`❌ Failed to fetch match page: ${match.matchId} (no HTML returned)`);
        return this.buildMatchFromURL(match);
      }
      
      // Check for 404
      if (this.is404Page(html)) {
        logger.error(`❌ 404 page returned for match ${match.matchId} - match does not exist`);
        await this.saveDebugData('404_detected', html, match.matchId);
        return this.buildMatchFromURL(match);
      }
      
      if (this.isAccessDenied(html)) {
        logger.error(`❌ Access Denied for match ${match.matchId}`);
        return this.buildMatchFromURL(match);
      }
      
      await this.saveDebugData(`match_${match.matchId}`, html, match.matchId);

      const $ = cheerio.load(html);

      // Try JSON-LD first
      const jsonData = this.extractMatchJSON($, html);
      
      if (jsonData) {
        logger.info(`✅ JSON data found for match ${match.matchId}`);
        const jsonResult = this.buildMatchFromJSON(jsonData, match);
        
        if (jsonResult.team1.name && jsonResult.team2.name && jsonResult.series) {
          logger.info(`✅ JSON data complete, returning`);
          return jsonResult;
        } else {
          logger.info(`⚠️ JSON data incomplete, falling back to HTML`);
        }
      }

      // HTML parsing - ENHANCED
      logger.info(`ℹ️ Parsing HTML for match ${match.matchId}`);
      const htmlResult = this.buildMatchFromHTML($, match);
      
      // Validate the result
      if (htmlResult && htmlResult.team1.name && htmlResult.team2.name) {
        logger.info(`✅ HTML parsing successful`);
        return htmlResult;
      }

      // URL fallback
      logger.warn(`⚠️ HTML parsing failed, using URL fallback for ${match.matchId}`);
      return this.buildMatchFromURL(match);

    } catch (error) {
      logger.error(`Error scraping match page ${match.matchId}:`, error.message);
      return this.buildMatchFromURL(match);
    }
  }

  // ============================================================
  // EXTRACT MATCH JSON
  // ============================================================
  extractMatchJSON($, html) {
    try {
      const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      if (jsonLdMatch) {
        try {
          const data = JSON.parse(jsonLdMatch[1]);
          if (data && data.mainEntity) {
            logger.info('✅ Found JSON-LD mainEntity');
            return data.mainEntity;
          }
          if (data && data.sportsEvent) {
            logger.info('✅ Found JSON-LD sportsEvent');
            return data.sportsEvent;
          }
        } catch (e) {
          logger.debug('JSON-LD parsing failed');
        }
      }

      const nextDataMatch = html.match(/__NEXT_DATA__\s*=\s*({.*?});/s);
      if (nextDataMatch) {
        try {
          const data = JSON.parse(nextDataMatch[1]);
          if (data?.props?.pageProps?.match) {
            logger.info('✅ Found __NEXT_DATA__ match');
            return data.props.pageProps.match;
          }
          if (data?.props?.pageProps?.matchData) {
            logger.info('✅ Found __NEXT_DATA__ matchData');
            return data.props.pageProps.matchData;
          }
        } catch (e) {
          logger.debug('__NEXT_DATA__ parsing failed');
        }
      }

      logger.warn('❌ No usable JSON found');
      return null;
    } catch (error) {
      logger.error(`Error extracting JSON: ${error.message}`);
      return null;
    }
  }

  // ============================================================
  // BUILD MATCH FROM JSON
  // ============================================================
  buildMatchFromJSON(jsonData, match) {
    logger.info('Building match from JSON data...');
    
    const result = {
      matchId: match.matchId,
      url: match.url,
      matchTitle: '',
      series: '',
      matchNumber: '',
      format: '',
      status: '',
      venue: '',
      date: '',
      startTime: '',
      result: '',
      winningTeam: '',
      margin: '',
      marginType: '',
      playerOfMatch: { name: '', image: '', profileUrl: '' },
      toss: { winner: '', decision: '' },
      officials: { umpires: [], thirdUmpire: '', matchReferee: '' },
      team1: { name: '', shortName: '', logo: '', innings: [] },
      team2: { name: '', shortName: '', logo: '', innings: [] },
      commentary: match.commentary,
      scorecard: match.scorecard,
      preview: match.preview,
      squads: match.squads,
      statistics: match.statistics,
      source: 'espncricinfo',
      scrapedAt: new Date().toISOString(),
    };

    const info = jsonData.matchInfo || jsonData.match || jsonData;

    if (info.seriesName) result.series = this.cleanText(info.seriesName);
    else if (info.series) result.series = this.cleanText(info.series);

    if (info.matchTitle) result.matchTitle = this.cleanText(info.matchTitle);

    if (info.matchDesc) result.matchNumber = this.cleanText(info.matchDesc);
    else if (info.matchNumber) result.matchNumber = this.cleanText(info.matchNumber);

    if (info.matchFormat) {
      const formatMap = {
        TEST: 'Test',
        ODI: 'ODI',
        T20: 'T20I',
        T20I: 'T20I',
        HUN: 'The Hundred',
        FC: 'First Class',
        LA: 'List A',
      };
      result.format = formatMap[info.matchFormat] || info.matchFormat;
    }

    if (info.venueInfo) {
      const parts = [];
      if (info.venueInfo.ground) parts.push(info.venueInfo.ground);
      if (info.venueInfo.city) parts.push(info.venueInfo.city);
      if (info.venueInfo.country) parts.push(info.venueInfo.country);
      result.venue = parts.join(', ');
    } else if (info.venue) {
      result.venue = this.cleanText(info.venue);
    }

    if (info.status) {
      const statusText = this.cleanText(info.status);
      result.status = this.parseStatus(statusText);
      result.result = statusText;
    } else if (info.state) {
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
        Rain: 'RAIN',
      };
      result.status = statusMap[info.state] || info.state;
    }

    if (info.startDate) {
      const date = new Date(parseInt(info.startDate));
      if (!isNaN(date.getTime())) {
        result.date = date.toISOString().split('T')[0];
        result.startTime = date.toISOString().split('T')[1].split('.')[0];
      }
    }

    if (info.team1) {
      result.team1.name = info.team1.teamName || info.team1.name || '';
      result.team1.shortName = info.team1.teamSName || info.team1.shortName || this.getShortName(result.team1.name);
      result.team1.logo = info.team1.logo || '';
      
      if (info.team1.innings) {
        result.team1.innings = this.parseInningsFromJSON(info.team1.innings);
      }
    }
    
    if (info.team2) {
      result.team2.name = info.team2.teamName || info.team2.name || '';
      result.team2.shortName = info.team2.teamSName || info.team2.shortName || this.getShortName(result.team2.name);
      result.team2.logo = info.team2.logo || '';
      
      if (info.team2.innings) {
        result.team2.innings = this.parseInningsFromJSON(info.team2.innings);
      }
    }

    if (info.toss) {
      if (typeof info.toss === 'string') {
        const winnerMatch = info.toss.match(/([A-Za-z\s]+)\s+won the toss/i);
        if (winnerMatch) result.toss.winner = this.cleanText(winnerMatch[1]);
        const decisionMatch = info.toss.match(/opted to (bowl|bat|field)/i);
        if (decisionMatch) result.toss.decision = `opted to ${decisionMatch[1]}`;
      } else if (typeof info.toss === 'object') {
        result.toss.winner = info.toss.winner || info.toss.team || '';
        result.toss.decision = info.toss.decision || '';
      }
    }

    if (info.pom) {
      result.playerOfMatch.name = this.cleanText(info.pom);
    } else if (info.playerOfMatch) {
      result.playerOfMatch.name = this.cleanText(info.playerOfMatch);
    }

    if (info.officials) {
      if (info.officials.umpires) {
        result.officials.umpires = Array.isArray(info.officials.umpires)
          ? info.officials.umpires.map((u) => this.cleanText(u))
          : [this.cleanText(info.officials.umpires)];
      }
      if (info.officials.thirdUmpire) {
        result.officials.thirdUmpire = this.cleanText(info.officials.thirdUmpire);
      }
      if (info.officials.matchReferee) {
        result.officials.matchReferee = this.cleanText(info.officials.matchReferee);
      }
    }

    if (!result.matchTitle && result.team1.name && result.team2.name) {
      result.matchTitle = `${result.team1.name} vs ${result.team2.name}`;
    }

    return result;
  }

  parseInningsFromJSON(inningsData) {
    if (!Array.isArray(inningsData)) {
      inningsData = [inningsData];
    }
    
    return inningsData.map(inn => ({
      runs: inn.runs || inn.total || '',
      wickets: inn.wickets || inn.fallen || '',
      overs: inn.overs || '',
      declared: inn.declared || false,
      followOn: inn.followOn || false
    }));
  }

  // ============================================================
  // BUILD MATCH FROM HTML - ENHANCED WITH COMPREHENSIVE EXTRACTION
  // ============================================================
  buildMatchFromHTML($, match) {
    logger.info(`Building match from HTML for ${match.matchId}`);
    
    const result = {
      matchId: match.matchId,
      url: match.url,
      matchTitle: '',
      series: '',
      matchNumber: '',
      format: '',
      status: '',
      venue: '',
      date: '',
      startTime: '',
      result: '',
      winningTeam: '',
      margin: '',
      marginType: '',
      playerOfMatch: { name: '', image: '', profileUrl: '' },
      toss: { winner: '', decision: '' },
      officials: { umpires: [], thirdUmpire: '', matchReferee: '' },
      team1: { name: '', shortName: '', logo: '', innings: [] },
      team2: { name: '', shortName: '', logo: '', innings: [] },
      commentary: match.commentary,
      scorecard: match.scorecard,
      preview: match.preview,
      squads: match.squads,
      statistics: match.statistics,
      source: 'espncricinfo',
      scrapedAt: new Date().toISOString(),
    };

    // Get the full HTML text for regex extraction
    const fullText = $('body').text();
    const htmlString = $('html').html() || '';

    // ============================================================
    // 1. EXTRACT SERIES
    // ============================================================
    // Try breadcrumb first
    const breadcrumb = $('.ds-breadcrumb, .breadcrumb').text();
    if (breadcrumb) {
      const parts = breadcrumb.split('/').map(p => this.cleanText(p));
      if (parts.length >= 2 && parts[parts.length - 2] && !parts[parts.length - 2].includes('vs')) {
        result.series = this.cleanText(parts[parts.length - 2]);
        logger.debug(`  Series from breadcrumb: ${result.series}`);
      }
    }

    // Try to find series in text
    if (!result.series) {
      const seriesMatch = fullText.match(/Series:\s*([A-Za-z\s]+)/i);
      if (seriesMatch) {
        result.series = this.cleanText(seriesMatch[1]);
        logger.debug(`  Series from text: ${result.series}`);
      }
    }

    // Try to find series in title
    if (!result.series) {
      const titleText = $('title').text();
      const titleMatch = titleText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+\d{4}/);
      if (titleMatch) {
        result.series = this.cleanText(titleMatch[1]);
        logger.debug(`  Series from title: ${result.series}`);
      }
    }

    // ============================================================
    // 2. EXTRACT MATCH NUMBER
    // ============================================================
    const numberPatterns = [
      /(\d+)(?:st|nd|rd|th)\s+Match/i,
      /Match\s+(\d+)/i,
      /(\d+)(?:st|nd|rd|th)\s+match/i,
      /match\s+#\s*(\d+)/i,
      /#(\d+)\s+match/i
    ];

    for (const pattern of numberPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        if (match[0].includes('st') || match[0].includes('nd') || match[0].includes('rd') || match[0].includes('th')) {
          result.matchNumber = match[0];
        } else if (match[1]) {
          const num = match[1];
          const suffix = this.getOrdinalSuffix(parseInt(num));
          result.matchNumber = `${num}${suffix} Match`;
        }
        logger.debug(`  Match Number: ${result.matchNumber}`);
        break;
      }
    }

    // ============================================================
    // 3. EXTRACT VENUE
    // ============================================================
    const venueSelectors = [
      '.venue',
      '.match-venue',
      '.ds-text-tight-xs.ds-text-compact-s',
      '.ds-text-center.ds-text-tight-xs'
    ];

    for (const selector of venueSelectors) {
      const elements = $(selector);
      for (const el of elements) {
        const text = this.cleanText($(el).text());
        if (text && text.length > 3 && text.length < 100) {
          if (/stadium|ground|park|oval|city|village|sports|club|venue/i.test(text)) {
            result.venue = text;
            logger.debug(`  Venue from selector: ${result.venue}`);
            break;
          }
        }
      }
      if (result.venue) break;
    }

    if (!result.venue) {
      const venueMatch = fullText.match(/Venue:\s*([A-Za-z\s,]+)/i);
      if (venueMatch) {
        result.venue = this.cleanText(venueMatch[1]);
        logger.debug(`  Venue from text: ${result.venue}`);
      }
    }

    // ============================================================
    // 4. EXTRACT DATE AND TIME
    // ============================================================
    const datePatterns = [
      /(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})/,
      /([A-Za-z]{3,}\s+\d{1,2},\s+\d{4})/,
      /(\d{4}-\d{2}-\d{2})/
    ];

    for (const pattern of datePatterns) {
      const match = fullText.match(pattern);
      if (match) {
        result.date = match[0];
        logger.debug(`  Date: ${result.date}`);
        break;
      }
    }

    const timeMatch = fullText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
    if (timeMatch) {
      result.startTime = timeMatch[0];
      logger.debug(`  Time: ${result.startTime}`);
    }

    // ============================================================
    // 5. EXTRACT STATUS AND RESULT
    // ============================================================
    const statusSelectors = [
      '.status',
      '.ds-text-center.ds-text-tight-xs',
      '.ds-text-compact-s',
      '.match-status'
    ];

    let statusText = '';
    for (const selector of statusSelectors) {
      const elements = $(selector);
      for (const el of elements) {
        const text = this.cleanText($(el).text());
        if (text && (text.includes('won by') || text.includes('Stumps') || text.includes('Live') || 
            text.includes('Upcoming') || text.includes('Lunch') || text.includes('Tea') || 
            text.includes('Innings Break') || text.includes('Result'))) {
          statusText = text;
          break;
        }
      }
      if (statusText) break;
    }

    // Also search the full text for result
    if (!statusText) {
      const resultMatch = fullText.match(/([A-Za-z\s]+)\s+won by\s+(\d+)\s+(wkts?|runs?|wickets?)/i);
      if (resultMatch) {
        statusText = resultMatch[0];
        result.result = statusText;
        result.winningTeam = this.cleanText(resultMatch[1]);
        result.margin = resultMatch[2];
        result.marginType = resultMatch[3];
        result.status = 'RESULT';
        logger.debug(`  Result: ${result.result}`);
      }
    }

    if (statusText && !result.status) {
      result.status = this.parseStatus(statusText);
      
      const resultMatch = statusText.match(/([A-Za-z\s]+)\s+won by\s+(\d+)\s+(wkts?|runs?|wickets?)/i);
      if (resultMatch) {
        result.result = statusText;
        result.winningTeam = this.cleanText(resultMatch[1]);
        result.margin = resultMatch[2];
        result.marginType = resultMatch[3];
        result.status = 'RESULT';
        logger.debug(`  Result: ${result.result}`);
      } else {
        logger.debug(`  Status: ${result.status}`);
      }
    }

    // ============================================================
    // 6. EXTRACT PLAYER OF MATCH
    // ============================================================
    const pomPatterns = [
      /Player of the Match:\s*([A-Za-z\s]+)/i,
      /Player of Match:\s*([A-Za-z\s]+)/i,
      /POTM:\s*([A-Za-z\s]+)/i,
      /Man of the Match:\s*([A-Za-z\s]+)/i
    ];

    for (const pattern of pomPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        result.playerOfMatch.name = this.cleanText(match[1]);
        logger.debug(`  Player of Match: ${result.playerOfMatch.name}`);
        break;
      }
    }

    // Try to find in specific elements
    if (!result.playerOfMatch.name) {
      const pomSelectors = ['.player-of-match', '.pom', '.ds-text-center'];
      for (const selector of pomSelectors) {
        const elements = $(selector);
        for (const el of elements) {
          const text = $(el).text();
          const match = text.match(/Player of the Match:\s*([A-Za-z\s]+)/i);
          if (match) {
            result.playerOfMatch.name = this.cleanText(match[1]);
            logger.debug(`  Player of Match from selector: ${result.playerOfMatch.name}`);
            break;
          }
        }
        if (result.playerOfMatch.name) break;
      }
    }

    // ============================================================
    // 7. EXTRACT TOSS
    // ============================================================
    const tossPatterns = [
      /([A-Za-z\s]+)\s+won the toss\s+and\s+(opted\s+to\s+(bowl|bat|field))/i,
      /([A-Za-z\s]+)\s+won the toss/i
    ];

    for (const pattern of tossPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        result.toss.winner = this.cleanText(match[1]);
        if (match[2]) {
          result.toss.decision = this.cleanText(match[2]);
        }
        logger.debug(`  Toss: ${result.toss.winner} ${result.toss.decision}`);
        break;
      }
    }

    // Try to find in specific elements
    if (!result.toss.winner) {
      const tossSelectors = ['.toss-info', '.ds-text-center'];
      for (const selector of tossSelectors) {
        const elements = $(selector);
        for (const el of elements) {
          const text = $(el).text();
          const match = text.match(/([A-Za-z\s]+)\s+won the toss/i);
          if (match) {
            result.toss.winner = this.cleanText(match[1]);
            const decisionMatch = text.match(/opted to (bowl|bat|field)/i);
            if (decisionMatch) {
              result.toss.decision = `opted to ${decisionMatch[1]}`;
            }
            logger.debug(`  Toss from selector: ${result.toss.winner}`);
            break;
          }
        }
        if (result.toss.winner) break;
      }
    }

    // ============================================================
    // 8. EXTRACT OFFICIALS
    // ============================================================
    const umpireMatch = fullText.match(/Umpires?:\s*([A-Za-z\s,]+)/i);
    if (umpireMatch) {
      result.officials.umpires = umpireMatch[1].split(',').map(u => this.cleanText(u));
      logger.debug(`  Umpires: ${result.officials.umpires.join(', ')}`);
    }

    const thirdMatch = fullText.match(/Third Umpire:\s*([A-Za-z\s]+)/i);
    if (thirdMatch) {
      result.officials.thirdUmpire = this.cleanText(thirdMatch[1]);
      logger.debug(`  Third Umpire: ${result.officials.thirdUmpire}`);
    }

    const refereeMatch = fullText.match(/Match Referee:\s*([A-Za-z\s]+)/i);
    if (refereeMatch) {
      result.officials.matchReferee = this.cleanText(refereeMatch[1]);
      logger.debug(`  Match Referee: ${result.officials.matchReferee}`);
    }

    // ============================================================
    // 9. EXTRACT TEAMS AND SCORES
    // ============================================================
    // Try ci-team-score first
    const teamScoreElements = $('.ci-team-score');
    
    if (teamScoreElements.length >= 2) {
      let teamIndex = 0;
      for (const element of teamScoreElements) {
        const $el = $(element);
        const teamData = this.parseTeamScoreElement($el);
        
        if (teamData && teamData.name) {
          if (teamIndex === 0) {
            result.team1 = teamData;
            logger.debug(`  Team1: ${teamData.name} (${teamData.shortName})`);
          } else if (teamIndex === 1) {
            result.team2 = teamData;
            logger.debug(`  Team2: ${teamData.name} (${teamData.shortName})`);
          }
          teamIndex++;
        }
        if (teamIndex >= 2) break;
      }
    }

    // If no ci-team-score, try to find from text
    if (!result.team1.name || !result.team2.name) {
      // Try to find teams from the page
      const teamMatches = fullText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(\d+)\/?(\d*)/g);
      if (teamMatches && teamMatches.length >= 2) {
        const team1Match = teamMatches[0]?.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(\d+)\/?(\d*)/);
        const team2Match = teamMatches[1]?.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(\d+)\/?(\d*)/);
        
        if (team1Match) {
          result.team1.name = this.cleanText(team1Match[1]);
          result.team1.shortName = this.getShortName(result.team1.name);
          result.team1.innings = [{
            runs: team1Match[2] || '',
            wickets: team1Match[3] || '',
            overs: '',
            declared: false
          }];
        }
        if (team2Match) {
          result.team2.name = this.cleanText(team2Match[1]);
          result.team2.shortName = this.getShortName(result.team2.name);
          result.team2.innings = [{
            runs: team2Match[2] || '',
            wickets: team2Match[3] || '',
            overs: '',
            declared: false
          }];
        }
      }
    }

    // ============================================================
    // 10. BUILD MATCH TITLE
    // ============================================================
    if (!result.matchTitle && result.team1.name && result.team2.name) {
      result.matchTitle = `${result.team1.name} vs ${result.team2.name}`;
    }

    // ============================================================
    // 11. LOG RESULTS
    // ============================================================
    this.logParseResults(result);

    return result;
  }

  // ============================================================
  // PARSE TEAM SCORE ELEMENT
  // ============================================================
  parseTeamScoreElement($el) {
    const logo = $el.find('img').attr('src') || '';
    
    const nameEl = $el.find('.ds-text-tight-s, .ds-text-compact-s, .ds-font-bold').first();
    const nameText = nameEl.text() || '';
    
    const shortNameEl = $el.find('.ds-text-tight-xs, .ds-text-compact-xs').first();
    const shortNameText = shortNameEl.text() || '';
    
    const scoreEl = $el.find('.ds-text-title-s, .ds-text-tight-m, .ds-font-bold').last();
    const scoreText = scoreEl.text() || '';
    
    const oversEl = $el.find('.ds-text-tight-xs').last();
    const oversText = oversEl.text() || '';
    
    const scoreMatch = scoreText.match(/(\d+)\/?(\d*)/);
    const runs = scoreMatch ? scoreMatch[1] : '';
    const wickets = scoreMatch ? scoreMatch[2] : '';
    
    const oversMatch = oversText.match(/\(([\d.]+)\s+ov\)/);
    const overs = oversMatch ? oversMatch[1] : '';
    
    const innings = [];
    if (runs) {
      innings.push({
        runs: runs,
        wickets: wickets,
        overs: overs,
        declared: scoreText.includes('dec') || scoreText.includes('declared')
      });
    }
    
    let teamName = nameText || shortNameText;
    if (!teamName || teamName.length < 2) {
      const logoAlt = $el.find('img').attr('alt') || '';
      if (logoAlt) {
        teamName = logoAlt;
      }
    }
    
    const shortName = shortNameText || this.getShortName(teamName);
    
    return {
      name: this.cleanText(teamName) || 'Unknown',
      shortName: this.cleanText(shortName),
      logo: logo,
      innings: innings
    };
  }

  // ============================================================
  // LOG PARSE RESULTS
  // ============================================================
  logParseResults(result) {
    const checks = [
      { label: 'Series Found', value: result.series },
      { label: 'Match Title Found', value: result.matchTitle },
      { label: 'Match Number Found', value: result.matchNumber },
      { label: 'Venue Found', value: result.venue },
      { label: 'Date Found', value: result.date },
      { label: 'Time Found', value: result.startTime },
      { label: 'Team 1 Found', value: result.team1.name },
      { label: 'Team 2 Found', value: result.team2.name },
      { label: 'Status Found', value: result.status },
      { label: 'Result Found', value: result.result },
      { label: 'Toss Found', value: result.toss.winner },
      { label: 'Player Of Match Found', value: result.playerOfMatch.name },
      { label: 'Officials Found', value: result.officials.umpires.length > 0 },
    ];
    
    logger.info('📊 Extraction Results:');
    for (const check of checks) {
      const value = typeof check.value === 'boolean' ? check.value : !!check.value;
      logger.info(`  ${check.label}: ${value ? '✅' : '❌'}`);
    }
  }

  // ============================================================
  // BUILD MATCH FROM URL (LAST RESORT)
  // ============================================================
  buildMatchFromURL(match) {
    logger.info(`Building match from URL for ${match.matchId}`);
    
    const result = {
      matchId: match.matchId,
      url: match.url,
      matchTitle: '',
      series: '',
      matchNumber: '',
      format: '',
      status: 'UNKNOWN',
      venue: '',
      date: '',
      startTime: '',
      result: '',
      winningTeam: '',
      margin: '',
      marginType: '',
      playerOfMatch: { name: '', image: '', profileUrl: '' },
      toss: { winner: '', decision: '' },
      officials: { umpires: [], thirdUmpire: '', matchReferee: '' },
      team1: { name: '', shortName: '', logo: '', innings: [] },
      team2: { name: '', shortName: '', logo: '', innings: [] },
      commentary: match.commentary,
      scorecard: match.scorecard,
      preview: match.preview,
      squads: match.squads,
      statistics: match.statistics,
      source: 'espncricinfo',
      scrapedAt: new Date().toISOString(),
    };
    
    const seriesMatch = match.url.match(/\/series\/([^\/]+)/);
    if (seriesMatch) {
      const seriesSlug = seriesMatch[1];
      const seriesName = seriesSlug
        .replace(/-(\d{4})/g, '')
        .replace(/-\d+$/g, '')
        .replace(/-/g, ' ')
        .trim();
      
      if (seriesName) {
        result.series = this.capitalizeWords(seriesName);
        logger.debug(`  Series from URL: ${result.series}`);
      }
    }
    
    const matchPart = match.url.match(/\/series\/[^\/]+\/([^\/]+)\/live-cricket-score/);
    if (matchPart) {
      const matchSlug = matchPart[1];
      const teamMatch = matchSlug.match(/([a-z-]+)-vs-([a-z-]+)-/);
      if (teamMatch) {
        const team1Name = teamMatch[1].replace(/-/g, ' ');
        const team2Name = teamMatch[2].replace(/-/g, ' ');
        result.team1.name = this.capitalizeWords(team1Name);
        result.team1.shortName = this.getShortName(result.team1.name);
        result.team2.name = this.capitalizeWords(team2Name);
        result.team2.shortName = this.getShortName(result.team2.name);
        logger.debug(`  Teams from URL: ${result.team1.name} vs ${result.team2.name}`);
      }
      
      const numberMatch = matchSlug.match(/(\d+)(?:st|nd|rd|th)-match/);
      if (numberMatch) {
        const num = numberMatch[1];
        const suffix = this.getOrdinalSuffix(parseInt(num));
        result.matchNumber = `${num}${suffix} Match`;
        logger.debug(`  Match number from URL: ${result.matchNumber}`);
      }
    }
    
    if (result.team1.name && result.team2.name) {
      result.matchTitle = `${result.team1.name} vs ${result.team2.name}`;
    }
    
    return result;
  }

  // ============================================================
  // HELPER METHODS
  // ============================================================
  
  capitalizeWords(str) {
    return str.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  getOrdinalSuffix(n) {
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const value = n % 100;
    return suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0];
  }

  isValidMatchUrl(href) {
    if (!href) return false;
    if (href.startsWith('/ci/engine/')) return false;

    const rejectedPatterns = [
      '/desktop.html',
      'calendar',
      '/scores/desktop',
      '/index.html',
      '/news',
      '/features',
      '/videos',
      '/stats',
      '/teams',
      '/rankings',
      '/about',
      '/contact',
      '/privacy',
      '/terms',
    ];
    for (const pattern of rejectedPatterns) {
      if (href.includes(pattern)) return false;
    }

    const acceptedPatterns = [
      /\/series\/[^\/]+\/live-cricket-score/,
      /\/series\/[^\/]+\/[^\/]+-match-[^\/]+\/live-cricket-score/,
      /\/match\/[a-zA-Z0-9-]+/,
    ];
    for (const pattern of acceptedPatterns) {
      if (pattern.test(href)) return true;
    }
    return false;
  }

  extractMatchId(url) {
    if (!url) return '';
    const pattern1 = /-(\d+)\/live-cricket-score/;
    const match1 = url.match(pattern1);
    if (match1) return match1[1];

    const pattern2 = /\/match\/(\d+)/;
    const match2 = url.match(pattern2);
    if (match2) return match2[1];

    const pattern3 = /\/series\/[^\/]+\/(\d+)/;
    const match3 = url.match(pattern3);
    if (match3) return match3[1];

    return '';
  }

  extractSeriesSlug(url) {
    if (!url) return '';
    const match = url.match(/\/series\/([^\/]+)/);
    return match ? match[1] : '';
  }

  extractMatchSlug(url) {
    if (!url) return '';
    const match = url.match(/\/series\/[^\/]+\/([^\/]+)\/live-cricket-score/);
    return match ? match[1] : '';
  }

  parseStatus(statusText) {
    if (!statusText) return 'LIVE';
    const lower = statusText.toLowerCase();
    if (lower.includes('stumps')) return 'STUMPS';
    if (lower.includes('lunch')) return 'LUNCH';
    if (lower.includes('tea')) return 'TEA';
    if (lower.includes('innings break')) return 'INNINGS_BREAK';
    if (lower.includes('won by') || lower.includes('result')) return 'RESULT';
    if (lower.includes('upcoming')) return 'UPCOMING';
    if (lower.includes('abandoned')) return 'ABANDONED';
    if (lower.includes('rain')) return 'RAIN';
    if (lower.includes('live')) return 'LIVE';
    return 'LIVE';
  }

  getShortName(teamName) {
    if (!teamName) return '';
    const shortNames = {
      'Dambulla Sixers': 'DAS',
      'Galle Gallants': 'GAG',
      'Kandy Warriors': 'KAN',
      'Jaffna Kings': 'JAF',
      'Colombo Stars': 'COL',
      'Colombo Kaps': 'CK',
      'Kandy Royals': 'KR',
      'London Spirit': 'LNS',
      'Manchester Super Giants': 'MSG',
      'Perth Scorchers': 'PS',
      'Lahore Qalandars': 'LQ',
      'Guyana Amazon Warriors': 'GAW',
      'San Francisco Unicorns': 'SFU',
      India: 'IND',
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
      Nepal: 'NEP',
      Namibia: 'NAM',
    };
    for (const [full, short] of Object.entries(shortNames)) {
      if (teamName.includes(full)) return short;
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

  cleanText(text) {
    if (!text) return '';
    return text
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[^\x20-\x7E]/g, '')
      .trim();
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

module.exports = ESPNCricinfoScraper;