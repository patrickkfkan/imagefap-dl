import { DownloaderOptions } from '../lib/DownloaderOptions.js';
import { pickDefined } from '../lib/utils/Misc.js';
import { LogLevel } from '../lib/utils/logging/Logger.js';
import CLIOptionValidator from './CLIOptionValidator.js';
import CommandLineParser from './CommandLineParser.js';

export interface CLIOptions extends Omit<DownloaderOptions, 'dirStructure' | 'logger' | 'saveJSON' | 'saveHTML'> {
  url: string;
  noPrompt: boolean;
  dirStructure: string;
  fullFilenames: boolean;
  noJSON: boolean;
  noHTML: boolean;
  logging: {
    level: LogLevel;
    file?: string;
  }
}

export interface CLIOptionParserEntry {
  key: string;
  value?: string;
}

export function getCLIOptions(): CLIOptions {
  const commandLineOptions = CommandLineParser.parse();

  const dirStructure = CLIOptionValidator.validateFlags(commandLineOptions.dirStructure, 'u', 'v', 'f', 'g', '-');

  const options: CLIOptions = {
    url: CLIOptionValidator.validateRequired(commandLineOptions.url, 'No target URL specified'),
    outDir: CLIOptionValidator.validateString(commandLineOptions.outDir),
    dirStructure: pickDefined(dirStructure, 'uvfg'),
    fullFilenames: CLIOptionValidator.validateBoolean(commandLineOptions.fullFilenames) || false,
    overwrite: CLIOptionValidator.validateBoolean(commandLineOptions.overwrite),
    noJSON: CLIOptionValidator.validateBoolean(commandLineOptions.noJSON) || false,
    noHTML: CLIOptionValidator.validateBoolean(commandLineOptions.noHTML) || false,
    request: {
      maxRetries: CLIOptionValidator.validateNumber(commandLineOptions?.request?.maxRetries),
      maxConcurrent: CLIOptionValidator.validateNumber(commandLineOptions?.request?.maxConcurrent),
      minTime: {
        page: CLIOptionValidator.validateNumber(commandLineOptions?.request?.minTime?.page),
        image: CLIOptionValidator.validateNumber(commandLineOptions?.request?.minTime?.image)
      }
    },
    noPrompt: CLIOptionValidator.validateBoolean(commandLineOptions.noPrompt) || false,
    logging: {
      level: CLIOptionValidator.validateString(commandLineOptions.logging?.level, 'info', 'debug', 'warn', 'error', 'none') || 'info',
      file: CLIOptionValidator.validateString(commandLineOptions.logging?.file)
    }
  };

  return options;
}
