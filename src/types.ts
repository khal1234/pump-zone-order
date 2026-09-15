export type FilterKey = "all" | "nofull" | "nofullremix" | "normal" | "onlyshort";
export type TabKey = "search" | "zones" | "recent";

export interface PositionSet {
  all?: number;
  nofull?: number;
  nofullremix?: number;
  normal?: number;
  onlyshort?: number;
}

export interface FinderEntry {
  t: string;
  f: PositionSet;
}

export interface NavIndex {
  alias: Record<string, string>;
  cats: Record<string, Array<{ tile: string; pos: number; total: number }>>;
  channel: Record<string, { kind: string; pos: number; total: number; fix?: boolean }>;
  chartsOf: Record<string, string[]>;
  levels: Record<string, PositionSet>;
  levelTotals: Record<string, PositionSet>;
  levelFold: Record<string, string>;
  series: Record<string, { zone: string; pos: PositionSet }>;
  seriesTotals: Record<string, PositionSet>;
}

export interface FinderData {
  alias: Record<string, string>;
  catSongs: Record<string, string[]>;
  channelSongs: Record<string, string[]>;
  coopSongs: Array<{ t: string; n: number; people?: string }>;
  levelSongs: Record<string, FinderEntry[]>;
  levelTotals: Record<string, PositionSet>;
  subs: Record<string, string[]>;
  seriesOrder: string[];
  seriesSongs: Record<string, FinderEntry[]>;
  seriesTotals: Record<string, PositionSet>;
  tiles: Array<{ name: string; ch: string; locked: boolean }>;
}

export interface EvidenceRow {
  title: string;
  zone: string;
  position: string;
  grade: string;
  source?: string;
  evidenceId?: string;
}

export interface PublicContract {
  schemaVersion: number;
  contentHash: string;
  generatedAt: string | null;
  game: { name: string; contentThrough: string };
  songs: Array<{ id: string; title: string }>;
  navIndex: NavIndex;
  finder: FinderData;
  evidence: Record<string, EvidenceRow[]>;
  search: { schemaVersion: number; file: string; sha256: string };
}

export interface CurrentPointer {
  schemaVersion: number;
  contentHash: string;
  dataUrl: string;
  searchUrl: string;
  game: { name: string; contentThrough: string };
}

export interface LocationItem {
  id: string;
  kind: "level" | "series" | "channel" | "category";
  label: string;
  sublabel: string;
  position: number;
  total: number;
  listKey: string;
}

export interface ZoneSelection {
  kind: "level" | "series" | "channel" | "category";
  key: string;
  label: string;
}
