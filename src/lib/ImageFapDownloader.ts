import deepFreeze from 'deep-freeze';
import { DeepRequired } from './utils/Misc.js';
import { DownloaderOptions, getDownloaderConfig } from './DownloaderOptions.js';
import Fetcher, { FetcherError } from './utils/Fetcher.js';
import Logger, { LogLevel, commonLog } from './utils/logging/Logger.js';
import URLHelper from './utils/URLHelper.js';
import Bottleneck from 'bottleneck';
import path from 'path';
import sanitizeFilename from 'sanitize-filename';
import { existsSync } from 'fs';
import fse from 'fs-extra';
import Parser from './parsers/Parser.js';
import { FavoritesFolder, GalleryFolder } from './entities/GalleryFolder.js';
import { Gallery } from './entities/Gallery.js';
import { Image, ImageLink } from './entities/Image.js';
import { User } from './entities/User.js';
import { HeadersInit } from 'undici';

export type DownloadTargetType = 'userGalleries' | 'galleryFolder' | 'gallery' | 'photo' | 'favorites' | 'favoritesFolder';

interface DownloadContext {
  isFavorite?: boolean;
  galleryFolder?: GalleryFolder;
}

export interface DownloaderConfig extends DeepRequired<Pick<DownloaderOptions,
  'outDir' |
  'dirStructure' |
  'seqFilenames' |
  'fullFilenames' |
  'request' |
  'overwrite' |
  'saveJSON' |
  'saveHTML'>> {
    targetURLs: string[];
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

  constructor(url: string | string[], options?: DownloaderOptions) {
    this.config = deepFreeze({
      ...getDownloaderConfig(!Array.isArray(url) ? [ url ] : url, options)
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
    const combinedStats = this.#getEmptyStats();
    try {
      for (const url of this.config.targetURLs) {
        const stats = this.#getEmptyStats();
        try {
          await this.#process(url, stats, params.signal);
          this.log('info', 'Download complete');
        }
        catch (error: unknown) {
          if (!params.signal?.aborted) {
            this.log('error', 'Unhandled error: ', error);
            this.#updateStatsOnError(error, stats);
          }
          throw error;
        }
        finally {
          this.logEmptyLine();
          this.#logStats(stats, `Done processing: ${url}`);
          combinedStats.processedGalleryCount += stats.processedGalleryCount;
          combinedStats.skippedPasswordProtectedFolderURLs = {
            ...combinedStats.skippedPasswordProtectedFolderURLs,
            ...stats.skippedPasswordProtectedFolderURLs
          };
          combinedStats.skippedExistingImageCount += stats.skippedExistingImageCount;
          combinedStats.downloadedImageCount += stats.downloadedImageCount;
          combinedStats.errorCount += stats.errorCount;
        }
      }
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
      if (params.signal?.aborted) {
        this.log('info', 'Aborting...');
        await __clearLimiters();
        this.log('info', 'Download aborted');
      }
      else {
        await __clearLimiters();
      }
    }
    if (this.config.targetURLs.length > 1) {
      this.#logStats(combinedStats, `Total ${this.config.targetURLs.length} URLs processed`);
    }
  }

  #getEmptyStats(): DownloadStats {
    return {
      processedGalleryCount: 0,
      skippedPasswordProtectedFolderURLs: [],
      skippedExistingImageCount: 0,
      downloadedImageCount: 0,
      errorCount: 0
    };
  }

  #logStats(stats: DownloadStats, header: string) {
    this.log('info', header);
    this.log('info', '-'.repeat(header.length));
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
    this.logEmptyLine();
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

  protected logEmptyLine() {
    this.logger?.log(null);
  }

  getConfig() {
    return this.config;
  }

  async #process(url: string, stats: DownloadStats, signal?: AbortSignal, context: DownloadContext = {}) {

    const targetType = URLHelper.getTargetTypeByURL(url);

    switch (targetType) {
      case 'userGalleries': {
        this.log('info', `Fetching user galleries from "${url}"`);
        const {html} = await this.#fetchPage(url, signal);
        const userGalleries = this.parser.parseUserGalleriesPage(html);
        this.log('info', `Got ${userGalleries.length} gallery folders`);
        for (const folder of userGalleries) {
          this.log('info', `**** Entering folder "${folder.title}" ****`);
          await this.#process(folder.url, stats, signal, context);
        }
        break;
      }

      case 'favorites': {
        this.log('info', `Fetching user favorites from "${url}"`);
        const {html} = await this.#fetchPage(url, signal);
        const favoriteFolders = this.parser.parseFavoritesPage(html);
        this.log('info', `Got ${favoriteFolders.length} gallery folders`);
        for (const folder of favoriteFolders) {
          this.log('info', `**** Entering folder "${folder.title}" ****`);
          await this.#process(folder.url, stats, signal, context);
        }
        break;
      }

      case 'galleryFolder': {
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
      }

      case 'favoritesFolder': {
        this.log('info', `Fetching favorites folder contents from "${url}"`);
        const folder = await this.#getFavoritesFolder(url, stats, signal);
        const info = {
          id: folder.id,
          title: folder.title
        } as any;
        if (folder.galleryLinks.length > 0) {
          info.galleries = folder.galleryLinks.length;
        }
        if (folder.images.length > 0) {
          info.images = folder.images.length;
        }
        this.log('info', 'Favorites folder:', info);
        context.galleryFolder = folder;
        context.isFavorite = true;
        for (const gallery of folder.galleryLinks) {
          this.log('info', `**** Entering gallery "${gallery.title}" ****`);
          await this.#process(gallery.url, stats, signal, context);
        }
        if (folder.images.length > 0) {
          const savePath = this.#getGallerySavePath(null, context);
          fse.ensureDirSync(savePath);
          if (this.config.saveJSON) {
            const infoFile = path.resolve(savePath, 'favorites.json');
            const writeInfo = { ...folder } as any;
            delete writeInfo.galleryLinks;
            this.log('info', `Saving info to "${infoFile}"`);
            fse.writeJSONSync(infoFile, writeInfo, { encoding: 'utf-8', spaces: 2 });
          }
          this.log('info', `Downloading ${folder.images.length} images from favorites folder "${folder.title}"`);
          await Promise.all(folder.images.map((image, i) => this.#downloadImage(image, savePath, i, stats, signal)));
        }
        break;
      }

      case 'gallery': {
        this.log('info', `Fetching gallery contents from "${url}"`);
        let gallery: Gallery;
        let galleryHTML: string;
        try {
          const {gallery: _gallery, html: _html } = await this.#getGallery(url, stats, signal);
          this.log('info', 'Gallery:', {
            id: _gallery.id,
            title: _gallery.title,
            uploader: _gallery.uploader?.username || '(Anonymous)',
            description: _gallery.description,
            images: _gallery.images.length
          });
          gallery = _gallery;
          galleryHTML = _html;
        }
        catch (error) {
          if (this.#isErrorNonContinuable(error, signal)) {
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
        await Promise.all(gallery.images.map((image, i) => this.#downloadImage(image, gallerySavePath, i, stats, signal)));
        stats.processedGalleryCount++;
        break;
      }

      default:
        throw Error(`Unsupported target type "${targetType}"`);
    }
  }

  protected async getFetcher() {
    if (!this.#fetcher) {
      this.#fetcher = await Fetcher.getInstance(this.logger, this.config.request.proxy);
    }
    return this.#fetcher;
  }

  async #fetchPage(url: string, signal?: AbortSignal, headers?: HeadersInit) {
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
      const { folder, owner, galleryLinks, nextURL: _nextURL } = this.parser.parseGalleryFolderPage(html, lastURL);
      if (!current) {
        current = {
          url: folder?.url || url,
          id: folder?.id,
          title: folder?.title,
          owner,
          galleryLinks
        };
      }
      else {
        current.galleryLinks.push(...galleryLinks);
      }
      nextURL = _nextURL;
    }
    catch (error) {
      if (this.#isErrorNonContinuable(error, signal) || !current) {
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

  async #getFavoritesFolder(url: string, stats: DownloadStats, signal?: AbortSignal, current?: FavoritesFolder) {
    let nextURL: string | undefined;
    try {
      const { html, lastURL } = await this.#fetchPage(url, signal);
      const { folder, owner, galleryLinks, imageLinks, nextURL: _nextURL } = this.parser.parseFavoritesFolderPage(html, lastURL);
      const images = imageLinks && imageLinks.length > 0 ? await this.#getImagesByLink(imageLinks, signal) : [];
      if (!current) {
        current = {
          url: folder?.url || url,
          id: folder?.id,
          title: folder?.title,
          owner,
          galleryLinks: galleryLinks || [],
          images
        };
      }
      else {
        if (galleryLinks) {
          current.galleryLinks.push(...galleryLinks);
        }
        if (imageLinks) {
          current.images.push(...images);
        }
      }
      nextURL = _nextURL;
    }
    catch (error) {
      if (this.#isErrorNonContinuable(error, signal) || !current) {
        throw error;
      }
      this.log('error', `Error fetching contents from folder "${url}": `, error);
      this.log('warn', 'Download will be missing some galleries');
      this.#updateStatsOnError(error, stats);
    }
    if (nextURL) {
      this.log('debug', `Fetching next set of items from "${nextURL}"`);
      await this.#getFavoritesFolder(nextURL, stats, signal, current);
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
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': URLHelper.constructImageNavRefererURL({ referrerImageID, galleryID: id })
      };
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

    if (this.config.fullFilenames) {
      await this.#updateImageLinksWithFullTitle(imageLinks, signal);
    }

    images.forEach((image) => {
      const link = imageLinks.find((l) => l.id === image.id);
      if (link) {
        image.title = link.fullTitle || link.title;
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
    current?: { id?: number; uploader?: User; description?: string; title: string; imageLinks: ImageLink[], html: string }) {

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
      if (this.#isErrorNonContinuable(error, signal) || !current) {
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

  async #updateImageLinksWithFullTitle(links: ImageLink[], signal?: AbortSignal) {
    this.log('debug', 'Fetching full image titles');
    for (const link of links) {
      const {html} = await this.#fetchPage(link.url, signal);
      const title = this.parser.getImageTitleFromPhotoPage(html);
      if (title) {
        link.fullTitle = title;
      }
    }
  }

  async #getImagesByLink(links: ImageLink[], signal?: AbortSignal): Promise<Image[]> {
    const __doGet = async (link: ImageLink) => {
      this.log('debug', `Fetching image info from ${link.url}`);
      const {html} = await this.#fetchPage(link.url, signal);
      return this.parser.parsePhotoPage(html);
    };
    const images = await Promise.all(links.map((link) => __doGet(link)));
    return images.filter((image) => image !== null) as Image[];
  }

  #isErrorNonContinuable(error: any, signal?: AbortSignal) {
    return signal?.aborted || (error instanceof FetcherError && error.fatal);
  }

  #getGallerySavePath(gallery: Gallery | null, context: DownloadContext ) {
    const gallerySavePathParts:string[] = [];
    if (context.isFavorite) {
      if (this.config.dirStructure.user && context.galleryFolder?.owner) {
        gallerySavePathParts.push(sanitizeFilename(`${context.galleryFolder.owner.username} (${context.galleryFolder.owner.id})`));
      }
      if (this.config.dirStructure.favorites) {
        gallerySavePathParts.push('Favorites');
      }
    }
    else if (this.config.dirStructure.user && gallery?.uploader) {
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
    if (this.config.dirStructure.gallery && gallery) {
      if (gallery.id) {
        gallerySavePathParts.push(sanitizeFilename(`${gallery.title} (${gallery.id})`));
      }
      else {
        gallerySavePathParts.push(sanitizeFilename(gallery.title));
      }
    }
    return path.resolve(this.config.outDir, gallerySavePathParts.join(path.sep));
  }

  async #downloadImage(image: Image, destDir: string, index: number, stats: DownloadStats, signal: AbortSignal | undefined) {
    let filename: string;
    const ext = path.parse(new URL(image.src).pathname).ext;
    const prefix = this.config.seqFilenames ? `${index} - ` : '';
    if (image.title) {
      const name = path.parse(image.title).name;
      filename = sanitizeFilename(`${prefix}${name} (${image.id})${ext}`);
    }
    else {
      filename = sanitizeFilename(`${prefix}${image.id}${ext}`);
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
      if (this.#isErrorNonContinuable(error, signal)) {
        throw error;
      }
      this.log('error', `Error downloading "${filename}" from "${image.src}": `, error);
      this.#updateStatsOnError(error, stats);
    }
  }
}
