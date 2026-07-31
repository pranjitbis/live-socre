const cheerio = require('cheerio');
const BaseScraper = require('../base/BaseScraper');
const config = require('../../config');
const logger = require('../../logger');

class ICCScraper extends BaseScraper {
  constructor() {
    super(config.sources.icc);
  }

  async scrapeLive() {
    const url = `${this.baseUrl}/matches`;
    logger.info(`Scraping ICC matches from ${url}`);
    
    try {
      const html = await this.fetchPage(url);
      await this.saveDebugData('live_html', html);
      
      const $ = cheerio.load(html);
      const matches = [];
      
      let matchContainers = $('.match-item, .match-card, .fixture-card');
      
      if (matchContainers.length === 0) {
        matchContainers = $('.matches-list .match, .fixtures-list .fixture');
      }
      
      logger.info(`Found ${matchContainers.length} match containers`);
      
      if (matchContainers.length === 0) {
        await this.saveDebugData('live_no_containers', {
          url,
          html_length: html.length,
          page_title: $('title').text()
        });
        return [];
      }
      
      for (let i = 0; i < matchContainers.length; i++) {
        try {
          const element = matchContainers[i];
          const match = this.parseMatch($, element);
          
          if (match && this.validateMatch(match)) {
            const existing = matches.find(m => m.matchId === match.matchId);
            if (!existing) {
              matches.push(match);
            }
          }
        } catch (error) {
          logger.error(`Error parsing ICC match ${i}:`, error.message);
        }
      }
      
      logger.info(`Extracted ${matches.length} matches from ICC`);
      this.logScrape('live', matches.length);
      
      return matches;
    } catch (error) {
      logger.error('Error scraping ICC matches:', error);
      await this.saveDebugData('live_error', { error: error.message, url });
      throw error;
    }
  }

  parseMatch($, element) {
    const $item = $(element);
    
    const linkElement = $item.find('a[href*="/match/"], a[href*="/fixture/"]');
    const matchLink = linkElement.attr('href') || '';
    const url = matchLink ? `${this.baseUrl}${matchLink}` : '';
    const matchId = this.generateMatchId(url);
    
    const teamElements = $item.find('.team, .team-name');
    let team1Name = '', team2Name = '';
    let team1Score = '', team2Score = '';
    let team1Overs = '', team2Overs = '';
    
    if (teamElements.length >= 2) {
      team1Name = this.cleanText($(teamElements[0]).text());
      team2Name = this.cleanText($(teamElements[1]).text());
    }
    
    const scoreElements = $item.find('.score, .score-text');
    if (scoreElements.length >= 2) {
      const score1Text = this.cleanText($(scoreElements[0]).text());
      const score2Text = this.cleanText($(scoreElements[1]).text());
      
      const score1Parsed = this.extractScore(score1Text);
      const score2Parsed = this.extractScore(score2Text);
      
      team1Score = score1Parsed.score || '';
      team1Overs = score1Parsed.overs || '';
      team2Score = score2Parsed.score || '';
      team2Overs = score2Parsed.overs || '';
    }
    
    const titleElement = $item.find('.title, .match-title, h3');
    const title = this.cleanText(titleElement.text()) || `${team1Name} vs ${team2Name}`;
    
    const seriesElement = $item.find('.series, .tournament, .competition');
    const series = this.cleanText(seriesElement.text()) || 'ICC Event';
    
    const statusElement = $item.find('.status, .match-status, .live, .upcoming, .result');
    let status = this.cleanText(statusElement.text());
    if (!status) status = 'LIVE';
    
    if (status.toLowerCase().includes('live')) status = 'LIVE';
    else if (status.toLowerCase().includes('result')) status = 'RESULT';
    else if (status.toLowerCase().includes('upcoming')) status = 'UPCOMING';
    
    const venueElement = $item.find('.venue, .location, .stadium');
    const venue = this.cleanText(venueElement.text());
    
    const dateElement = $item.find('.date, .datetime, .time');
    const dateText = this.cleanText(dateElement.text());
    const { startTime, startsIn } = this.extractTime(dateText);
    
    const resultElement = $item.find('.result, .match-result');
    const result = this.cleanText(resultElement.text());
    
    let winningTeam = '';
    if (result) {
      if (result.includes(team1Name)) winningTeam = team1Name;
      else if (result.includes(team2Name)) winningTeam = team2Name;
    }
    
    const category = this.detectCategory(title, series);
    const format = this.detectFormat(title, series, status);
    
    return {
      matchId,
      url,
      series,
      matchTitle: title,
      category,
      status,
      format,
      venue: venue || '',
      team1: {
        name: team1Name || 'Team 1',
        short: this.getShortName(team1Name),
        flag: this.getFlagUrl(team1Name),
        score: team1Score,
        overs: team1Overs
      },
      team2: {
        name: team2Name || 'Team 2',
        short: this.getShortName(team2Name),
        flag: this.getFlagUrl(team2Name),
        score: team2Score,
        overs: team2Overs
      },
      toss: '',
      result: result || '',
      winningTeam: winningTeam || '',
      startTime: startTime || '',
      startsIn: startsIn || '',
      commentary: url ? `${url}/commentary` : '',
      scorecard: url ? `${url}/scorecard` : '',
      preview: url ? `${url}/preview` : '',
      squads: url ? `${url}/squads` : '',
      statistics: url ? `${url}/stats` : '',
      source: 'icc',
      scrapedAt: new Date().toISOString()
    };
  }

  async scrapeFixtures() {
    return await this.scrapeLive();
  }

  async scrapeMatch(matchId) {
    const url = `${this.baseUrl}/match/${matchId}`;
    logger.info(`Scraping ICC match ${matchId}`);
    
    try {
      const html = await this.fetchPage(url);
      await this.saveDebugData(`match_${matchId}_html`, html);
      
      const $ = cheerio.load(html);
      
      const title = this.cleanText($('.match-title, h1').text());
      const series = this.cleanText($('.series, .tournament').text());
      
      const teamElements = $('.team, .team-name');
      let team1Name = '', team2Name = '';
      let team1Score = '', team2Score = '';
      
      if (teamElements.length >= 2) {
        team1Name = this.cleanText($(teamElements[0]).text());
        team2Name = this.cleanText($(teamElements[1]).text());
        
        const scoreElements = $('.score, .score-text');
        if (scoreElements.length >= 2) {
          team1Score = this.cleanText($(scoreElements[0]).text());
          team2Score = this.cleanText($(scoreElements[1]).text());
        }
      }
      
      const venue = this.cleanText($('.venue, .location').text());
      const status = this.cleanText($('.status, .match-status').text()) || 'LIVE';
      const result = this.cleanText($('.result, .match-result').text());
      
      const category = this.detectCategory(title, series);
      const format = this.detectFormat(title, series, status);
      
      return {
        matchId,
        url,
        series: series || 'ICC Event',
        matchTitle: title || `${team1Name} vs ${team2Name}`,
        category,
        status,
        format,
        venue: venue || '',
        team1: {
          name: team1Name || 'Team 1',
          short: this.getShortName(team1Name),
          flag: this.getFlagUrl(team1Name),
          score: team1Score,
          overs: ''
        },
        team2: {
          name: team2Name || 'Team 2',
          short: this.getShortName(team2Name),
          flag: this.getFlagUrl(team2Name),
          score: team2Score,
          overs: ''
        },
        toss: '',
        result: result || '',
        winningTeam: result ? (result.includes(team1Name) ? team1Name : (result.includes(team2Name) ? team2Name : '')) : '',
        startTime: '',
        startsIn: '',
        commentary: `${this.baseUrl}/match/${matchId}/commentary`,
        scorecard: `${this.baseUrl}/match/${matchId}/scorecard`,
        preview: `${this.baseUrl}/match/${matchId}/preview`,
        squads: `${this.baseUrl}/match/${matchId}/squads`,
        statistics: `${this.baseUrl}/match/${matchId}/stats`,
        source: 'icc',
        scrapedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error scraping ICC match ${matchId}:`, error);
      throw error;
    }
  }

  async scrapeCommentary(matchId) {
    const url = `${this.baseUrl}/match/${matchId}/commentary`;
    logger.info(`Scraping ICC commentary for match ${matchId}`);
    
    try {
      const html = await this.fetchPage(url);
      await this.saveDebugData(`commentary_${matchId}_html`, html);
      
      const $ = cheerio.load(html);
      const commentary = [];
      
      const items = $('.commentary-item, .comm-item');
      
      for (let i = 0; i < items.length; i++) {
        const $item = $(items[i]);
        const text = this.cleanText($item.find('.comment, .text').text());
        
        if (text) {
          commentary.push({
            over: '',
            ball: '',
            text,
            timestamp: new Date().toISOString()
          });
        }
      }
      
      return {
        matchId,
        commentary,
        count: commentary.length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error scraping ICC commentary for match ${matchId}:`, error);
      throw error;
    }
  }

  async scrapePoints() {
    return {};
  }

  async scrapeNews() {
    const url = `${this.baseUrl}/news`;
    logger.info(`Scraping ICC news from ${url}`);
    
    try {
      const html = await this.fetchPage(url);
      await this.saveDebugData('news_html', html);
      
      const $ = cheerio.load(html);
      const news = [];
      
      const items = $('.news-item, .article-card');
      
      for (let i = 0; i < items.length; i++) {
        const $item = $(items[i]);
        const title = this.cleanText($item.find('.title, h3').text());
        const link = $item.find('a').attr('href') || '';
        const url = link ? `${this.baseUrl}${link}` : '';
        const content = this.cleanText($item.find('.summary, p').text());
        const date = this.cleanText($item.find('.date, .published').text());
        
        if (title) {
          news.push({
            id: `news_${Date.now()}_${i}`,
            title,
            content: content || '',
            link: url,
            source: 'icc',
            publishedAt: date || new Date().toISOString()
          });
        }
      }
      
      logger.info(`Extracted ${news.length} news items from ICC`);
      return news;
    } catch (error) {
      logger.error('Error scraping ICC news:', error);
      throw error;
    }
  }
}

module.exports = ICCScraper;