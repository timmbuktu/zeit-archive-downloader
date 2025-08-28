import fetchRetryBuilder from "fetch-retry";
import { chunk } from "lodash";
import { HTMLElement, parse } from "node-html-parser";
import { Logger } from "./logger";

const fetchRetry = fetchRetryBuilder(fetch);

export class Fetcher {
  constructor(private logger: Logger, private authCookie: string) {}

  public async fetchResponse(url: string): Promise<Response> {
    const response = await fetchRetry(url, {
      headers: [["cookie", this.authCookie]],
      retryOn: [502, 504],
    });
    if (!response.ok) {
      const message = `Could not fetch url: ${url}`;
      this.logger.error(message);
      throw new Error(message);
    }
    return response;
  }

  public async fetchHtml(url: string): Promise<HTMLElement> {
    const response = await this.fetchResponse(url);
    const html = parse(await response.text());
    return html;
  }

  public async fetchHtmlChunked(
    urls: string[],
    logInfo: string
  ): Promise<HTMLElement[]> {
    const htmls: HTMLElement[] = [];
    const urlsChunks = chunk(urls, 100);
    for (let index = 0; index < urlsChunks.length; index++) {
      const urlsChunk = urlsChunks[index];
      this.logger.info(
        `(${(index + 1)
          .toString()
          .padStart(urlsChunks.length.toString().length, "0")}/${
          urlsChunks.length
        }) ${logInfo}`
      );
      const htmlsChunk = await Promise.all(
        urlsChunk.map((url) => this.fetchHtml(url))
      );
      htmls.push(...htmlsChunk);
    }
    return htmls;
  }
}
