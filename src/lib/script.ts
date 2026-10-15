import { formatBytes } from "@/lib/format";
import type { Recommendation } from "@/lib/types";

function shellPath(path: string, home: string): string {
  const escaped = (p: string) => p.replace(/(["\\$`])/g, "\\$1");
  if (path.startsWith(home + "/")) return `"$HOME/${escaped(path.slice(home.length + 1))}"`;
  return `"${escaped(path)}"`;
}

export function buildScript(recs: Recommendation[], home: string): string {
  const total = recs.reduce((s, r) => s + r.size, 0);
  const lines = [
    "#!/bin/sh",
    `# DotClean cleanup script, generated ${new Date().toISOString().slice(0, 10)}`,
    `# Frees about ${formatBytes(total)}. Review each line before running.`,
    "set -e",
  ];
  for (const rec of recs) {
    lines.push("", `# ${rec.title} (${formatBytes(rec.size)})`);
    for (const p of rec.paths) lines.push(`rm -rf ${shellPath(p.path, home)}`);
  }
  return lines.join("\n") + "\n";
}
