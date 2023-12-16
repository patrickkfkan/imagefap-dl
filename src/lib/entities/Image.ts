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
  url: string;
  title?: string;
}
