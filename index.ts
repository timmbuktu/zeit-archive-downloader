import { program } from "commander";
import contentDisposition from "content-disposition";
import fetchRetryBuilder from "fetch-retry";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import { chunk } from "lodash";
import { HTMLElement, parse } from "node-html-parser";
import { basename } from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";

const fetchRetry = fetchRetryBuilder(fetch);

interface DownloaderOptions {
  authCookie: string;
  basePath: string;
  years?: string[];
}

interface AudioDownloadItem {
  url: string;
  year: string;
  edition: string;
}

async function fetchResponse(opts: {
  url: string;
  authCookie: string;
}): Promise<Response> {
  const response = await fetchRetry(opts.url, {
    headers: [["cookie", opts.authCookie]],
    retryOn: [502, 504],
  });
  if (!response.ok) {
    throw new Error(`Could not fetch url: ${opts.url}`);
  }
  return response;
}

async function fetchHtml(opts: {
  url: string;
  authCookie: string;
}): Promise<HTMLElement> {
  const response = await fetchResponse(opts);
  const html = parse(await response.text());
  return html;
}

async function fetchHtmlChunked(opts: {
  urls: string[];
  logInfo: string;
  authCookie: string;
}): Promise<HTMLElement[]> {
  const htmls: HTMLElement[] = [];
  const urlsChunks = chunk(opts.urls, 100);
  for (let index = 0; index < urlsChunks.length; index++) {
    const urlsChunk = urlsChunks[index];
    console.log(`${opts.logInfo} (chunk ${index + 1} of ${urlsChunks.length})`);
    const htmlsChunk = await Promise.all(
      urlsChunk.map((url) => fetchHtml({ url, authCookie: opts.authCookie }))
    );
    htmls.push(...htmlsChunk);
  }
  return htmls;
}

async function downloadFile(opts: {
  index: number;
  count: number;
  response: Response;
  year: string;
  edition: string;
  basePath: string;
}): Promise<void> {
  const contentDispositionHeader = opts.response.headers.get(
    "content-disposition"
  );
  const filename = contentDispositionHeader
    ? contentDisposition.parse(contentDispositionHeader).parameters["filename"]
    : basename(opts.response.url);
  if (!filename) {
    throw new Error("Could not identify filename");
  }
  const directory = `${opts.basePath}/${opts.year}/${opts.edition}`;
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
  const path = `${directory}/${filename}`;
  if (existsSync(path)) {
    console.log(
      `(${opts.index.toString().padStart(opts.count.toString().length, "0")}/${
        opts.count
      }) File already found: ${path}`
    );
  } else {
    console.log(
      `(${opts.index.toString().padStart(opts.count.toString().length, "0")}/${
        opts.count
      }) Downloading file: ${path}`
    );
    const fileStream = createWriteStream(path, { flags: "wx" });
    await finished(
      Readable.fromWeb(opts.response.body as any).pipe(fileStream)
    );
  }
}

class AudioDownloader {
  private baseUrl = "https://premium.zeit.de";

  constructor(private opts: DownloaderOptions) {}

  public async execute(): Promise<void> {
    const maxPage = await this.identifyMaxPage();
    const downloadItems = await this.collectDownloadItems(maxPage);
    console.log("Starting audio download");
    await this.downloadAll(downloadItems);
  }

  private async identifyMaxPage(): Promise<number> {
    const url = `${this.baseUrl}/abo/zeit-audio`;
    const html = await fetchHtml({ url, authCookie: this.opts.authCookie });
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

  private async collectDownloadItems(
    maxPage: number
  ): Promise<AudioDownloadItem[]> {
    const urls = [`${this.baseUrl}/abo/zeit-audio`].concat(
      Array(maxPage)
        .fill(1)
        .map(
          (value, index) => `${this.baseUrl}/abo/zeit-audio?page=${index + 1}`
        )
    );
    const htmls = await fetchHtmlChunked({
      urls,
      logInfo: "Fetching audio information",
      authCookie: this.opts.authCookie,
    });
    return htmls
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
              year: attributes["Jahr"].padStart(2, "0"),
              edition: attributes["Ausgabe"],
            };
          })
      )
      .filter(
        (item) => !this.opts.years || this.opts.years.includes(item.year)
      );
  }

  private async downloadAll(downloadItems: AudioDownloadItem[]): Promise<void> {
    for (let index = 0; index < downloadItems.length; index++) {
      const item = downloadItems[index];
      const response = await fetchResponse({
        url: item.url,
        authCookie: this.opts.authCookie,
      });
      await downloadFile({
        index: index + 1,
        count: downloadItems.length,
        response,
        year: item.year,
        edition: item.edition,
        basePath: this.opts.basePath,
      });
    }
  }
}

interface EpaperRanges {
  years: string[];
  editions: string[];
}

interface EPaperDownloadItem {
  urls: string[];
  year: string;
  edition: string;
}

class EPaperDownloader {
  private baseUrl = "https://epaper.zeit.de";

  constructor(private opts: DownloaderOptions) {}

  public async execute(): Promise<void> {
    const ranges: EpaperRanges = await this.identifyRanges();
    const downloadItems = await this.collectDownloadItems(ranges);
    console.log("Starting epaper download");
    await this.downloadAll(downloadItems);
  }

  private async identifyRanges(): Promise<EpaperRanges> {
    const url = `${this.baseUrl}/abo/diezeit`;
    const html = await fetchHtml({ url, authCookie: this.opts.authCookie });
    const years: string[] =
      html
        .querySelector("select#year")
        ?.children.map((option) => option.getAttribute("value"))
        .filter((item) => item !== undefined)
        .filter((item) => !this.opts.years || this.opts.years.includes(item)) ??
      [];
    const editions: string[] =
      html
        .querySelector("select#issue")
        ?.children.map((option) => option.getAttribute("value"))
        .filter((item) => item !== undefined) ?? [];
    return { years, editions };
  }

  private async collectDownloadItems(
    ranges: EpaperRanges
  ): Promise<EPaperDownloadItem[]> {
    const searchUrls = ranges.years.flatMap((year) =>
      ranges.editions.map(
        (edition) =>
          `${this.baseUrl}/abo/diezeit?title=diezeit&issue=${edition}&year=${year}`
      )
    );
    const searchHtmls = await fetchHtmlChunked({
      urls: searchUrls,
      logInfo: "Searching epaper information",
      authCookie: this.opts.authCookie,
    });
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
    const epaperHtmls = await fetchHtmlChunked({
      urls: epaperUrls,
      logInfo: "Fetching epaper information",
      authCookie: this.opts.authCookie,
    });
    return epaperHtmls.map((html) => {
      const teaser = html
        .querySelector(".article-teaser-issue")
        ?.text.trim()
        .substring(9, 16)
        .split("/");
      if (!teaser) {
        throw new Error("Could not identify year and edition");
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

  private async downloadAll(
    downloadItems: EPaperDownloadItem[]
  ): Promise<void> {
    const count = downloadItems.flatMap((item) => item.urls).length;
    let index = 0;
    for (const item of downloadItems) {
      for (const url of item.urls) {
        index++;
        const response = await fetchResponse({
          url,
          authCookie: this.opts.authCookie,
        });
        await downloadFile({
          index,
          count,
          response,
          year: item.year,
          edition: item.edition,
          basePath: this.opts.basePath,
        });
      }
    }
  }
}

async function execute(
  opts: DownloaderOptions,
  switches: { audio: boolean; epaper: boolean }
) {
  if (switches.audio) {
    await new AudioDownloader(opts).execute();
  } else {
    console.log("Skipping audio download");
  }
  if (switches.epaper) {
    await new EPaperDownloader(opts).execute();
  } else {
    console.log("Skipping epaper download");
  }
}

program
  .version("1.0.0")
  .description("ZEIT archive downloader")
  .requiredOption("-a, --auth-cookie <string>")
  .requiredOption("-b, --base-path <string>")
  .option("-y, --years <string...>")
  .option("--no-audio")
  .option("--no-epaper");
program.parse(process.argv);
const options = program.opts();

execute(
  {
    authCookie: options.authCookie,
    basePath: options.basePath,
    years: options.years,
  },
  { audio: options.audio, epaper: options.epaper }
);
