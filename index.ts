import { program } from "commander";
import contentDisposition from "content-disposition";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import { parse } from "node-html-parser";
import { Readable } from "stream";
import { finished } from "stream/promises";

interface AudioDownloaderOptions {
  authCookie: string;
  basePath: string;
}

interface AudioDownloadItem {
  url: string;
  year: string;
  edition: string;
}

class AudioDownloader {
  private baseUrl = "https://premium.zeit.de";

  constructor(private opts: AudioDownloaderOptions) {}

  public async execute(): Promise<void> {
    const maxPage = await this.identifyMaxPage();
    const downloadItems = await this.collectDownloadItems(maxPage);
    await this.downloadAll(downloadItems);
  }

  private async identifyMaxPage(): Promise<number> {
    const url = `${this.baseUrl}/abo/zeit-audio`;
    console.log(`Fetching audio page: ${url}`);
    const response = await fetch(url, {
      headers: [["cookie", this.opts.authCookie]],
    });
    if (!response.ok) {
      throw new Error(`Could not fetch url`);
    }
    const html = parse(await response.text());
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
    const pages = [`${this.baseUrl}/abo/zeit-audio`].concat(
      Array(maxPage)
        .fill(1)
        .map(
          (value, index) => `${this.baseUrl}/abo/zeit-audio?page=${index + 1}`
        )
    );
    const downloadItems: AudioDownloadItem[] = [];
    for (const page of pages) {
      console.log(`Fetching audio page: ${page}`);
      const response = await fetch(page, {
        headers: [["cookie", this.opts.authCookie]],
      });
      if (!response.ok) {
        throw new Error(`Could not fetch url`);
      }
      const html = parse(await response.text());
      downloadItems.push(
        ...html
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
              .filter((item) => item.length > 0 && item[0] !== "MP3 Download")
              .reduce(
                (obj, value) =>
                  Object.assign(obj, { [value[0] ?? ""]: value[1] }),
                {}
              );
            return {
              url: item.attributes["href"],
              year: attributes["Jahr"],
              edition: attributes["Ausgabe"],
            };
          })
      );
    }
    return downloadItems;
  }

  private async downloadAll(downloadItems: AudioDownloadItem[]): Promise<void> {
    for (const item of downloadItems) {
      console.log(`Fetching audio file information: ${item.url}`);
      const response = await fetch(item.url, {
        headers: [["cookie", this.opts.authCookie]],
      });
      if (!response.ok) {
        throw new Error(`Could not fetch url`);
      }
      const filename = contentDisposition.parse(
        response.headers.get("content-disposition") ?? ""
      ).parameters["filename"];
      if (!filename) {
        throw new Error("Could not identify filename");
      }
      const directory = `${this.opts.basePath}/${item.year}/${item.edition}`;
      if (!existsSync(directory)) {
        mkdirSync(directory, { recursive: true });
      }
      const path = `${directory}/${filename}`;
      if (existsSync(path)) {
        console.log(`Audio file already found: ${path}`);
      } else {
        console.log(`Downloading audio file: ${path}`);
        const fileStream = createWriteStream(path, { flags: "wx" });
        await finished(Readable.fromWeb(response.body as any).pipe(fileStream));
      }
    }
  }
}

async function execute(opts: AudioDownloaderOptions) {
  await new AudioDownloader(opts).execute();
}

program
  .version("1.0.0")
  .description("ZEIT archive downloader")
  .requiredOption("-a, --auth-cookie <string>")
  .requiredOption("-b, --base-path <string>");
program.parse(process.argv);
const options = program.opts();

execute({ authCookie: options.authCookie, basePath: options.basePath });
