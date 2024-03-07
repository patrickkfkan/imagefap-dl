import { convert as htmlToText } from 'html-to-text';
import { CheerioAPI, load as cheerioLoad } from 'cheerio';
import Logger, { LogLevel, commonLog } from '../utils/logging/Logger.js';
import { GalleryFolderLink } from '../entities/GalleryFolder.js';
import { GalleryLink } from '../entities/Gallery.js';
import { SITE_URL } from '../utils/URLHelper.js';
import { Image, ImageLink } from '../entities/Image.js';
import { User } from '../entities/User.js';

export default class Parser {

  name = 'Parser';

  #logger?: Logger | null;

  constructor(logger?: Logger | null) {
    this.#logger = logger;
  }

  protected log(level: LogLevel, ...msg: any[]) {
    commonLog(this.#logger, level, this.name, ...msg);
  }

  /*
  <input type="hidden" id="tgl_all" value="<folder_id_1>|<folder_id_2>|...">
  <a href="https://www.imagefap.com/usergallery.php?userid=...&folderid=..." class'blk_galleries'>...</a>
  ...
  */
  parseUserGalleriesPage(html: string): GalleryFolderLink[] {
    const $ = cheerioLoad(html);
    const folderIDs = $('input#tgl_all').attr('value')?.split('|');
    if (folderIDs) {
      return folderIDs.reduce<GalleryFolderLink[]>((result, id) => {
        const linkEl = $(`a[href^="https://www.imagefap.com/usergallery.php?userid"][href$="folderid=${id}"]`);
        if (linkEl.length > 0) {
          const linkHTML = linkEl.html();
          const selectedRegex = /^(?:<b>)(.+)(?:<\/b>)$/;
          const selectedMatch = linkHTML ? selectedRegex.exec(linkHTML) : null;
          const selected = !!(selectedMatch && selectedMatch[1]);
          const title = this.#htmlToText(linkHTML);
          const href = linkEl.attr('href');
          if (href && title) {
            result.push({
              url: href,
              id: Number(id),
              title,
              selected
            });
          }
        }
        return result;
      }, []);
    }
    return [];
  }

  /*
  <table>
    <tr id="gid-<gallery_id>">
      ...<a href="/gallery/<gallery_id">
    </tr>
    <tr> <-- row after all the <tr id="gid-<gallery_id>"> ones
      ...<a href="...">:: next ::</href>
    </tr>
  </table>
  */
  parseGalleryFolderPage(html: string, baseURL: string): { folder?: GalleryFolderLink; galleryLinks: GalleryLink[]; nextURL?: string; } {
    const $ = cheerioLoad(html);

    const links = $('table tr[id^="gid-"]')
      .map((_i, el) => {
        const trEl = $(el);
        const gidStr = trEl.attr('id');
        const gid = gidStr ? this.#checkNumber(gidStr.substring(4)) : undefined;
        if (gid !== undefined) {
          const linkEl = $(el).find(`a[href="/gallery/${gid}"]`);
          const title = this.#htmlToText(linkEl.html());
          const href = linkEl.attr('href');
          if (href && title) {
            const gl: GalleryLink = {
              id: Number(gid),
              url: new URL(href, baseURL).toString(),
              title
            };
            return gl;
          }
        }
      })
      .toArray()
      .filter((value) => value !== null);

    let nextURL: string | undefined;
    if (links.length > 0) {
      const lastTR =
        $(`table tr[id="gid-${links[0].id}"]`)
          .parents('table').first()
          .find('tr').last();
      const nextPageLink =
        lastTR.find('a')
          .filter((_i, el) => $(el).text() === ':: next ::')
          .first();
      const href = nextPageLink.attr('href');
      if (href) {
        nextURL = new URL(href, baseURL).toString();
      }
    }

    const folder = this.parseUserGalleriesPage(html).find((link) => link.selected);
    if (!folder) {
      this.log('warn', 'Expecting folder info from page, but got none');
    }

    return {
      galleryLinks: links,
      nextURL,
      folder
    };
  }

  /*
  <table>
    <input type="hidden" id="galleryid_input" name="galleryid_input" value="...">  <-- Capture galleryID
    ...<td>
      <div id="menubar">
        <table>
          ...<td>
              <font size="4" color="#CC0000">
                <gallery_title>
              </font>
              ...
              <font size="3" color="#CC0000">
                Uploaded by <user>
              </font>
          </td>
        </table>
      </div>
      ...
      <span id="cnt_description"></span>  <-- Description
      ...<font><span>
        ...<a href="?gid=<gallery_id>&page=<page_number>&view=0">:: next ::</a>
      </span></font>
      ...<table>
        ...<td id="<imageID>">
          <table>
            <tr>
              ...<a name="<imageID>" href="/photo/<imageID>/?pgid=&gid=...&page=0">
            </tr>
            <tr>
              <td>
                <font>...</font> <-- Description
                <font>...</font> <-- Name
                <font>...</font> <-- Image size
                <font>...</font> <-- Views
              </td>
            </tr>
          </table>
        </td>
      </table>
    </td>
  </table>
  */
  parseGalleryPage(html: string, baseURL: string): { id?: number, uploader?: User, title: string; description?: string; imageLinks: ImageLink[]; nextURL?: string; } {
    const $ = cheerioLoad(html);
    const links =
      $('a[href^="/photo/"]')
        .map((_i, el) => {
          const linkEl = $(el);
          const href = linkEl.attr('href');
          if (href) {
            const imageIDStr = href.split('/')[2];
            const imageID = this.#checkNumber(imageIDStr);
            if (imageID && linkEl.attr('name') === imageIDStr) {
              const nextRowEl = linkEl.parents('tr').first().nextAll('tr').first();
              const statEls = nextRowEl.find('font');
              const title = this.#htmlToText($(statEls.get(1)).html());
              const link: ImageLink = {
                id: imageID,
                url: new URL(href, baseURL).toString(),
                title
              };
              return link;
            }
          }
          return null;
        })
        .toArray()
        .filter((value) => value !== null);

    let nextURL: string | undefined;
    const nextPageLink =
      $('div#gallery a[href^="?gid="]')
        .filter((_i, el) => $(el).text() === ':: next ::')
        .first();
    const href = nextPageLink.attr('href');
    if (href) {
      nextURL = new URL(href, baseURL).toString();
    }

    const description = this.#htmlToText($('span#cnt_description').html());
    const title = $('head title').text();
    const galleryID = this.#checkNumber($('input#galleryid_input').attr('value'));
    const uploader = this.#parseUserFromPage($);

    return {
      id: galleryID,
      uploader,
      title,
      description,
      imageLinks: links,
      nextURL
    };
  }

  /*
  <div id="_navi_cavi" class="_navi_cavi" data-total="304" data-idx="3" ...>
    <ul class="thumbs">
      <li>
        <a original="..." views="..." added="..." dimension="..." votes="<score>|<count>" imageid="..." ...>...</a>
      </li>
      // If no results
      <input type="hidden" id="is_empty" value="1">
    </ul>
  </div>
  */
  parseImageNav(html: string): (Image | null)[] {
    const $ = cheerioLoad(html);
    const imageNav = $('div#_navi_cavi');
    if (this.#checkNumber(imageNav.find('input#is_empty').attr('value')) === 1) {
      return [];
    }
    const images = imageNav.find('ul.thumbs li a').map((_i, linkEl) => {
      const photo = $(linkEl);
      const id = this.#checkNumber(photo.attr('imageid'));
      const src = photo.attr('original');
      const views = this.#checkNumber(photo.attr('views'));
      const dateAdded = photo.attr('added');
      const dimension = photo.attr('dimension');
      const votes = photo.attr('votes');

      let rating: number | undefined;
      if (votes) {
        const [ score ] = votes.split('|');
        rating = this.#checkNumber(score);
      }

      if (id && src) {
        const image: Image = {
          id,
          src,
          views,
          dimension,
          dateAdded,
          rating
        };
        return image;
      }

      this.log('error', 'Error parsing image details: id or src missing');

      return null;
    })
      .toArray();

    return images;
  }

  #parseUserFromPage($: CheerioAPI): User | undefined {
    let userID: number | undefined;
    const userGalleriesHref = $('table td.mnu0 a[href^="https://www.imagefap.com/usergallery.php?userid="]').attr('href');
    if (userGalleriesHref) {
      const _userID = new URL(userGalleriesHref, SITE_URL).searchParams.get('userid');
      if (_userID && !isNaN(Number(_userID))) {
        userID = Number(_userID);
      }
    }
    const usernameHref = $('table td.mnu0 a[href^="https://www.imagefap.com/profile.php?user="]').attr('href');
    const usernameRegex = /https:\/\/www\.imagefap\.com\/profile\.php\?user=((?:(?!\/).)+)/;
    const usernameMatch = usernameHref ? usernameRegex.exec(usernameHref) : null;
    const username = usernameMatch && usernameMatch[1] ? usernameMatch[1] : null;

    return (username && userID && usernameHref) ? {
      username,
      id: userID,
      url: usernameHref
    } : undefined;
  }

  /*
  <noscript>
    <img id="mainPhoto" title="..." ...>
  </noscript>
  */
  getImageTitleFromPhotoPage(html: string): string | undefined {
    // https://github.com/cheeriojs/cheerio/issues/1105
    const $ = cheerioLoad(html, { scriptingEnabled: false });
    const photo = $('img#mainPhoto');
    return photo.attr('title');
  }

  #checkNumber(value?: string | null) {
    if (!isNaN(Number(value))) {
      return Number(value);
    }
    return undefined;
  }

  #htmlToText(value?: string | null) {
    if (value === undefined || value === null) {
      return undefined;
    }
    return htmlToText(value);
  }
}
