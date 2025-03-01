import { DownloaderOptions } from '../lib/DownloaderOptions.js';
import { pickDefined } from '../lib/utils/Misc.js';
import { LogLevel } from '../lib/utils/logging/Logger.js';
import CLIOptionValidator from './CLIOptionValidator.js';
import CommandLineParser, { CommandLineParseResult } from './CommandLineParser.js';

export interface CLIOptions extends Omit<DownloaderOptions, 'dirStructure' | 'logger' | 'saveJSON' | 'saveHTML'> {
  target: string;
  noPrompt: boolean;
  dirStructure: string;
  seqFilenames: boolean;
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

function getProxyOptions(commandLineOptions?: CommandLineParseResult | null) {
  if (commandLineOptions?.request?.proxy && commandLineOptions.request.proxy.url?.value?.trim()) {
    return {
      url: CLIOptionValidator.validateProxyURL(commandLineOptions.request.proxy.url),
      rejectUnauthorizedTLS: CLIOptionValidator.validateBoolean(commandLineOptions.request.proxy.rejectUnauthorizedTLS)
    };
  }
  return null;
}

export function getCLIOptions(): CLIOptions {
  const commandLineOptions = CommandLineParser.parse();

  const dirStructure = CLIOptionValidator.validateFlags(commandLineOptions.dirStructure, 'u', 'v', 'f', 'g', '-');

  const options: CLIOptions = {
    target: CLIOptionValidator.validateRequired(commandLineOptions.target, 'No target specified'),
    outDir: CLIOptionValidator.validateString(commandLineOptions.outDir),
    dirStructure: pickDefined(dirStructure, 'uvfg'),
    seqFilenames: CLIOptionValidator.validateBoolean(commandLineOptions.seqFilenames) || false,
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
      },
      proxy: getProxyOptions(commandLineOptions)
    },
    noPrompt: CLIOptionValidator.validateBoolean(commandLineOptions.noPrompt) || false,
    logging: {
      level: CLIOptionValidator.validateString(commandLineOptions.logging?.level, 'info', 'debug', 'warn', 'error', 'none') || 'info',
      file: CLIOptionValidator.validateString(commandLineOptions.logging?.file)
    }
  };

  return options;
}
