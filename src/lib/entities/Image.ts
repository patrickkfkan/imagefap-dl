import { User } from './User';

export interface Image {
  id: number;
  title?: string;
  src: string;
  views?: number;
  dimension?: string;
  dateAdded?: string;
  rating?: number;
  uploader?: User;
}

export interface ImageLink {
  id: number;
  url: string;
  title?: string;
  fullTitle?: string;
}
