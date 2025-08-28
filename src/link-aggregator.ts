import { groupBy } from "lodash";
import { AudioLinkAggregator } from "./audio-link-aggregator";
import { EpaperLinkAggregator } from "./epaper-link-aggregator";
import { Links } from "./interfaces";
import { Fetcher, Logger } from "./util";

export class LinkAggregator {
  constructor(private logger: Logger, private fetcher: Fetcher) {}

  public async aggregateLinks(
    audio: boolean,
    epaper: boolean,
    years: string[] = []
  ): Promise<Links[]> {
    if (!audio) {
      this.logger.info("Skipping audio download");
    }
    const audioLinks = audio
      ? await new AudioLinkAggregator(
          this.logger,
          this.fetcher
        ).aggregateAudioLinks(years)
      : [];
    if (!epaper) {
      this.logger.info("Skipping epaper download");
    }
    const epaperLinks = epaper
      ? await new EpaperLinkAggregator(
          this.logger,
          this.fetcher
        ).aggregateEpaperLinks(years)
      : [];
    return Object.values(
      groupBy(
        [audioLinks, epaperLinks].flat(),
        (links) => `${links.year}-${links.edition}`
      )
    )
      .map((value) => ({
        year: value[0].year,
        edition: value[0].edition,
        urls: value.flatMap((links) => links.urls),
      }))
      .sort(
        (a, b) =>
          parseInt(b.year) +
          parseInt(b.edition) / 1000 -
          (parseInt(a.year) + parseInt(a.edition) / 1000)
      );
  }
}
