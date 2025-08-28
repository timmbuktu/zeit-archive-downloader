import { program } from "commander";
import { Downloader, Fetcher, LinkAggregator, Logger } from "./src";

async function execute(opts: {
  version: string;
  authCookie: string;
  basePath: string;
  years?: string[];
  audio: boolean;
  epaper: boolean;
}) {
  const logger = new Logger(opts.basePath);
  logger.info(`Version: ${opts.version}`);
  logger.info(`Audio: ${opts.audio ? "yes" : "no"}`);
  logger.info(`Epaper: ${opts.epaper ? "yes" : "no"}`);
  logger.info(`Years: ${opts.years ? opts.years.join(", ") : "all"}`);
  logger.info(`Base path: ${opts.basePath}`);
  const fetcher = new Fetcher(logger, opts.authCookie);
  const links = await new LinkAggregator(logger, fetcher).aggregateLinks(
    opts.audio,
    opts.epaper,
    opts.years
  );
  await new Downloader(logger, fetcher, opts.basePath).download(links);
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

execute({
  version: program.version()!,
  authCookie: options.authCookie,
  basePath: options.basePath,
  years: options.years,
  audio: options.audio,
  epaper: options.epaper,
});
