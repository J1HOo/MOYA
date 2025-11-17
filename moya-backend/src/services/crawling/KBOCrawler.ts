import { BaseCrawler } from "./BaseCrawler";
import {
  TeamStanding,
  GameSchedule,
  KBOTeam,
  CrawlingResult,
} from "../../types/kbo";
import logger from "../../utils/logger";

export class KBOCrawler extends BaseCrawler {
  private readonly TEAM_MAPPING: Record<string, KBOTeam> = {
    LG: { id: "lg", name: "LG 트윈스", shortName: "LG" },
    KT: { id: "kt", name: "KT 위즈", shortName: "KT" },
    두산: { id: "doosan", name: "두산 베어스", shortName: "두산" },
    SSG: { id: "ssg", name: "SSG 랜더스", shortName: "SSG" },
    키움: { id: "kiwoom", name: "키움 히어로즈", shortName: "키움" },
    NC: { id: "nc", name: "NC 다이노스", shortName: "NC" },
    KIA: { id: "kia", name: "KIA 타이거즈", shortName: "KIA" },
    삼성: { id: "samsung", name: "삼성 라이온즈", shortName: "삼성" },
    롯데: { id: "lotte", name: "롯데 자이언츠", shortName: "롯데" },
    한화: { id: "hanwha", name: "한화 이글스", shortName: "한화" },
  };

  constructor() {
    super("https://www.koreabaseball.com");
  }

  async crawlStandings(): Promise<CrawlingResult<TeamStanding[]>> {
    return this.safeExecute(async () => {
      const url = `${this.baseUrl}/Record/TeamRank/TeamRankDaily.aspx`;
      const html = await this.fetchHtml(url);
      const $ = this.parseHtml(html);

      const standings: TeamStanding[] = [];

      $(".tData tbody tr").each((index, element) => {
        try {
          const $row = $(element);
          const cells = $row.find("td");

          if (cells.length < 10) return;

          const rank = parseInt(cells.eq(0).text().trim()) || index + 1;
          const teamName = cells.eq(1).text().trim();
          const team = this.getTeamFromName(teamName);

          if (!team) {
            logger.warn(`알 수 없는 팀명: ${teamName}`);
            return;
          }

          const games = parseInt(cells.eq(2).text().trim()) || 0;
          const wins = parseInt(cells.eq(3).text().trim()) || 0;
          const losses = parseInt(cells.eq(4).text().trim()) || 0;
          const draws = parseInt(cells.eq(5).text().trim()) || 0;
          const winRateText = cells.eq(6).text().trim();
          const winRate = parseFloat(winRateText) || 0;
          const gameBehind = cells.eq(7).text().trim() || "-";

          standings.push({
            rank,
            team,
            games,
            wins,
            losses,
            draws,
            winRate,
            gameBehind,
            recent10: "", // 별도 파싱 필요
            streak: "", // 별도 파싱 필요
            home: { wins: 0, losses: 0 }, // 별도 API에서 가져와야 함
            away: { wins: 0, losses: 0 }, // 별도 API에서 가져와야 함
            lastUpdated: new Date(),
          });
        } catch (error) {
          logger.error(`순위 데이터 파싱 오류 (row ${index}):`, error);
        }
      });

      logger.info(`팀 순위 ${standings.length}건 크롤링 완료`);
      return standings;
    });
  }

  async crawlSchedule(date: string): Promise<CrawlingResult<GameSchedule[]>> {
    return this.safeExecute(async () => {
      const formattedDate = date.replace(/-/g, "");
      const url = `${this.baseUrl}/Schedule/Schedule.aspx?seriesId=0,9,6&date=${formattedDate}`;

      const page = await this.navigateToPage(url, ".tData");

      try {
        const gameData = await page.evaluate(() => {
          const games = [];
          const rows = document.querySelectorAll(".tData tbody tr");

          rows.forEach((row, index) => {
            try {
              const cells = row.querySelectorAll("td");
              if (cells.length < 6) return;

              const time = cells[0]?.textContent?.trim() || "";
              const matchup = cells[1]?.textContent?.trim() || "";
              const stadium = cells[2]?.textContent?.trim() || "";
              const broadcast = cells[3]?.textContent?.trim() || "";

              const teams = matchup.split(/\s+vs\s+/i);
              if (teams.length !== 2) return;

              games.push({
                id: `game_${index}_${Date.now()}`,
                time,
                homeTeam: teams[0].trim(),
                awayTeam: teams[1].trim(),
                stadium,
                broadcastInfo: broadcast,
              });
            } catch (error) {
              console.error(`게임 데이터 파싱 오류:`, error);
            }
          });

          return games;
        });

        const schedule: GameSchedule[] = gameData.map((game: any) => {
          const homeTeam = this.getTeamFromName(game.homeTeam);
          const awayTeam = this.getTeamFromName(game.awayTeam);

          if (!homeTeam || !awayTeam) {
            logger.warn(`팀 매핑 실패: ${game.homeTeam} vs ${game.awayTeam}`);
          }

          return {
            id: game.id,
            date,
            time: game.time,
            homeTeam: homeTeam || {
              id: "unknown",
              name: game.homeTeam,
              shortName: game.homeTeam,
            },
            awayTeam: awayTeam || {
              id: "unknown",
              name: game.awayTeam,
              shortName: game.awayTeam,
            },
            stadium: game.stadium,
            status: "scheduled" as const,
            broadcastInfo: game.broadcastInfo,
          };
        });

        logger.info(`${date} 경기 일정 ${schedule.length}건 크롤링 완료`);
        return schedule;
      } finally {
        await page.close();
      }
    });
  }

  async crawlLiveGames(): Promise<CrawlingResult<GameSchedule[]>> {
    return this.safeExecute(async () => {
      const today = new Date().toISOString().split("T")[0];
      const url = `${this.baseUrl}/Schedule/Schedule.aspx`;

      const page = await this.navigateToPage(url, ".tData");

      try {
        const liveGames = await page.evaluate(() => {
          const games = [];
          const liveRows = document.querySelectorAll(
            ".tData tbody tr.live, .tData tbody tr.playing"
          );

          liveRows.forEach((row, index) => {
            try {
              const cells = row.querySelectorAll("td");
              const scoreText = cells[1]?.textContent || "";
              const statusText = cells[2]?.textContent || "";

              const scoreMatch = scoreText.match(
                /(\w+)\s+(\d+)\s*:\s*(\d+)\s+(\w+)\s*(.+)?/
              );

              if (scoreMatch) {
                games.push({
                  id: `live_${index}_${Date.now()}`,
                  homeTeam: scoreMatch[1],
                  homeScore: parseInt(scoreMatch[2]),
                  awayScore: parseInt(scoreMatch[3]),
                  awayTeam: scoreMatch[4],
                  inning: scoreMatch[5]?.trim() || "",
                  status: "live",
                });
              }
            } catch (error) {
              console.error("실시간 게임 파싱 오류:", error);
            }
          });

          return games;
        });

        logger.info(`실시간 경기 ${liveGames.length}건 크롤링 완료`);
        return liveGames;
      } finally {
        await page.close();
      }
    });
  }

  private getTeamFromName(name: string): KBOTeam | null {
    if (this.TEAM_MAPPING[name]) {
      return this.TEAM_MAPPING[name];
    }

    // 부분 매칭 시도
    for (const [key, team] of Object.entries(this.TEAM_MAPPING)) {
      if (name.includes(key) || key.includes(name)) {
        return team;
      }
    }

    return null;
  }

  async crawlScheduleRange(
    startDate: string,
    endDate: string
  ): Promise<CrawlingResult<GameSchedule[]>> {
    return this.safeExecute(async () => {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const allGames: GameSchedule[] = [];

      for (
        let date = new Date(start);
        date <= end;
        date.setDate(date.getDate() + 1)
      ) {
        const dateString = date.toISOString().split("T")[0];
        const result = await this.crawlSchedule(dateString);

        if (result.success && result.data) {
          allGames.push(...result.data);
        }

        await this.sleep(1000);
      }

      logger.info(`기간별 일정 총 ${allGames.length}건 크롤링 완료`);
      return allGames;
    });
  }
}
