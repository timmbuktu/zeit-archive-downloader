import {
  createLogger,
  format,
  transports,
  Logger as WinstonLogger,
} from "winston";

export class Logger {
  private logger: WinstonLogger;

  constructor(private basePath: string) {
    this.logger = createLogger({
      level: "info",
      format: format.combine(
        format.timestamp(),
        format.printf(
          ({ level, message, timestamp }) =>
            `${timestamp} ${level.toUpperCase()} ${message}`
        )
      ),
      transports: [
        new transports.File({
          filename: `${this.basePath}/zeit-archive-downloader.log`,
        }),
        new transports.Console(),
      ],
    });
  }

  public info(message: string): void {
    this.logger.info(message);
  }

  public error(message: string): void {
    this.logger.error(message);
  }
}
