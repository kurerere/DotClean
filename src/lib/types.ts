export type Category = "media" | "other" | "code" | "sdk" | "ai" | "cache";
export type Safety = "safe" | "review";

export interface TreeItem {
  name: string;
  path: string | null;
  size: number;
  kind: "dir" | "file" | "files" | "rest";
  category: Category;
  cleanable: Safety | null;
  fileCount: number;
  expandable: boolean;
  children: TreeItem[];
}

export interface MatchedPath {
  path: string;
  size: number;
}

export interface Recommendation {
  id: string;
  title: string;
  subtitle: string;
  safety: Safety;
  approx: boolean;
  size: number;
  paths: MatchedPath[];
}

export interface ScanSummary {
  home: string;
  size: number;
  files: number;
  millis: number;
  cancelled: boolean;
}

export interface ScanProgress {
  files: number;
  bytes: number;
}

export interface DiskInfo {
  total: number;
  free: number;
}

export interface TrashResult {
  trashed: string[];
  failed: [string, string][];
  bytes: number;
}

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "media", label: "Documents & media" },
  { id: "other", label: "Dev tools & other" },
  { id: "code", label: "Code projects" },
  { id: "sdk", label: "iOS & Android SDKs" },
  { id: "ai", label: "AI models" },
  { id: "cache", label: "Package caches" },
];
