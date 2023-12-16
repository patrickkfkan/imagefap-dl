import { Image } from './Image.js';
import { User } from './User.js';

export interface Gallery {
  id?: number;
  title: string;
  uploader: User;
  description?: string;
  images: Image[];
}

export interface GalleryLink {
  url: string;
  id: number;
  title: string;
}
