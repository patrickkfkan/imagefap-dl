export interface Image {
  id: number;
  title?: string;
  src: string;
  views?: number;
  dimension?: string;
  dateAdded?: string;
  rating?: number;
}

export interface ImageLink {
  id: number;
  url: string;
  title?: string;
}
