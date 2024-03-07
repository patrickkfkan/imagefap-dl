import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';
import { CLIOptionParserEntry, CLIOptions } from './CLIOptions.js';
import { EOL } from 'os';
import { DeepPartial, RecursivePropsTo } from '../lib/utils/Misc.js';
import { getPackageInfo } from '../lib/utils/PackageInfo.js';

export type CommandLineParseResult = RecursivePropsTo<DeepPartial<CLIOptions>, CLIOptionParserEntry>;

const COMMAND_LINE_ARGS = {
  help: 'help',
  url: 'url',
  outDir: 'out-dir',
  dirStructure: 'dir-structure',
  fullFilenames: 'full-filenames',
  overwrite: 'overwrite',
  noJSON: 'no-json',
  noHTML: 'no-html',
  logLevel: 'log-level',
  logFile: 'log-file',
  maxRetries: 'max-retries',
  maxConcurrent: 'max-concurrent',
  minTimePage: 'min-time-page',
  minTimeImage: 'min-time-image',
  noPrompt: 'no-prompt'
} as const;

const OPT_DEFS = [
  {
    name: COMMAND_LINE_ARGS.help,
    description: 'Display this usage guide',
    alias: 'h',
    type: Boolean
  },
  {
    name: COMMAND_LINE_ARGS.url,
    description: 'URL of content to download',
    type: String,
    defaultOption: true
  },
  {
    name: COMMAND_LINE_ARGS.outDir,
    description: 'Path to directory where content is saved. Default: current working directory',
    alias: 'o',
    type: String,
    typeLabel: '<dir>'
  },
  {
    name: COMMAND_LINE_ARGS.dirStructure,
    description: 'Combination of flags controlling the output directory structure of downloaded galleries. See "Directory structure flags" section for available flags.',
    alias: 'd',
    type: String,
    typeLabel: '<flags>'
  },
  {
    name: COMMAND_LINE_ARGS.fullFilenames,
    description: 'Use full filename for image downloads. If not specified, filenames may be truncated. Note: getting full filenames involves extra page requests that will increase download time.',
    alias: 'f',
    type: Boolean
  },
  {
    name: COMMAND_LINE_ARGS.overwrite,
    description: 'Overwrite existing image files',
    alias: 'w',
    type: Boolean
  },
  {
    name: COMMAND_LINE_ARGS.noJSON,
    description: 'Do not save gallery info in JSON file',
    alias: 'j',
    type: Boolean
  },
  {
    name: COMMAND_LINE_ARGS.noHTML,
    description: 'Do not save original HTML',
    alias: 'm',
    type: Boolean
  },
  {
    name: COMMAND_LINE_ARGS.logLevel,
    description: 'Log level: \'info\', \'debug\', \'warn\' or \'error\'; set to \'none\' to disable logging. Default: info',
    alias: 'l',
    type: String,
    typeLabel: '<level>'
  },
  {
    name: COMMAND_LINE_ARGS.logFile,
    description: 'Save logs to <path>',
    alias: 's',
    type: String,
    typeLabel: '<path>'
  },
  {
    name: COMMAND_LINE_ARGS.maxRetries,
    description: 'Maximum retry attempts when a download fails. Default: 3',
    alias: 'r',
    type: Number,
    typeLabel: '<number>'
  },
  {
    name: COMMAND_LINE_ARGS.maxConcurrent,
    description: 'Maximum number of concurrent image downloads. Default: 10',
    alias: 'c',
    type: Number,
    typeLabel: '<number>'
  },
  {
    name: COMMAND_LINE_ARGS.minTimePage,
    description: 'Minimum time to wait between page fetch requests. As a general rule, do not set this lower than 2000, otherwise you will likely get \'Too many requests\' errors. Default: 2000',
    alias: 'p',
    type: Number,
    typeLabel: '<milliseconds>'
  },
  {
    name: COMMAND_LINE_ARGS.minTimeImage,
    description: 'Minimum time to wait between image download requests. Default: 200',
    alias: 'i',
    type: Number,
    typeLabel: '<milliseconds>'
  },
  {
    name: COMMAND_LINE_ARGS.noPrompt,
    description: 'Do not prompt for confirmation to proceed',
    alias: 'y',
    type: Boolean
  }
];

export default class CommandLineParser {

  static parse(): CommandLineParseResult {
    const opts = this.#parseArgs();
    const argv = process.argv;

    const __getOptNameUsed = (key: string) => {
      const name = `--${key}`;
      if (argv.includes(name)) {
        return name;
      }
      const alias = OPT_DEFS.find((def) => def.name === key)?.alias;
      if (alias) {
        return `-${alias}`;
      }
      return name;
    };

    const __getValue = (key: typeof COMMAND_LINE_ARGS[keyof typeof COMMAND_LINE_ARGS]): CLIOptionParserEntry | undefined => {
      let value = opts[key];

      const booleanTypeArgs = [
        COMMAND_LINE_ARGS.noPrompt,
        COMMAND_LINE_ARGS.fullFilenames,
        COMMAND_LINE_ARGS.overwrite,
        COMMAND_LINE_ARGS.noJSON,
        COMMAND_LINE_ARGS.noHTML
      ];
      if (booleanTypeArgs.includes(key as any) && value !== undefined) {
        value = '1';
      }

      if (value === null) {
        throw Error(`Command-line option requires a value for '--${key}'`);
      }
      if ((typeof value === 'string' && value) || typeof value === 'number') {
        return {
          key: __getOptNameUsed(key),
          value: String(value).trim()
        };
      }
      return undefined;
    };

    return {
      url: __getValue(COMMAND_LINE_ARGS.url),
      outDir: __getValue(COMMAND_LINE_ARGS.outDir),
      dirStructure: __getValue(COMMAND_LINE_ARGS.dirStructure),
      fullFilenames: __getValue(COMMAND_LINE_ARGS.fullFilenames),
      overwrite: __getValue(COMMAND_LINE_ARGS.overwrite),
      noJSON: __getValue(COMMAND_LINE_ARGS.noJSON),
      noHTML: __getValue(COMMAND_LINE_ARGS.noHTML),
      request: {
        maxRetries: __getValue(COMMAND_LINE_ARGS.maxRetries),
        maxConcurrent: __getValue(COMMAND_LINE_ARGS.maxConcurrent),
        minTime: {
          page: __getValue(COMMAND_LINE_ARGS.minTimePage),
          image: __getValue(COMMAND_LINE_ARGS.minTimeImage)
        }
      },
      noPrompt: __getValue(COMMAND_LINE_ARGS.noPrompt),
      logging: {
        level: __getValue(COMMAND_LINE_ARGS.logLevel),
        file: __getValue(COMMAND_LINE_ARGS.logFile)
      }
    };
  }

  static showUsage() {
    let opts;
    try {
      opts = this.#parseArgs();
    }
    catch (error) {
      return false;
    }
    if (opts.help) {
      const urlContent = [
        'Download all galleries by a user:',
        `- https://www.imagefap.com/profile/<username>/galleries${EOL}`,

        'Download all galleries in a folder:',
        '- https://www.imagefap.com/profile/<username>/galleries?folderid=<folder-id>',
        '- https://www.imagefap.com/organizer/<folder-id>/<folder-slug>',
        `- https://www.imagefap.com/usergallery.php?userid=<user-id>&folderid=<folder-id>${EOL}`,

        'Download a single gallery:',
        '- https://www.imagefap.com/gallery/<gallery-id>',
        '- https://www.imagefap.com/gallery.php?gid=<gallery-id>',
        '- https://www.imagefap.com/pictures/<gallery-id>/<gallery-slug>'

      ];
      const dirStructureContent = [
        {
          flag: 'u',
          desc: 'Include directory for uploader of the gallery (note: does not apply when uploader is anonymous)'
        },
        {
          flag: 'f',
          desc: 'Include directory for folder containing the gallery (note: does not apply when downloading a single gallery)'
        },
        {
          flag: 'g',
          desc: 'Include directory for the gallery itself'
        },
        {
          flag: '-',
          desc: 'No directory structure. All images will be downloaded to --out-dir.'
        }
      ];
      const sections: commandLineUsage.Section[] = [
        {
          header: 'Usage',
          content: 'imagefap-dl [OPTION]... URL'
        },
        {
          header: 'URL',
          content: urlContent.join(EOL)
        },
        {
          header: 'Options',
          optionList: OPT_DEFS,
          hide: 'url'
        },
        {
          header: 'Directory structure flags (--dir-structure)',
          content: 'When downloading a gallery, the following flags specify which directory is to be included in the output directory structure:'
        },
        {
          content: dirStructureContent
        },
        {
          content: 'Default: ufg'
        },
        {
          header: 'Usage notes',
          content: 'If you encounter \'Too many requests\' errors, you would have to wait until ImageFap unblocks your IP address. Alternatively, in a fresh private browser session, you can visit the URL you are downloading from and complete the human-verification process there. To avoid bumping into such errors, set a safe value for the --min-time-page option (recommended minimum: 2000).'
        },
        {
          header: 'Project home',
          content: '{underline https://github.com/patrickkfkan/imagefap-dl}'
        }
      ];
      const banner = getPackageInfo().banner;
      if (banner) {
        sections.unshift({ header: banner, raw: true });
      }
      const usage = commandLineUsage(sections);
      console.log(usage);

      return true;
    }

    return false;
  }

  static #parseArgs() {
    const opts = commandLineArgs(OPT_DEFS, { stopAtFirstUnknown: true });
    if (opts['_unknown']) {
      const unknownOpt = Object.keys(opts['_unknown'])[0];
      throw Error(`Unknown option '${unknownOpt}'`);
    }
    return opts;
  }
}
