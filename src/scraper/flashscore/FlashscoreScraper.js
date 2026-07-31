const cheerio = require('cheerio');
const BaseScraper = require('../base/BaseScraper');
const config = require('../../config');
const logger = require('../../logger');

class FlashscoreScraper extends BaseScraper {
  constructor() {
    super(config.sources.flashscore);
  }

  async scrapeLive() {
    const url = `${this.baseUrl}/cricket/`;
    logger.info(`Scraping Flashscore matches from ${url}`);
    
    try {
      const html = await this.fetchPage(url);
      await this.saveDebugData('live_html', html);
      
      const $ = cheerio.load(html);
      const matches = [];
      
      let matchContainers = $('.match, .event, .sportName');
      
      if (matchContainers.length === 0) {
        matchContainers = $('[class*="match"], [class*="event"]');
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
          logger.error(`Error parsing Flashscore match ${i}:`, error.message);
        }
      }
      
      logger.info(`Extracted ${matches.length} matches from Flashscore`);
      this.logScrape('live', matches.length);
      
      return matches;
    } catch (error) {
      logger.error('Error scraping Flashscore matches:', error);
      await this.saveDebugData('live_error', { error: error.message, url });
      throw error;
    }
  }

  parseMatch($, element) {
    const $item = $(element);
    
    const linkElement = $item.find('a[href*="/cricket/"]');
    const matchLink = linkElement.attr('href') || '';
    const url = matchLink ? `${this.baseUrl}${matchLink}` : '';
    const matchId = this.generateMatchId(url);
    
    const teamElements = $item.find('.team, .participant');
    let team1Name = '', team2Name = '';
    let team1Score = '', team2Score = '';
    
    if (teamElements.length >= 2) {
      team1Name = this.cleanText($(teamElements[0]).text());
      team2Name = this.cleanText($(teamElements[1]).text());
    }
    
    const scoreElements = $item.find('.score, .result');
    if (scoreElements.length >= 2) {
      team1Score = this.cleanText($(scoreElements[0]).text());
      team2Score = this.cleanText($(scoreElements[1]).text());
    }
    
    const titleElement = $item.find('.title, .match-title');
    const title = this.cleanText(titleElement.text()) || `${team1Name} vs ${team2Name}`;
    
    const statusElement = $item.find('.status, .match-status, .live, .upcoming, .finished');
    let status = this.cleanText(statusElement.text());
    if (!status) status = 'LIVE';
    
    if (status.toLowerCase().includes('live')) status = 'LIVE';
    else if (status.toLowerCase().includes('finished') || status.toLowerCase().includes('ft')) status = 'RESULT';
    else if (status.toLowerCase().includes('upcoming')) status = 'UPCOMING';
    
    const seriesElement = $item.find('.tournament, .league, .competition');
    const series = this.cleanText(seriesElement.text()) || 'Unknown Tournament';
    
    const venueElement = $item.find('.venue, .location');
    const venue = this.cleanText(venueElement.text());
    
    const timeElement = $item.find('.time, .datetime');
    const timeText = this.cleanText(timeElement.text());
    const { startTime, startsIn } = this.extractTime(timeText);
    
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
      result: '',
      winningTeam: '',
      startTime: startTime || '',
      startsIn: startsIn || '',
      commentary: url ? `${url}/commentary` : '',
      scorecard: url ? `${url}/scorecard` : '',
      preview: url ? `${url}/preview` : '',
      squads: url ? `${url}/squads` : '',
      statistics: url ? `${url}/stats` : '',
      source: 'flashscore',
      scrapedAt: new Date().toISOString()
    };
  }

  async scrapeFixtures() {
    return await this.scrapeLive();
  }

  async scrapeMatch(matchId) {
    const url = `${this.baseUrl}/cricket/match/${matchId}`;
    logger.info(`Scraping Flashscore match ${matchId}`);
    
    try {
      const html = await this.fetchPage(url);
      await this.saveDebugData(`match_${matchId}_html`, html);
      
      const $ = cheerio.load(html);
      
      const title = this.cleanText($('.match-title, h1').text());
      const series = this.cleanText($('.tournament, .league').text());
      
      const teamElements = $('.team, .participant');
      let team1Name = '', team2Name = '';
      let team1Score = '', team2Score = '';
      
      if (teamElements.length >= 2) {
        team1Name = this.cleanText($(teamElements[0]).text());
        team2Name = this.cleanText($(teamElements[1]).text());
        
        const scoreElements = $('.score, .result');
        if (scoreElements.length >= 2) {
          team1Score = this.cleanText($(scoreElements[0]).text());
          team2Score = this.cleanText($(scoreElements[1]).text());
        }
      }
      
      const venue = this.cleanText($('.venue, .location').text());
      const status = this.cleanText($('.status, .match-status').text()) || 'LIVE';
      
      const category = this.detectCategory(title, series);
      const format = this.detectFormat(title, series, status);
      
      return {
        matchId,
        url,
        series: series || 'Unknown Tournament',
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
        result: '',
        winningTeam: '',
        startTime: '',
        startsIn: '',
        commentary: `${this.baseUrl}/cricket/match/${matchId}/commentary`,
        scorecard: `${this.baseUrl}/cricket/match/${matchId}/scorecard`,
        preview: `${this.baseUrl}/cricket/match/${matchId}/preview`,
        squads: `${this.baseUrl}/cricket/match/${matchId}/squads`,
        statistics: `${this.baseUrl}/cricket/match/${matchId}/stats`,
        source: 'flashscore',
        scrapedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error scraping Flashscore match ${matchId}:`, error);
      throw error;
    }
  }

  async scrapeCommentary(matchId) {
    const url = `${this.baseUrl}/cricket/match/${matchId}/commentary`;
    logger.info(`Scraping Flashscore commentary for match ${matchId}`);
    
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
      logger.error(`Error scraping Flashscore commentary for match ${matchId}:`, error);
      throw error;
    }
  }

  async scrapePoints() {
    return {};
  }

  async scrapeNews() {
    const url = `${this.baseUrl}/news/cricket/`;
    logger.info(`Scraping Flashscore news from ${url}`);
    
    try {
      const html = await this.fetchPage(url);
      await this.saveDebugData('news_html', html);
      
      const $ = cheerio.load(html);
      const news = [];
      
      const items = $('.news-item, .article-card, .post');
      
      for (let i = 0; i < items.length; i++) {
        const $item = $(items[i]);
        const title = this.cleanText($item.find('.title, h3, h4').text());
        const link = $item.find('a').attr('href') || '';
        const url = link ? `${this.baseUrl}${link}` : '';
        const content = this.cleanText($item.find('.summary, .excerpt, p').text());
        const date = this.cleanText($item.find('.date, .time, .published').text());
        
        if (title) {
          news.push({
            id: `news_${Date.now()}_${i}`,
            title,
            content: content || '',
            link: url,
            source: 'flashscore',
            publishedAt: date || new Date().toISOString()
          });
        }
      }
      
      logger.info(`Extracted ${news.length} news items from Flashscore`);
      return news;
    } catch (error) {
      logger.error('Error scraping Flashscore news:', error);
      throw error;
    }
  }
}

module.exports = FlashscoreScraper;