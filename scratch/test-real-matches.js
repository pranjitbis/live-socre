// scratch/test-real-matches.js
const { LiveScraper } = require('../src/scraper/crex');
const logger = require('../src/logger');

async function testMatches() {
  const scraper = new LiveScraper();
  
  console.log('============================================================');
  console.log('Testing CREX Live Scraper Output Against Required Cases');
  console.log('============================================================');

  // Test Case 1: IND vs SL Test Match Data Object Simulation / Real DOM Check
  console.log('\n--- 1. IND vs SL Test Match Output ---');
  const matchIndSl = {
    match_id: "ind-vs-sl-2nd-test-india-tour-of-sri-lanka-2026-match-updates-12WY",
    match_url: "https://crex.com/cricket-live-score/ind-vs-sl-2nd-test-india-tour-of-sri-lanka-2026-match-updates-12WY",
    series: { name: "IND vs SL, 2nd TEST, IND vs SL 2026" },
    match: { format: "Test", status: "SL trail by 213 runs", current_ball: "89.4" },
    teams: {
      home: { id: "team_ind", name: "IND", short_name: "IND" },
      away: { id: "team_sl", name: "SL", short_name: "SL" }
    },
    scoreboard: {
      batting_team: { name: "SL", score: "290", runs: 290, wickets: 10, overs: "89.4" },
      bowling_team: { name: "IND", score: "", runs: null, wickets: null, overs: "" },
      current_ball: "89.4"
    },
    current_batsmen: [
      { name: "Asitha Fernando", runs: 4, balls: 12, fours: 0, sixes: 0, sr: 33.33, is_striker: true }
    ],
    current_bowler: { name: "Jasprit Bumrah", overs: "18.4", runs: 45, wickets: 3, economy: 2.41 },
    last_ball: { ball: "89.4", value: "W", event: "wicket", isWicket: true },
    commentary: [
      { ball: "89.4", result: "W", text: "OUT! Edged and taken at first slip!", isWicket: true }
    ],
    toss: { status: "completed", winner: "IND", decision: "bat" }
  };
  const cleanIndSl = scraper.validateMatchData(matchIndSl);
  console.log(JSON.stringify(cleanIndSl, null, 2));

  // Test Case 2: ACA vs HHA Pre-Match / Toss State
  console.log('\n--- 2. ACA vs HHA Pre-Match / Toss State Output ---');
  const matchAcaHha = {
    match_id: "aca-vs-hha-t20-2026-match-updates-99ZZ",
    match_url: "https://crex.com/cricket-live-score/aca-vs-hha-t20-2026-match-updates-99ZZ",
    series: { name: "ACA vs HHA, T20 Trophy 2026" },
    match: { format: "T20", status: "ACA opt to Bat", current_ball: null },
    teams: {
      home: { id: "team_aca", name: "ACA", short_name: "ACA" },
      away: { id: "team_hha", name: "HHA", short_name: "HHA" }
    },
    scoreboard: {
      batting_team: { name: "ACA", score: "", runs: null, wickets: null, overs: "" },
      bowling_team: { name: "HHA", score: "", runs: null, wickets: null, overs: "" },
      current_ball: null
    },
    current_batsmen: [],
    current_bowler: { name: "", overs: "", runs: null, wickets: null },
    last_ball: { ball: null, value: null, event: null, isWicket: false },
    commentary: [],
    toss: { status: "completed", winner: null, decision: "bat" }
  };
  const cleanAcaHha = scraper.validateMatchData(matchAcaHha);
  console.log(JSON.stringify(cleanAcaHha, null, 2));

  // Test Case 3: Active T20 Match
  console.log('\n--- 3. Active T20 Match Output ---');
  const matchT20 = {
    match_id: "edr-vs-pd-40th-match-delhi-premier-t20-league-2026-match-updates-13C8",
    match_url: "https://crex.com/cricket-live-score/edr-vs-pd-40th-match-delhi-premier-t20-league-2026-match-updates-13C8",
    series: { name: "EDR vs PD, 40th T20, DPL 2026" },
    match: { format: "T20", status: "PD need 45 runs in 24 balls", current_ball: "16.0" },
    teams: {
      home: { id: "team_edr", name: "EDR", short_name: "EDR" },
      away: { id: "team_pd", name: "PD", short_name: "PD" }
    },
    scoreboard: {
      batting_team: { name: "PD", score: "123/4", runs: 123, wickets: 4, overs: "16.0" },
      bowling_team: { name: "EDR", score: "167/6", runs: 167, wickets: 6, overs: "20.0" },
      current_ball: "16.0"
    },
    current_batsmen: [
      { name: "Player A", runs: 34, balls: 20, fours: 3, sixes: 2, sr: 170.0, is_striker: true },
      { name: "Player B", runs: 12, balls: 8, fours: 1, sixes: 0, sr: 150.0, is_striker: false }
    ],
    current_bowler: { name: "Bowler X", overs: "3.0", runs: 28, wickets: 2, economy: 9.33 },
    last_ball: { ball: "16.0", value: "6", event: "six", isWicket: false },
    commentary: [
      { ball: "16.0", result: "6", text: "SIX! Massive hit over deep mid-wicket!", isWicket: false }
    ],
    toss: { status: "completed", winner: "EDR", decision: "bowl" }
  };
  const cleanT20 = scraper.validateMatchData(matchT20);
  console.log(JSON.stringify(cleanT20, null, 2));

  // Test Case 4: Wicket / Review State Match
  console.log('\n--- 4. Active Wicket / Review State Match Output ---');
  const matchWicket = {
    match_id: "aus-vs-eng-3rd-t20i-2026-match-updates-88AA",
    match_url: "https://crex.com/cricket-live-score/aus-vs-eng-3rd-t20i-2026-match-updates-88AA",
    series: { name: "Australia vs England T20 Series 2026" },
    match: { format: "T20", status: "Live - Wicket", current_ball: "4.3" },
    teams: {
      home: { id: "team_aus", name: "AUS", short_name: "AUS" },
      away: { id: "team_eng", name: "ENG", short_name: "ENG" }
    },
    scoreboard: {
      batting_team: { name: "AUS", score: "42/2", runs: 42, wickets: 2, overs: "4.3" },
      bowling_team: { name: "ENG", score: "", runs: null, wickets: null, overs: "" },
      current_ball: "4.3"
    },
    current_batsmen: [
      { name: "Travis Head", runs: 22, balls: 14, fours: 4, sixes: 0, sr: 157.14, is_striker: true }
    ],
    current_bowler: { name: "Jofra Archer", overs: "2.3", runs: 18, wickets: 2, economy: 7.2 },
    last_ball: { ball: "4.3", value: "W", event: "wicket", isWicket: true },
    commentary: [
      { ball: "4.3", result: "W", text: "WICKET! Clean bowled through the gate!", isWicket: true }
    ],
    toss: { status: "completed", winner: "ENG", decision: "bowl" }
  };
  const cleanWicket = scraper.validateMatchData(matchWicket);
  console.log(JSON.stringify(cleanWicket, null, 2));
}

testMatches().catch(console.error);
