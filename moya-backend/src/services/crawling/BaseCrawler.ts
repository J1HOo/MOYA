import puppeteer, { Browser, Page } from "puppeteer";
import axios, { AxiosRequestConfig } from "axios";
import * as cheerio from "cheerio";
import logger from "../../utils/logger";
import { CrawlingResult } from "../../types/kbo";

export abstract class BaseCrawler {
  protected browser?: Browser;
  protected userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  constructor(protected baseUrl: string) {}

  async initBrowser(): Promise<void> {
    if (this.browser) return;

    try {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--single-process",
          "--disable-gpu",
        ],
      });
      logger.info("Puppeteer 브라우저 초기화 완료");
    } catch (error) {
      logger.error("브라우저 초기화 실패:", error);
      throw error;
    }
  }

  async createPage(): Promise<Page> {
    if (!this.browser) {
      await this.initBrowser();
    }

    const page = await this.browser!.newPage();
    await page.setUserAgent(this.userAgent);
    await page.setViewport({ width: 1920, height: 1080 });

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    return page;
  }

  async fetchHtml(url: string, config?: AxiosRequestConfig): Promise<string> {
    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent": this.userAgent,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.8,en-US;q=0.5,en;q=0.3",
          "Accept-Encoding": "gzip, deflate",
          Connection: "keep-alive",
        },
        timeout: 10000,
        ...config,
      });

      return response.data;
    } catch (error) {
      logger.error(`HTTP 요청 실패 [${url}]:`, error);
      throw error;
    }
  }

  parseHtml(html: string): cheerio.CheerioAPI {
    return cheerio.load(html);
  }

  async navigateToPage(url: string, waitForSelector?: string): Promise<Page> {
    const page = await this.createPage();

    try {
      await page.goto(url, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      if (waitForSelector) {
        await page.waitForSelector(waitForSelector, { timeout: 10000 });
      }

      return page;
    } catch (error) {
      await page.close();
      logger.error(`페이지 로드 실패 [${url}]:`, error);
      throw error;
    }
  }

  async safeExecute<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<CrawlingResult<T>> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const data = await operation();
        return {
          success: true,
          data,
          timestamp: new Date(),
          source: this.baseUrl,
        };
      } catch (error) {
        logger.warn(`크롤링 시도 ${attempt}/${maxRetries} 실패:`, error);

        if (attempt === maxRetries) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "알 수 없는 오류",
            timestamp: new Date(),
            source: this.baseUrl,
          };
        }

        await this.sleep(delay * attempt);
      }
    }

    return {
      success: false,
      error: "최대 재시도 횟수 초과",
      timestamp: new Date(),
      source: this.baseUrl,
    };
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = undefined;
      logger.info("브라우저 정리 완료");
    }
  }

  async destroy(): Promise<void> {
    await this.cleanup();
  }
}
