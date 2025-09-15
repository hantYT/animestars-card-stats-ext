export interface CardData {
  cardId: number;
  cardName: string;
  cardRank: string;
  cardImage: string;
  cardmp4: string;
  cardwebm: string;
  cardAuthor: string;
  animeLink: string;
  animeName: string;
  cardLink: string;
  animeId: number;
  users: number;
  need: number;
  trade: number;
  lastUpdate: string;
}

export interface DatabaseInfo {
  releaseId: number;
  version: string;
  timestamp: string;
  totalCards: number;
  filename?: string;
  downloadUrl?: string;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  published_at: string;
  assets: GitHubAsset[];
}

export interface GitHubAsset {
  id: number;
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

export interface CardStats {
  users: number;
  need: number;
  trade: number;
}

export interface CardElement {
  element: HTMLElement;
  cardId: number;
  cardName?: string;
}

export interface CardSelector {
  selector: string;
  dataIdAttribute: string;
  dataNameAttribute?: string;
  insertionMethod: 'append' | 'prepend' | 'before' | 'after';
  targetSelector?: string; // Где именно вставлять оверлей внутри элемента
}
