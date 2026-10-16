/// <reference types="vite/client" />

interface NavSearchHit {
  title: string;
  score: number;
}

interface NavSearchApi {
  schemaVersion: number;
  normalize(value: string): string;
  chosung(value: string): string;
  jamo(value: string): string;
  rankTitles(query: string, titles: string[], alternate?: (title: string) => string[]): NavSearchHit[];
}

interface Window {
  NAV_SEARCH?: NavSearchApi;
}

declare const __BUILD_ID__: string;
