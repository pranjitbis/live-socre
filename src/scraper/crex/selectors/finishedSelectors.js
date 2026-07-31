// src/scraper/crex/selectors/finishedSelectors.js
module.exports = {
  // Page URL
  PAGE_URL: 'https://crex.com/finished-matches',

  // Match discovery selectors
  MATCH_CARD: '.match-card, .finished-match, .result-card',

  // Result selectors
  RESULT: '.resultText, .result, .match-result, .result-text, .cb-result',
  WINNING_TEAM: '.winning-team, .winner, .win-team',
  MARGIN: '.margin, .win-margin, .result-margin',

  // Team selectors
  TEAM_INNING: '.team-innig',
  TEAM_NAME: '.team-name',
  TEAM_SCORE: '.team-score .runs',
  SCORE_FIRST: '.team-score .runs span:first-child',
  SCORE_LAST: '.team-score .runs span:last-child',
  TEAM_FLAG: '.team-img img',

  // Player of Match
  PLAYER_OF_MATCH: '.player-of-match, .pom, .mom, .cb-pom, .player-of-the-match, .p-lw-card',
  PLAYER_NAME: '.player-name, .pom-name, .name',
  PLAYER_IMAGE: 'img',
  PLAYER_PERFORMANCE: '.performance, .stats, .pom-stats',
  PLAYER_TEAM: '.team-name, .team',

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

  // Common
  SERIES: '.series-name, .snameTag, .match-series',
  TITLE: 'h1, .match-title, .match-header h1',
  MATCH_NUMBER: '.match-number, .match-desc',
  VENUE: '.venue, .match-venue, .venue-name',
  TOSS: '.toss, .toss-info, .toss-detail',
  OFFICIALS: '.officials, .match-officials',
};