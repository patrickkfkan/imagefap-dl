import { URL } from 'url';
import { DownloadTargetType } from '../ImageFapDownloader.js';

export const SITE_URL = 'https://www.imagefap.com';

const userGalleriesPathnameRegex = /^\/profile\/(.+)\/galleries/;
const galleryFolderPathnameRegex = /^\/organizer\/(.+)\//;
const galleryPathnameRegex = /^\/pictures\/(.+)\/|^\/pictures\/(.+)|^\/gallery\/(.+)/;
const photoPathnameRegex = /^\/photo\/(.+)\/|^\/photo\/(.+)/;

export default class URLHelper {

  static getTargetTypeByURL(url: string): DownloadTargetType {
    let urlObj;
    try {
      urlObj = new URL(url);
    }
    catch (error) {
      throw Error('Invalid URL');
    }

    if (urlObj.host !== 'imagefap.com' && urlObj.host !== 'www.imagefap.com') {
      throw Error('Invalid URL: hostname does not match "imagefap.com"');
    }

    const pathname = urlObj.pathname;
    const searchParams = urlObj.searchParams;

    if (pathname === '/') {
      throw Error('Invalid URL: no pathname');
    }

    const userGalleriesMatch = userGalleriesPathnameRegex.exec(pathname);
    if (userGalleriesMatch) {
      if (searchParams.has('folderid')) {
        return 'galleryFolder';
      }
      return 'userGalleries';
    }

    const galleryFolderMatch = galleryFolderPathnameRegex.exec(pathname);
    if (galleryFolderMatch || (pathname === '/usergallery.php' && searchParams.has('userid') && searchParams.has('folderid'))) {
      return 'galleryFolder';
    }

    const galleryMatch = galleryPathnameRegex.exec(pathname);
    if (galleryMatch || (pathname === '/gallery.php' && searchParams.has('gid'))) {
      return 'gallery';
    }

    const photoMatch = photoPathnameRegex.exec(pathname);
    if (photoMatch) {
      return 'photo';
    }

    if (pathname === '/showfavorites.php' && searchParams.has('userid')) {
      if (searchParams.has('folderid')) {
        return 'favoritesFolder';
      }
      return 'favorites';
    }

    throw Error(`Could not determine operation type by URL "${url}"`);
  }

  static constructUserGalleriesURL(username: string) {
    return `${SITE_URL}/profile/${username}/galleries`;
  }

  static parsePhotoURLPathname(pathname: string) {
    const photoMatch = photoPathnameRegex.exec(pathname);
    if (photoMatch && (photoMatch[1] || photoMatch[2])) {
      return { photoID: photoMatch[1] || photoMatch[2] };
    }
    return null;
  }

  static constructImageNavURL(args: {
    referrerImageID: number;
    galleryID?: number;
    startIndex: number;
  }) {
    return `${SITE_URL}/photo/${args.referrerImageID}/?gid=${args.galleryID}&idx=${args.startIndex}&partial=true`;
  }

  static constructImageNavRefererURL(args: {
    referrerImageID: number;
    galleryID?: number;
  }) {
    return `${SITE_URL}/photo/${args.referrerImageID}/?pgid=&gid=${args.galleryID}&page=0`;
  }
}
