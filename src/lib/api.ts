import { invoke } from "@tauri-apps/api/core";
import type {
  DiskInfo,
  Recommendation,
  ScanSummary,
  TrashResult,
  TreeItem,
} from "@/lib/types";

export const api = {
  startScan: () => invoke<ScanSummary>("start_scan"),
  cancelScan: () => invoke<void>("cancel_scan"),
  getTree: (path: string | null, depth = 2) =>
    invoke<TreeItem>("get_tree", { path, depth }),
  getRecommendations: () => invoke<Recommendation[]>("get_recommendations"),
  diskInfo: () => invoke<DiskInfo>("disk_info"),
  trashPaths: (paths: string[]) => invoke<TrashResult>("trash_paths", { paths }),
};
