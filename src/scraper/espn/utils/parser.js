// src/scraper/espn/utils/parser.js

class Parser {
  // ============================================================
  // EXTRACT TEAMS FROM TEXT
  // ============================================================
  static extractTeamsFromText(text) {
    let team1 = '';
    let team2 = '';
    const cleanText = text.replace(/\s+/g, ' ').trim();

    // Try to find "Team vs Team" pattern
    const vsMatch = cleanText.match(/([A-Za-z\s]+?)\s+vs\s+([A-Za-z\s]+?)(?:\s|$)/i);
    if (vsMatch) {
      const t1 = vsMatch[1].trim();
      const t2 = vsMatch[2].trim();
      if (t1 && t2 && t1.length > 2 && t2.length > 2) {
        team1 = this.cleanTeamName(t1);
        team2 = this.cleanTeamName(t2);
        if (team1 && team2) {
          return { team1, team2 };
        }
      }
    }

    // Try to extract team names with scores
    const scorePattern = /([A-Za-z][A-Za-z\s]+?)\s+(\d+[\/-]\d+|\d+)\s*(?:\(|ov|$)/gi;
    let scoreMatches = [];
    let match;
    while ((match = scorePattern.exec(cleanText)) !== null) {
      const team = this.cleanTeamName(match[1].trim());
      if (team && team.length > 2) {
        scoreMatches.push(team);
      }
    }

    scoreMatches = [...new Set(scoreMatches)];
    
    if (scoreMatches.length >= 2) {
      team1 = scoreMatches[0];
      team2 = scoreMatches[1];
      return { team1, team2 };
    }

    // Try to extract from result text
    const resultMatch = cleanText.match(/([A-Za-z][A-Za-z\s]+?)\s+won by/i);
    if (resultMatch) {
      const winner = this.cleanTeamName(resultMatch[1].trim());
      if (winner && winner.length > 2) {
        const otherMatch = cleanText.match(/([A-Za-z][A-Za-z\s]+?)\s+\d+[\/-]\d+/);
        if (otherMatch) {
          const otherTeam = this.cleanTeamName(otherMatch[1].trim());
          if (otherTeam && otherTeam !== winner && otherTeam.length > 2) {
            team1 = winner;
            team2 = otherTeam;
            return { team1, team2 };
          }
        }
      }
    }

    return { team1, team2 };
  }

  // ============================================================
  // CLEAN TEAM NAME
  // ============================================================
  static cleanTeamName(name) {
    if (!name) return '';
    let cleaned = name.replace(/[()\-:]/g, '').trim();
    cleaned = cleaned.replace(/\s+vs\s+/i, ' ').trim();
    cleaned = cleaned.replace(/\s+Women$/, '').trim();
    cleaned = cleaned.replace(/\s+Men$/, '').trim();
    cleaned = cleaned.replace(/\s+XI$/, '').trim();
    return cleaned;
  }

  // ============================================================
  // EXTRACT RESULT FROM TEXT
  // ============================================================
  static extractResultFromText(text) {
    const result = {
      winner: '',
      margin: '',
      method: ''
    };

    const winMatch = text.match(/(.+?)\s+won by\s+([\d\s]+(?:runs|wickets|runs \(DLS method\)|wickets \(DLS method\)|an innings))/i);
    if (winMatch) {
      result.winner = winMatch[1].trim();
      result.margin = winMatch[2].trim();
      result.method = 'Normal';
      if (winMatch[2].includes('DLS')) {
        result.method = 'DLS';
      } else if (winMatch[2].includes('an innings')) {
        result.method = 'Innings';
      }
      return result;
    }

    const simpleWin = text.match(/(.+?)\s+won\s+(?:(?:the\s+)?match)/i);
    if (simpleWin) {
      result.winner = simpleWin[1].trim();
      result.margin = '';
      result.method = 'Normal';
      return result;
    }

    if (text.toLowerCase().includes('match tied') || text.toLowerCase().includes('tied')) {
      result.winner = 'Match Tied';
      result.margin = '';
      result.method = 'Tied';
      return result;
    }

    if (text.toLowerCase().includes('drawn')) {
      result.winner = 'Match Drawn';
      result.margin = '';
      result.method = 'Drawn';
      return result;
    }

    return result;
  }

  // ============================================================
  // CHECK IF MATCH IS COMPLETED
  // ============================================================
  static isCompletedMatch(text) {
    const indicators = ['won by', 'won', 'drawn', 'tied', 'runs', 'wickets', 'super over', 'match tied'];
    const lower = text.toLowerCase();
    return indicators.some(ind => lower.includes(ind));
  }

  // ============================================================
  // CHECK IF MATCH IS UPCOMING
  // ============================================================
  static isUpcomingMatch(text) {
    const indicators = [
      'scheduled to begin', 'match scheduled', 'starts at', 'match begins',
      'scheduled', 'to begin', 'will begin', 'begin at'
    ];
    const lower = text.toLowerCase();
    return indicators.some(ind => lower.includes(ind));
  }

  // ============================================================
  // CHECK IF MATCH IS ABANDONED
  // ============================================================
  static isAbandonedMatch(text) {
    const indicators = ['abandoned', 'no result', 'cancelled', 'postponed', 'called off'];
    const lower = text.toLowerCase();
    return indicators.some(ind => lower.includes(ind));
  }

  // ============================================================
  // DETECT MATCH FORMAT
  // ============================================================
  static detectFormat(text) {
    const formats = {
      'Test': ['test match', 'test'],
      'ODI': ['odi', 'one-day'],
      'T20': ['t20', 'twenty20'],
      'The Hundred': ['the hundred', 'hundred'],
      'T10': ['t10'],
      'First Class': ['first class', 'first-class'],
      'List A': ['list a']
    };

    const lower = text.toLowerCase();
    for (const [format, keywords] of Object.entries(formats)) {
      if (keywords.some(keyword => lower.includes(keyword))) {
        return format;
      }
    }
    return 'T20'; // Default
  }
}

module.exports = Parser;