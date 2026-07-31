// src/scraper/crex/selectors/upcomingSelectors.js
module.exports = {
  // Page URL
  PAGE_URL: 'https://crex.com/',

  // Discovery selectors (homepage)
  MATCH_CARD: '.live-card',
  MATCH_WRAPPER: '.live-card-wrapper',
  
  // Match URL extraction
  MATCH_LINK: 'a[href*="cricket-live-score"]',

  // Team selectors (homepage)
  TEAM_PROFILE: '.teamProfile',
  TEAM_NAME: '.teamNameUpc, .team-name, .name',
  TEAM_FLAG: '.teamFlagUpc img',

  // Schedule selectors (homepage)
  FLEX_COLUMN: '.flexColumn',
  DATE: '.val1-text, .match-date, .date, .schedule-date, .day, .fixture-date, .start-date',
  TIME: '.val2-text, .match-time, .time, .schedule-time, .start-time, .fixture-time',
  COUNTDOWN: '.time-text, .starts-in, .countdown, .remaining-time, .schedule-countdown',

  // Common
  SERIES: '.series-name, .snameTag, .match-series',
  TITLE: 'h1, .match-title, .match-header h1',
  MATCH_NUMBER: '.match-number, .match-desc',
  VENUE: '.venue, .match-venue, .venue-name',
  TOSS: '.toss, .toss-info, .toss-detail',
  OFFICIALS: '.officials, .match-officials',

  // Detail page selectors
  DETAIL_WRAPPER: 'app-match-details-wrapper',
  TEAM_CONTAINER: '.team-container, .team-info, .match-teams .team',
  TEAM_SCORE: '.score, .team-score, .runs',
  RESULT: '.result, .match-result, .cb-result, .status-text',
  PLAYER_OF_MATCH: '.player-of-match, .pom, .mom, .cb-pom, .match-pom',
  COMMENTARY_LINK: 'a[href*="commentary"]',
  SCORECARD_LINK: 'a[href*="scorecard"]',
  PREVIEW_LINK: 'a[href*="preview"]',
  SQUADS_LINK: 'a[href*="squads"]',
  STATISTICS_LINK: 'a[href*="stats"], a[href*="statistics"]'
};