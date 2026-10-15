const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Decimal (1000-based) sizes, matching what Finder reports. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Shortens an absolute path under `home` to `~/...`. */
export function tildify(path: string, home: string): string {
  if (path === home) return "~";
  return path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}
