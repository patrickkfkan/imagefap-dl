import * as fs from 'fs';
import { pipeline } from 'stream/promises';
import { URL } from 'url';
import path from 'path';
import Logger, { LogLevel, commonLog } from './logging/Logger.js';
import { ensureDirSync } from 'fs-extra';
import { sleepBeforeExecute } from './Misc.js';
import { SITE_URL } from './URLHelper.js';

export interface DownloadImageParams {
  // Image src (URL)
  src: string;
  // Destination path
  dest: string;
  signal?: AbortSignal;
}

export interface StartDownloadOverrides {
  destFilePath?: string;
  tmpFilePath?: string;
}

export class FetcherError extends Error {

  url: string;
  fatal: boolean;

  constructor(message: string, url: string, fatal = false) {
    super(message);
    this.name = 'FetcherError';
    this.url = url;
    this.fatal = fatal;
  }
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0';

export default class Fetcher {

  name = 'Fetcher';

  #logger?: Logger | null;
  #cookie: string | null;

  constructor(logger: Logger | null | undefined, cookie: string | null) {
    this.#logger = logger;
    this.#cookie = cookie;
  }

  static async getInstance(logger?: Logger | null) {
    const request = new Request(SITE_URL, { method: 'GET' });
    const res = await fetch(request, { redirect: 'manual' });
    const cookie = res.headers.get('set-cookie');
    return new Fetcher(logger, cookie);
  }

  async fetchHTML(args: {
    url: string,
    maxRetries: number,
    retryInterval: number,
    signal?: AbortSignal,
    headers?: Headers
  }, rt = 0): Promise<{html: string, lastURL: string}> {

    const { url, maxRetries, retryInterval, signal, headers } = args;
    const urlObj = new URL(url);
    const request = new Request(urlObj, { method: 'GET', headers });
    this.#setHeaders(request);
    try {
      const res = await fetch(request, { signal });

      if (new URL(res.url).pathname === '/human-verification') {
        throw new FetcherError('Too many requests: try increasing the value of --min-time-page and decreasing --max-concurrent', url, true);
      }

      return {
        html: await res.text(),
        lastURL: res.url
      };
    }
    catch (error) {
      if (signal?.aborted || (error instanceof FetcherError && error.fatal)) {
        throw error;
      }
      if (rt < maxRetries) {
        this.log('error', `Error fetching "${url} - will retry: `, error);
        return sleepBeforeExecute(() => this.fetchHTML({ url, maxRetries, retryInterval, signal }, rt + 1), retryInterval);
      }
      const errMsg = error instanceof Error ? error.message : error;
      const retriedMsg = rt > 0 ? ` (retried ${rt} times)` : '';
      throw new FetcherError(`${errMsg}${retriedMsg}`, urlObj.toString());
    }
  }

  async downloadImage(params: DownloadImageParams): Promise<void> {
    const { src, dest, signal } = params;
    const request = new Request(src, { method: 'GET' });
    this.#setHeaders(request);
    const res = await fetch(request, { signal });
    if (this.#assertResponseOK(res, src)) {
      const destFilePath = path.resolve(dest);
      const { dir: destDir, base: destFilename } = path.parse(destFilePath);
      const tmpFilePath = path.resolve(destDir, `${destFilename}.part`);
      try {
        ensureDirSync(destDir);
        this.log('debug', `Download: "${src}" -> "${tmpFilePath}"`);
        await pipeline(
          res.body,
          fs.createWriteStream(tmpFilePath)
        );
        this.#commitDownload(tmpFilePath, destFilePath);
        return;
      }
      catch (error) {
        this.#cleanupDownload(tmpFilePath);
        throw error;
      }
    }

    return undefined as never;
  }

  #commitDownload(tmpFilePath: string, destFilePath: string) {
    try {
      this.log('debug', `Commit: "${tmpFilePath}" -> "${destFilePath} (filesize: ${fs.lstatSync(tmpFilePath).size} bytes)`);
      fs.renameSync(tmpFilePath, destFilePath);
    }
    finally {
      this.#cleanupDownload(tmpFilePath);
    }
  }

  #cleanupDownload(tmpFilePath: string) {
    try {
      if (fs.existsSync(tmpFilePath)) {
        this.log('debug', `Cleanup "${tmpFilePath}"`);
        fs.unlinkSync(tmpFilePath);
      }
    }
    catch (error) {
      this.log('error', `Cleanup error "${tmpFilePath}":`, error);
    }
  }

  #setHeaders(request: Request) {
    request.headers.set('User-Agent', USER_AGENT);
    if (this.#cookie) {
      request.headers.set('Cookie', this.#cookie);
    }
  }

  #assertResponseOK(response: Response | null, originURL: string, requireBody: false): response is Response;
  #assertResponseOK(response: Response | null, originURL: string, requireBody?: true): response is Response & { body: NodeJS.ReadableStream };
  #assertResponseOK(response: Response | null, originURL: string, requireBody = true) {
    if (!response) {
      throw new FetcherError('No response', originURL);
    }
    if (!response.ok) {
      throw new FetcherError(`${response.status} - ${response.statusText}`, originURL);
    }
    if (requireBody && !response.body) {
      throw new FetcherError('Empty response body', originURL);
    }
    return true;
  }

  protected log(level: LogLevel, ...msg: Array<any>) {
    commonLog(this.#logger, level, this.name, ...msg);
  }
}
