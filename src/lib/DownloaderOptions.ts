import path from 'path';
import Logger from './utils/logging/Logger.js';
import { DeepRequired, pickDefined } from './utils/Misc.js';
import { DownloaderConfig } from './ImageFapDownloader.js';

export interface DownloaderOptions {
  outDir?: string;
  dirStructure?: {
    uploader?: boolean;
    folder?: boolean;
    gallery?: boolean;
  }
  request?: {
    maxRetries?: number;
    maxConcurrent?: number;
    minTime?: {
      page?: number;
      image?: number;
    };
  };
  overwrite?: boolean;
  saveJSON?: boolean;
  saveHTML?: boolean;
  logger?: Logger | null;
}

const DEFAULT_DOWNLOADER_CONFIG: Pick<DeepRequired<DownloaderConfig>,
  'outDir' | 'dirStructure' | 'request' | 'overwrite' | 'saveJSON' | 'saveHTML'> = {

    outDir: process.cwd(),
    dirStructure: {
      uploader: true,
      folder: true,
      gallery: true
    },
    request: {
      maxRetries: 3,
      maxConcurrent: 10,
      minTime: {
        page: 2000,
        image: 200
      }
    },
    overwrite: false,
    saveJSON: true,
    saveHTML: true
  };

export function getDownloaderConfig(url: string, options?: DownloaderOptions): DownloaderConfig {
  const defaults = DEFAULT_DOWNLOADER_CONFIG;
  return {
    outDir: options?.outDir ? path.resolve(options.outDir) : defaults.outDir,
    dirStructure: {
      uploader: pickDefined(options?.dirStructure?.uploader, defaults.dirStructure.uploader),
      folder: pickDefined(options?.dirStructure?.folder, defaults.dirStructure.folder),
      gallery: pickDefined(options?.dirStructure?.gallery, defaults.dirStructure.gallery)
    },
    request: {
      maxRetries: pickDefined(options?.request?.maxRetries, defaults.request.maxRetries),
      maxConcurrent: pickDefined(options?.request?.maxConcurrent, defaults.request.maxConcurrent),
      minTime: {
        page: pickDefined(options?.request?.minTime?.page, defaults.request.minTime.page),
        image: pickDefined(options?.request?.minTime?.image, defaults.request.minTime.image)
      }
    },
    overwrite: pickDefined(options?.overwrite, defaults.overwrite),
    saveJSON: pickDefined(options?.saveJSON, defaults.saveJSON),
    saveHTML: pickDefined(options?.saveHTML, defaults.saveHTML),
    targetURL: url
  };
}

export function getDefaultDownloaderOutDir() {
  return DEFAULT_DOWNLOADER_CONFIG.outDir;
}
