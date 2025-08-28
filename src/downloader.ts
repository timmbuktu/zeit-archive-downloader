import contentDisposition from "content-disposition";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import { basename, parse } from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";
import { DownloadJob, Links } from "./interfaces";
import { Fetcher, Logger } from "./util";

export class Downloader {
  private totalCount = 0;
  private currentIndex = 0;

  constructor(
    private logger: Logger,
    private fetcher: Fetcher,
    private basePath: string
  ) {}

  public async download(links: Links[]) {
    this.totalCount = links.flatMap((item) => item.urls).length;
    this.currentIndex = 1;
    for (const link of links) {
      await this.downloadEdition(link.year, link.edition, link.urls);
    }
  }

  private async downloadEdition(
    year: string,
    edition: string,
    urls: string[]
  ): Promise<void> {
    const jobs = await this.collectDownloadJobs(year, edition, urls);
    for (const job of jobs) {
      await this.downloadFile(job);
    }
  }

  private async collectDownloadJobs(
    year: string,
    edition: string,
    urls: string[]
  ): Promise<DownloadJob[]> {
    this.logger.info(`Collecting filenames for edition ${year}/${edition}`);
    const responses: Response[] = await Promise.all(
      urls.map((url) => this.fetcher.fetchResponse(url))
    );
    const filenames = responses.map((response) =>
      this.identifyFilename(response)
    );
    this.unifyFilenames(filenames);
    return responses.map((response, index) => ({
      response,
      filename: filenames[index],
      directory: `${this.basePath}/${year}/${edition}`,
    }));
  }

  private identifyFilename(response: Response): string {
    const contentDispositionHeader = response.headers.get(
      "content-disposition"
    );
    const filename = contentDispositionHeader
      ? contentDisposition.parse(contentDispositionHeader).parameters[
          "filename"
        ]
      : basename(response.url);
    if (!filename) {
      const message = "Could not identify filename";
      this.logger.error(message);
      throw new Error(message);
    }
    return filename;
  }

  private unifyFilenames(filenames: string[]) {
    for (let i = 0; i < filenames.length; i++) {
      let hitCount = 1;
      for (let j = i + 1; j < filenames.length; j++) {
        if (filenames[i] === filenames[j]) {
          filenames[j] = `${parse(filenames[j]).name}-${hitCount}${
            parse(filenames[j]).ext
          }}`;
          hitCount++;
        }
      }
    }
  }

  private async downloadFile(job: DownloadJob) {
    if (!existsSync(job.directory)) {
      mkdirSync(job.directory, { recursive: true });
    }
    const path = `${job.directory}/${job.filename}`;
    const counter = `(${this.currentIndex
      .toString()
      .padStart(this.totalCount.toString().length, "0")}/${this.totalCount})`;
    if (existsSync(path)) {
      this.logger.info(`${counter} File already found: ${path}`);
    } else {
      this.logger.info(`${counter} Downloading file: ${path}`);
      const fileStream = createWriteStream(path, { flags: "wx" });
      await finished(
        Readable.fromWeb(job.response.body as any).pipe(fileStream)
      );
    }
    this.currentIndex++;
  }
}
