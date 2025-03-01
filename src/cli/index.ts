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
import URLHelper from '../lib/utils/URLHelper.js';
import { existsSync, readFileSync } from 'fs';

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
    let parsedTarget: {
      src: 'cli' | 'file';
      urls: string[];
    } | null = null;
    try {
      options = getCLIOptions();
      const target = options.target;
      // Test if target points to a file
      if (existsSync(target)) {
        try {
          const lines = readFileSync(target, 'utf-8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
          parsedTarget = {
            src: 'file',
            urls: lines
          };
        }
        catch (error: unknown) {
          throw Error(`Error reading file "${target}": ${error instanceof Error ? error.message : error}`);
        }
      }
      else {
        // Test if target is URL
        try {
          const urlObj = new URL(target);
          parsedTarget = {
            src: 'cli',
            urls: [ urlObj.toString() ]
          };
        }
        catch (error) {
          throw Error('Target is not a file nor a valid URL');
        }
      }
      // Check validity of target URL(s)
      const targetErrors: {url: string; error: unknown}[] = [];
      for (const url of parsedTarget.urls) {
        try {
          URLHelper.getTargetTypeByURL(url);
        }
        catch (error: unknown) {
          targetErrors.push({ url, error });
        }
      }
      if (targetErrors.length > 0) {
        if (parsedTarget.src === 'cli') {
          const { url, error } = targetErrors[0];
          console.error(`Target URL "${url}" is invalid: ${error instanceof Error ? error.message : error}`);
        }
        else {
          console.error(`One or more target URLs in "${target}" is invalid:`);
          targetErrors.forEach(({url, error}) => {
            console.error(`- "${url}": ${error instanceof Error ? error.message : error}`);
          });
        }
        console.error('');
        throw Error('Invalid target');
      }
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
      dirStructure.user = false;
      dirStructure.favorites = false;
      dirStructure.folder = false;
      dirStructure.gallery = false;
    }
    else {
      dirStructure.user = options.dirStructure.includes('u');
      dirStructure.favorites = options.dirStructure.includes('v');
      dirStructure.folder = options.dirStructure.includes('f');
      dirStructure.gallery = options.dirStructure.includes('g');
    }

    // Create downloader
    let downloader;
    try {
      downloader = new ImageFapDownloader(parsedTarget.urls, {
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
