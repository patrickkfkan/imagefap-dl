import path from 'path';
import Logger from './utils/logging/Logger.js';
import { DeepRequired, pickDefined } from './utils/Misc.js';
import { DownloaderConfig } from './ImageFapDownloader.js';

export interface ProxyOptions {
  url: string;
  rejectUnauthorizedTLS?: boolean;
}

export interface DownloaderOptions {
  outDir?: string;
  dirStructure?: {
    user?: boolean;
    favorites?: boolean;
    folder?: boolean;
    gallery?: boolean;
  };
  seqFilenames?: boolean;
  fullFilenames?: boolean;
  request?: {
    maxRetries?: number;
    maxConcurrent?: number;
    minTime?: {
      page?: number;
      image?: number;
    };
    proxy?: ProxyOptions | null;
  };
  overwrite?: boolean;
  saveJSON?: boolean;
  saveHTML?: boolean;
  logger?: Logger | null;
}

const DEFAULT_DOWNLOADER_CONFIG: Pick<DeepRequired<DownloaderConfig>,
  'outDir' | 'dirStructure' | 'seqFilenames' | 'fullFilenames' | 'request' | 'overwrite' | 'saveJSON' | 'saveHTML'> = {

    outDir: process.cwd(),
    dirStructure: {
      user: true,
      favorites: true,
      folder: true,
      gallery: true
    },
    seqFilenames: false,
    fullFilenames: false,
    request: {
      maxRetries: 3,
      maxConcurrent: 10,
      minTime: {
        page: 2000,
        image: 200
      },
      proxy: null
    },
    overwrite: false,
    saveJSON: true,
    saveHTML: true
  };

export function getDownloaderConfig(url: string[], options?: DownloaderOptions): DownloaderConfig {
  const defaults = DEFAULT_DOWNLOADER_CONFIG;
  return {
    outDir: options?.outDir ? path.resolve(options.outDir) : defaults.outDir,
    dirStructure: {
      user: pickDefined(options?.dirStructure?.user, defaults.dirStructure.user),
      favorites: pickDefined(options?.dirStructure?.favorites, defaults.dirStructure.favorites),
      folder: pickDefined(options?.dirStructure?.folder, defaults.dirStructure.folder),
      gallery: pickDefined(options?.dirStructure?.gallery, defaults.dirStructure.gallery)
    },
    seqFilenames: pickDefined(options?.seqFilenames, defaults.seqFilenames),
    fullFilenames: pickDefined(options?.fullFilenames, defaults.fullFilenames),
    request: {
      maxRetries: pickDefined(options?.request?.maxRetries, defaults.request.maxRetries),
      maxConcurrent: pickDefined(options?.request?.maxConcurrent, defaults.request.maxConcurrent),
      minTime: {
        page: pickDefined(options?.request?.minTime?.page, defaults.request.minTime.page),
        image: pickDefined(options?.request?.minTime?.image, defaults.request.minTime.image)
      },
      proxy: options?.request?.proxy?.url ? {
        url: options.request.proxy.url,
        rejectUnauthorizedTLS: options.request.proxy.rejectUnauthorizedTLS ?? true
      } : null
    },
    overwrite: pickDefined(options?.overwrite, defaults.overwrite),
    saveJSON: pickDefined(options?.saveJSON, defaults.saveJSON),
    saveHTML: pickDefined(options?.saveHTML, defaults.saveHTML),
    targetURLs: url
  };
}

export function getDefaultDownloaderOutDir() {
  return DEFAULT_DOWNLOADER_CONFIG.outDir;
}
