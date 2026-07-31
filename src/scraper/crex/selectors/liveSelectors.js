// src/scraper/crex/selectors/liveSelectors.js
module.exports = {
  // Page URL
  PAGE_URL: 'https://crex.com/cricket-live-score',

  // Match discovery selectors
  MATCH_CARD: '.team-innig, .live-match, .match-card',

  // Team selectors
  TEAM_INNING: '.team-innig',
  TEAM_NAME: '.team-name',
  TEAM_SCORE: '.team-score .runs',
  SCORE_FIRST: '.team-score .runs span:first-child',
  SCORE_LAST: '.team-score .runs span:last-child',
  TEAM_FLAG: '.team-img img',

  // Batsmen
  BATSMEN: '.batsmen-partnership, .batsmen, .partnership',
  BATSMAN: '.batsman, .batsmen-item',
  BATSMAN_NAME: '.batsmen-name, .name',
  BATSMAN_SCORE: '.batsmen-score p, .score',

  // Bowler
  BOWLER: '.bowler-info, .current-bowler, .bowler',
  BOWLER_NAME: '.bowler-name, .name',

  // Overs timeline
  TIMELINE: '.overs-timeline, .overs-slide',
  OVER: '.over, .overs-item',
  BALL: '.ball, .delivery',
  OVER_NUMBER: '.over-number, .number',

  // Status
  CRR: '.crr, .current-run-rate',
  RRR: '.rrr, .required-run-rate',
  PARTNERSHIP: '.partnership, .partnership-info',

  // Common
  SERIES: '.series-name, .snameTag, .match-series',
  TITLE: 'h1, .match-title, .match-header h1',
  MATCH_NUMBER: '.match-number, .match-desc',
  VENUE: '.venue, .match-venue, .venue-name',
  TOSS: '.toss, .toss-info, .toss-detail',
  OFFICIALS: '.officials, .match-officials',
};