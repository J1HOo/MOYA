export interface KBOTeam {
  id: string;
  name: string;
  shortName: string;
  logo?: string;
}

export interface TeamStanding {
  rank: number;
  team: KBOTeam;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  gameBehind: string;
  recent10: string;
  streak: string;
  home: {
    wins: number;
    losses: number;
  };
  away: {
    wins: number;
    losses: number;
  };
  lastUpdated: Date;
}

export interface GameSchedule {
  id: string;
  date: string;
  time: string;
  homeTeam: KBOTeam;
  awayTeam: KBOTeam;
  stadium: string;
  status: "scheduled" | "live" | "finished" | "postponed" | "canceled";
  homeScore?: number;
  awayScore?: number;
  inning?: string;
  broadcastInfo?: string;
}

export interface GameResult extends GameSchedule {
  finalScore: {
    home: number;
    away: number;
  };
  highlights?: string[];
  boxScore?: any; // 상세 박스 스코어는 나중에 정의
}

export interface CrawlingResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
  source: string;
}

export interface CacheItem<T> {
  data: T;
  timestamp: number;
  expires: number;
}
