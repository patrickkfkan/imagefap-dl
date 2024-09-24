import { GalleryLink } from './Gallery.js';
import { Image } from './Image.js';
import { User } from './User.js';

export interface GalleryFolder {
  url: string;
  id?: number;
  owner?: User;
  title?: string;
  galleryLinks: GalleryLink[];
}

export interface GalleryFolderLink {
  url: string;
  id: number;
  title: string;
  selected: boolean;
}

export interface FavoritesFolder extends GalleryFolder {
  images: Image[];
}
