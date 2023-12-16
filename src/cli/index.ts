import { EOL } from 'os';
import PromptSync from 'prompt-sync';
import { CLIOptions, getCLIOptions } from './CLIOptions.js';
import CommandLineParser from './CommandLineParser.js';
import Logger, { commonLog } from '../lib/utils/logging/Logger.js';
import { PackageInfo, getPackageInfo } from '../lib/utils/PackageInfo.js';
import FileLogger from '../lib/utils/logging/FileLogger.js';
import ConsoleLogger from '../lib/utils/logging/ConsoleLogger.js';
import ChainLogger from '../lib/utils/logging/ChainLogger.js';
import ImageFapDownloader from '../lib/ImageFapDownloader.js';
import path from 'path';
import { DownloaderOptions } from '../lib/DownloaderOptions.js';

export default class ImageFapDownloaderCLI {

  #logger: Logger | null;
  #packageInfo: PackageInfo;

  constructor() {
    this.#logger = null;
    this.#packageInfo = getPackageInfo();
  }

  async start() {
    if (CommandLineParser.showUsage()) {
      return this.exit(0);
    }

    if (this.#packageInfo.banner) {
      console.log(`${EOL}${this.#packageInfo.banner}${EOL}`);
    }

    let options;
    try {
      options = getCLIOptions();
    }
    catch (error) {
      console.error(
        'Error processing options: ',
        error instanceof Error ? error.message : error,
        EOL,
        'See usage with \'-h\' option.');
      return this.exit(1);
    }

    const { chainLogger: logger, fileLogger } = this.#createLoggers(options);
    this.#logger = logger;

    const dirStructure: DownloaderOptions['dirStructure'] = {};
    if (options.dirStructure.includes('-')) {
      dirStructure.uploader = false;
      dirStructure.folder = false;
      dirStructure.gallery = false;
    }
    else {
      dirStructure.uploader = options.dirStructure.includes('u');
      dirStructure.folder = options.dirStructure.includes('f');
      dirStructure.gallery = options.dirStructure.includes('g');
    }

    // Create downloader
    let downloader;
    try {
      downloader = new ImageFapDownloader(options.url, {
        ...options,
        dirStructure,
        logger,
        saveJSON: !options.noJSON,
        saveHTML: !options.noHTML
      });
    }
    catch (error) {
      commonLog(logger, 'error', null, 'Failed to get downloader instance:', error);
      return this.exit(1);
    }

    if (!downloader) {
      commonLog(logger, 'error', null, 'Failed to get downloader instance (unknown reason)');
      return this.exit(1);
    }

    const downloaderName = downloader.name;

    if (!options.noPrompt) {
      if (options.logging.level === 'none') {
        console.log('Logging disabled', EOL);
      }
      else {
        console.log(`Log level: ${options.logging.level}`);
        if (fileLogger) {
          console.log(`Log file: ${fileLogger.getConfig().logFilePath}`);
          console.log(EOL);
        }
      }

      console.log(`Created ${downloaderName} instance with config: `, downloader.getConfig(), EOL);

      if (!this.#confirmProceed()) {
        console.log('Abort');
        return this.exit(1);
      }
    }
    else {
      commonLog(logger, 'debug', null, `Created ${downloaderName} instance with config: `, downloader.getConfig());
    }

    try {
      const abortController = new AbortController();
      process.on('SIGINT', () => {
        abortController.abort();
      });
      await downloader.start({ signal: abortController.signal });
      // Return this.exit(hasDownloaderError ? 1 : 0);

    }
    catch (error) {
      commonLog(logger, 'error', null, `Uncaught ${downloaderName} error:`, error);
      return this.exit(1);
    }
  }

  #confirmProceed(prompt?: PromptSync.Prompt): boolean {
    if (!prompt) {
      prompt = PromptSync({ sigint: true });
    }
    const confirmProceed = prompt('Proceed (Y/n)? ');
    if (!confirmProceed.trim() || confirmProceed.trim().toLowerCase() === 'y') {
      return true;
    }
    else if (confirmProceed.trim().toLowerCase() === 'n') {
      return false;
    }

    return this.#confirmProceed(prompt);
  }

  #createLoggers(options: CLIOptions) {
    // Create console logger
    const consoleLogger = new ConsoleLogger({
      logLevel: options.logging.level
    });

    // Create file logger
    let fileLogger: FileLogger | undefined;
    if (options.logging.file) {
      try {
        fileLogger = new FileLogger({
          logFilePath: path.resolve(options.logging.file),
          logLevel: options.logging.level
        });
      }
      catch (error) {
        console.warn('Failed to create file logger: ', error instanceof Error ? error.message : error);
      }
    }

    // Create chain logger
    const chainLogger = new ChainLogger([ consoleLogger ]);
    if (fileLogger) {
      chainLogger.add(fileLogger);
    }

    return {
      chainLogger,
      consoleLogger,
      fileLogger
    };
  }

  async exit(code?: number) {
    if (this.#logger) {
      await this.#logger.end();
    }
    process.exit(code);
  }
}
