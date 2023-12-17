import deepFreeze from 'deep-freeze';
import { DeepRequired } from './utils/Misc.js';
import { DownloaderOptions, getDownloaderConfig } from './DownloaderOptions.js';
import Fetcher, { FetcherError } from './utils/Fetcher.js';
import Logger, { LogLevel, commonLog } from './utils/logging/Logger.js';
import URLHelper from './utils/URLHelper.js';
import Bottleneck from 'bottleneck';
import { AbortError, Headers } from 'node-fetch';
import path from 'path';
import sanitizeFilename from 'sanitize-filename';
import { existsSync } from 'fs';
import fse from 'fs-extra';
import Parser from './parsers/Parser.js';
import { GalleryFolder } from './entities/GalleryFolder.js';
import { Gallery } from './entities/Gallery.js';
import { Image, ImageLink } from './entities/Image.js';
import { User } from './entities/User.js';

export type DownloadTargetType = 'userGalleries' | 'galleryFolder' | 'gallery' | 'photo';

interface DownloadContext {
  galleryFolder?: GalleryFolder;
}

export interface DownloaderConfig extends DeepRequired<Pick<DownloaderOptions,
  'outDir' |
  'dirStructure' |
  'request' |
  'overwrite' |
  'saveJSON' |
  'saveHTML'>> {
    targetURL: string;
  }

export interface DownloaderStartParams {
  signal?: AbortSignal;
}

export interface DownloadStats {
  processedGalleryCount: number;
  skippedPasswordProtectedFolderURLs: {
    url: string;
    referrer?: string;
  }[];
  skippedExistingImageCount: number;
  downloadedImageCount: number;
  errorCount: number;
}

export default class ImageFapDownloader {

  name = 'ImageFapDownloader';

  #fetcher: Fetcher;
  protected pageFetchLimiter: Bottleneck;
  protected imageDownloadLimiter: Bottleneck;
  protected config: deepFreeze.DeepReadonly<DownloaderConfig>;
  protected logger?: Logger | null;
  protected parser: Parser;

  constructor(url: string, options?: DownloaderOptions) {
    this.config = deepFreeze({
      ...getDownloaderConfig(url, options)
    });
    this.pageFetchLimiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: this.config.request.minTime.page
    });
    this.imageDownloadLimiter = new Bottleneck({
      maxConcurrent: this.config.request.maxConcurrent,
      minTime: this.config.request.minTime.image
    });
    this.logger = options?.logger;
    this.parser = new Parser(this.logger);
  }

  async start(params: DownloaderStartParams): Promise<void> {
    const stats: DownloadStats = {
      processedGalleryCount: 0,
      skippedPasswordProtectedFolderURLs: [],
      skippedExistingImageCount: 0,
      downloadedImageCount: 0,
      errorCount: 0
    };
    try {
      await this.#process(this.config.targetURL, stats, params.signal);
      this.log('info', 'Download complete');
    }
    catch (error) {
      const __clearLimiters = () => {
        return Promise.all([
          this.pageFetchLimiter.stop({
            dropErrorMessage: 'LimiterStopOnError',
            dropWaitingJobs: true
          }),
          this.imageDownloadLimiter.stop({
            dropErrorMessage: 'LimiterStopOnError',
            dropWaitingJobs: true
          })
        ]);
      };
      if (error instanceof AbortError) {
        this.log('info', 'Aborting...');
        await __clearLimiters();
        this.log('info', 'Download aborted');
      }
      else {
        this.log('error', 'Unhandled error: ', error);
        this.#updateStatsOnError(error, stats);
        await __clearLimiters();
      }
    }
    this.log('info', '--------------');
    this.log('info', 'Download stats');
    this.log('info', '--------------');
    this.log('info', `Processed galleries: ${stats.processedGalleryCount}`);
    this.log('info', `Downloaded images: ${stats.downloadedImageCount}`);
    this.log('info', `Skipped existing images: ${stats.skippedExistingImageCount}`);
    this.log('info', `Errors: ${stats.errorCount}`);
    if (stats.skippedPasswordProtectedFolderURLs.length > 0) {
      this.log(
        'info',
        `Skipped password-protected folders: ${stats.skippedPasswordProtectedFolderURLs.length}`
      );
      this.log(
        'info',
        'Password-protected folder URLs:',
        stats.skippedPasswordProtectedFolderURLs
      );
    }
  }

  #updateStatsOnError(error: any, stats: DownloadStats) {
    if (!(error instanceof Error) || error.message !== 'LimiterStopOnError') {
      stats.errorCount++;
    }
  }

  protected log(level: LogLevel, ...msg: any[]) {
    const limiterStopOnError = msg.find((m) => m instanceof Error && m.message === 'LimiterStopOnError');
    if (limiterStopOnError) {
      return;
    }
    commonLog(this.logger, level, this.name, ...msg);
  }

  getConfig() {
    return this.config;
  }

  async #process(url: string, stats: DownloadStats, signal?: AbortSignal, context: DownloadContext = {}) {

    const targetType = URLHelper.getTargetTypeByURL(url);

    switch (targetType) {
      case 'userGalleries':
        this.log('info', `Fetching user galleries from "${url}"`);
        const {html} = await this.#fetchPage(url, signal);
        const userGalleries = this.parser.parseUserGalleriesPage(html);
        this.log('info', `Got ${userGalleries.length} gallery folders`);
        for (const folder of userGalleries) {
          this.log('info', `**** Entering folder "${folder.title}" ****`);
          await this.#process(folder.url, stats, signal, context);
        }
        break;

      case 'galleryFolder':
        this.log('info', `Fetching gallery folder contents from "${url}"`);
        const folder = await this.#getGalleryFolder(url, stats, signal);
        this.log('info', 'Gallery folder:', {
          id: folder.id,
          title: folder.title,
          galleries: folder.galleryLinks.length
        });
        context.galleryFolder = folder;
        for (const gallery of folder.galleryLinks) {
          this.log('info', `**** Entering gallery "${gallery.title}" ****`);
          await this.#process(gallery.url, stats, signal, context);
        }
        break;

      case 'gallery':
        this.log('info', `Fetching gallery contents from "${url}"`);
        let gallery: Gallery;
        let galleryHTML: string;
        try {
          const {gallery: _gallery, html: _html } = await this.#getGallery(url, stats, signal);
          this.log('info', 'Gallery:', {
            id: _gallery.id,
            title: _gallery.title,
            description: _gallery.description,
            images: _gallery.images.length
          });
          gallery = _gallery;
          galleryHTML = _html;
        }
        catch (error) {
          if (this.#isErrorNonContinuable(error)) {
            throw error;
          }
          this.log('error', `Error fetching gallery "${url}" - download skipped: `, error);
          return;
        }
        const gallerySavePath = this.#getGallerySavePath(gallery, context);
        fse.ensureDirSync(gallerySavePath);
        if (this.config.saveJSON) {
          const writeGallery = {
            url,
            ...gallery
          };
          const infoFile = path.resolve(gallerySavePath, 'gallery.json');
          this.log('info', `Saving gallery info to "${infoFile}"`);
          fse.writeJSONSync(infoFile, writeGallery, { encoding: 'utf-8', spaces: 2 });
        }
        if (this.config.saveHTML) {
          const htmlFile = path.resolve(gallerySavePath, 'gallery.html');
          this.log('info', `Saving original HTML to "${htmlFile}"`);
          fse.writeFileSync(htmlFile, galleryHTML, { encoding: 'utf-8' });
        }
        this.log('info', `Downloading ${gallery.images.length} images from gallery "${gallery.title}"`);
        await Promise.all(gallery.images.map((image) => this.#downloadImage(image, gallerySavePath, stats, signal)));
        stats.processedGalleryCount++;
        break;

      default:
        throw Error(`Unsupported target type "${targetType}"`);
    }
  }

  protected async getFetcher() {
    if (!this.#fetcher) {
      this.#fetcher = await Fetcher.getInstance(this.logger);
    }
    return this.#fetcher;
  }

  async #fetchPage(url: string, signal?: AbortSignal, headers?: Headers) {
    const fetcher = await this.getFetcher();
    return this.pageFetchLimiter.schedule(() => {
      this.log('debug', `Fetch page "${url}"`);
      return fetcher.fetchHTML({
        url,
        maxRetries: this.config.request.maxRetries,
        retryInterval: this.config.request.minTime.page,
        signal,
        headers
      });
    });
  }

  async #getGalleryFolder(url: string, stats: DownloadStats, signal?: AbortSignal, current?: GalleryFolder) {
    let nextURL: string | undefined;
    try {
      const { html, lastURL } = await this.#fetchPage(url, signal);
      const { folder, galleryLinks, nextURL: _nextURL } = this.parser.parseGalleryFolderPage(html, lastURL);
      if (!current) {
        current = {
          url: folder?.url || url,
          id: folder?.id,
          title: folder?.title,
          galleryLinks
        };
      }
      else {
        current.galleryLinks.push(...galleryLinks);
      }
      nextURL = _nextURL;
    }
    catch (error) {
      if (this.#isErrorNonContinuable(error) || !current) {
        throw error;
      }
      this.log('error', `Error fetching galleries from folder "${url}": `, error);
      this.log('warn', 'Download will be missing some galleries');
      this.#updateStatsOnError(error, stats);
    }
    if (nextURL) {
      this.log('debug', `Fetching next set of galleries from "${nextURL}"`);
      await this.#getGalleryFolder(nextURL, stats, signal, current);
    }
    return current;
  }

  async #getGallery(url: string, stats: DownloadStats, signal?: AbortSignal): Promise<{ gallery: Gallery, html: string }> {
    const { id, uploader, description, title, imageLinks, html } = await this.#getGalleryInitialData(url, stats, signal);
    let errorCount = 0;
    let imageNavURL: string | null = null;
    let referrerImageID = imageLinks[0]?.id;
    let navIdx = 0;
    let totalNavImageCount = 0;
    if (imageLinks.length > 0) {
      imageNavURL = URLHelper.constructImageNavURL({ referrerImageID, galleryID: id, startIndex: navIdx });
    }
    const images: Image[] = [];
    while (imageNavURL) {
      const headers = new Headers({
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': URLHelper.constructImageNavRefererURL({ referrerImageID, galleryID: id })
      });
      const {html} = await this.#fetchPage(imageNavURL, signal, headers);
      const navImages = this.parser.parseImageNav(html);
      totalNavImageCount += navImages.length;
      const parsedImages = navImages.reduce<Image[]>((result, image) => {
        if (image) {
          result.push(image);
        }
        return result;
      }, []);
      if (navImages.length > parsedImages.length) {
        const parseErrors = navImages.length - parsedImages.length;
        stats.errorCount += parseErrors;
        errorCount += parseErrors;
      }
      images.push(...parsedImages);
      const lastParsedImageID = parsedImages.at(-1)?.id;
      if (navImages.length > 0 && totalNavImageCount < imageLinks.length && lastParsedImageID) {
        referrerImageID = lastParsedImageID;
        navIdx += navImages.length;
        imageNavURL = URLHelper.constructImageNavURL({ referrerImageID, galleryID: id, startIndex: navIdx });
      }
      else {
        imageNavURL = null;
      }
    }

    if (errorCount > 0) {
      this.log('warn', `Download of gallery "${title}" will be missing ${errorCount} images due to parse errors`);
    }

    images.forEach((image) => {
      const link = imageLinks.find((l) => l.id === image.id);
      if (link) {
        image.title = link.title;
      }
    });

    const gallery: Gallery = {
      id,
      uploader,
      description,
      images,
      title
    };

    return { gallery, html };
  }

  async #getGalleryInitialData(
    url: string,
    stats: DownloadStats,
    signal?: AbortSignal,
    current?: { id?: number; uploader: User; description?: string; title: string; imageLinks: ImageLink[], html: string }) {

    let nextURL: string | undefined;
    try {
      const {html, lastURL} = await this.#fetchPage(url, signal);
      const { id, uploader, description, title, imageLinks, nextURL: _nextURL } = this.parser.parseGalleryPage(html, lastURL);
      if (current) {
        current.imageLinks.push(...imageLinks);
      }
      else {
        current = {
          id,
          uploader,
          description,
          title,
          imageLinks,
          html
        };
      }
      nextURL = _nextURL;
    }
    catch (error) {
      if (this.#isErrorNonContinuable(error) || !current) {
        throw error;
      }
      this.log('error', `Error fetching image links from "${url}": `, error);
      this.log('warn', `Gallery "${current.title}" will be missing some images`);
      this.#updateStatsOnError(error, stats);
    }
    if (nextURL) {
      this.log('debug', `Fetching next set of image links from "${nextURL}"`);
      await this.#getGalleryInitialData(nextURL, stats, signal, current);
    }
    return current;
  }

  #isErrorNonContinuable(error: any) {
    return error instanceof AbortError || (error instanceof FetcherError && error.fatal);
  }

  #getGallerySavePath(gallery: Gallery, context: DownloadContext ) {
    const gallerySavePathParts:string[] = [];
    if (this.config.dirStructure.uploader) {
      gallerySavePathParts.push(sanitizeFilename(`${gallery.uploader.username} (${gallery.uploader.id})`));
    }
    if (context.galleryFolder && context.galleryFolder.id && this.config.dirStructure.folder) {
      if (context.galleryFolder.title) {
        gallerySavePathParts.push(sanitizeFilename(`${context.galleryFolder.title} (${context.galleryFolder.id})`));
      }
      else {
        gallerySavePathParts.push(sanitizeFilename(`${context.galleryFolder.id}`));
      }
    }
    if (this.config.dirStructure.gallery) {
      if (gallery.id) {
        gallerySavePathParts.push(sanitizeFilename(`${gallery.title} (${gallery.id})`));
      }
      else {
        gallerySavePathParts.push(sanitizeFilename(gallery.title));
      }
    }
    return path.resolve(this.config.outDir, gallerySavePathParts.join(path.sep));
  }

  async #downloadImage(image: Image, destDir: string, stats: DownloadStats, signal: AbortSignal | undefined) {
    let filename: string;
    const ext = path.parse(new URL(image.src).pathname).ext;
    if (image.title) {
      const name = path.parse(image.title).name;
      filename = sanitizeFilename(`${name} (${image.id})${ext}`);
    }
    else {
      filename = sanitizeFilename(`${image.id}${ext}`);
    }
    const destPath = path.resolve(destDir, filename);
    if (existsSync(destPath) && !this.config.overwrite) {
      this.log('info', `Skipping existing image "${filename}"`);
      stats.skippedExistingImageCount++;
      return Promise.resolve();
    }

    try {
      const fetcher = await this.getFetcher();
      await this.imageDownloadLimiter.schedule(() => fetcher.downloadImage({
        src: image.src,
        dest: destPath,
        signal
      }));
      this.log('info', `Downloaded "${filename}"`);
      stats.downloadedImageCount++;
    }
    catch (error) {
      if (this.#isErrorNonContinuable(error)) {
        throw error;
      }
      this.log('error', `Error downloading "${filename}" from "${image.src}": `, error);
      this.#updateStatsOnError(error, stats);
    }
  }
}
