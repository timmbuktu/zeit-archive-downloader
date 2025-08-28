import { groupBy } from "lodash";
import { Links } from "./interfaces";
import { Fetcher, Logger } from "./util";

export class AudioLinkAggregator {
  private baseUrl = "https://premium.zeit.de";

  constructor(private logger: Logger, private fetcher: Fetcher) {}

  public async aggregateAudioLinks(years: string[]): Promise<Links[]> {
    const maxPage = await this.identifyMaxPage();
    return await this.collectAudioLinks(maxPage, years);
  }

  private async identifyMaxPage(): Promise<number> {
    const url = `${this.baseUrl}/abo/zeit-audio`;
    const html = await this.fetcher.fetchHtml(url);
    const maxPageHref =
      html.querySelectorAll(".pager__page").at(-1)?.children[0].attributes[
        "href"
      ] ?? "";
    const maxPageParam = new URL(maxPageHref, this.baseUrl).searchParams.get(
      "page"
    );
    const maxPage = parseInt(maxPageParam ?? "", 10);
    return maxPage;
  }

  private async collectAudioLinks(
    maxPage: number,
    years: string[]
  ): Promise<Links[]> {
    const urls = [`${this.baseUrl}/abo/zeit-audio`].concat(
      Array(maxPage)
        .fill(1)
        .map(
          (value, index) => `${this.baseUrl}/abo/zeit-audio?page=${index + 1}`
        )
    );
    const htmls = await this.fetcher.fetchHtmlChunked(
      urls,
      "Fetching audio information"
    );
    return Object.values(
      groupBy(
        htmls
          .flatMap((html) =>
            html
              .querySelectorAll("[href^=https://media-delivery.zeit.de/]")
              .map((item) => {
                const attributes = item.parentNode.parentNode.children
                  .map((node) => {
                    if (
                      node.children.length &&
                      node.children[0].tagName === "STRONG"
                    ) {
                      return [
                        node.children[0].text.trim().replace(":", ""),
                        node.lastChild?.text.trim(),
                      ];
                    }
                    return [];
                  })
                  .filter(
                    (attribute) =>
                      attribute.length > 0 && attribute[0] !== "MP3 Download"
                  )
                  .reduce(
                    (obj, value) =>
                      Object.assign(obj, { [value[0] ?? ""]: value[1] }),
                    {}
                  );
                return {
                  url: item.attributes["href"],
                  year: attributes["Jahr"],
                  edition: attributes["Ausgabe"].padStart(2, "0"),
                };
              })
          )
          .filter((item) => years.includes(item.year)),
        (item) => `${item.year}-${item.edition}`
      )
    ).map((value) => ({
      year: value[0].year,
      edition: value[0].edition,
      urls: value.flatMap((links) => links.url),
    }));
  }
}
