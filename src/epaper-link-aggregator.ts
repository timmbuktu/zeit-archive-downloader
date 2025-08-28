import { EpaperRanges, Links } from "./interfaces";
import { Fetcher, Logger } from "./util";

export class EpaperLinkAggregator {
  private baseUrl = "https://epaper.zeit.de";

  constructor(private logger: Logger, private fetcher: Fetcher) {}

  public async aggregateEpaperLinks(years: string[]): Promise<Links[]> {
    const ranges: EpaperRanges = await this.identifyRanges(years);
    return await this.collectEpaperLinks(ranges);
  }

  private async identifyRanges(years: string[]): Promise<EpaperRanges> {
    const url = `${this.baseUrl}/abo/diezeit`;
    const html = await this.fetcher.fetchHtml(url);
    return {
      years:
        html
          .querySelector("select#year")
          ?.children.map((option) => option.getAttribute("value"))
          .filter((item) => item !== undefined)
          .filter((item) => !!item)
          .filter((item) => years.length === 0 || years.includes(item)) ?? [],
      editions:
        html
          .querySelector("select#issue")
          ?.children.map((option) => option.getAttribute("value"))
          .filter((item) => item !== undefined)
          .filter((item) => !!item) ?? [],
    };
  }

  private async collectEpaperLinks(ranges: EpaperRanges): Promise<Links[]> {
    const searchUrls = ranges.years.flatMap((year) =>
      ranges.editions.map(
        (edition) =>
          `${this.baseUrl}/abo/diezeit?title=diezeit&issue=${edition}&year=${year}`
      )
    );
    const searchHtmls = await this.fetcher.fetchHtmlChunked(
      searchUrls,
      "Searching epaper information"
    );
    const epaperUrls = searchHtmls
      .map((html) =>
        html
          .querySelectorAll(
            ".archives-filter-results .epaper-cover a[href^=/abo/diezeit]"
          )
          .at(0)
          ?.getAttribute("href")
      )
      .filter((item) => item !== undefined)
      .map((item) => `${this.baseUrl}${item}`);
    const epaperHtmls = await this.fetcher.fetchHtmlChunked(
      epaperUrls,
      "Fetching epaper information"
    );
    return epaperHtmls.map((html) => {
      const teaser = html
        .querySelector(".article-teaser-issue")
        ?.text.trim()
        .substring(9, 16)
        .split("/");
      if (!teaser) {
        const message = "Could not identify year and edition";
        this.logger.error(message);
        throw new Error(message);
      }
      return {
        urls: [
          ...html
            .querySelectorAll("a.epaper-info-filesize[href^=/download]")
            .map((item) => item.getAttribute("href"))
            .filter((item) => item !== undefined)
            .map((item) => `${this.baseUrl}${item}`),
          html
            .querySelector("[href^=https://media-delivery.zeit.de/]")
            ?.getAttribute("href"),
        ].filter((item) => item !== undefined),
        year: teaser[1],
        edition: teaser[0],
      };
    });
  }
}
