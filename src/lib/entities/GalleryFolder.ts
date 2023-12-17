import { GalleryLink } from './Gallery.js';

export interface GalleryFolder {
  url: string;
  id?: number;
  title?: string;
  galleryLinks: GalleryLink[];
}

export interface GalleryFolderLink {
  url: string;
  id: number;
  title: string;
  selected: boolean;
}
