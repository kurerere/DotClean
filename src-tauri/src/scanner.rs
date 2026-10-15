use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use rayon::prelude::*;

/// Files at or above this size are kept as individual tree nodes; smaller
/// files are folded into their parent's `small_files` total to keep memory low.
const LARGE_FILE: u64 = 1024 * 1024;

const PROJECT_MARKERS: &[&str] = &[
    ".git",
    "package.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "build.gradle",
    "pom.xml",
    "Package.swift",
];

#[derive(Debug, Default)]
pub struct Node {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_project: bool,
    pub small_files: u64,
    pub file_count: u64,
    pub children: Vec<Node>,
}

impl Node {
    pub fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|c| c.name == name)
    }

    /// Resolves a path relative to this node, e.g. `["Library", "Caches"]`.
    pub fn find(&self, rel: &[&str]) -> Option<&Node> {
        rel.iter().try_fold(self, |node, part| node.child(part))
    }

    /// Removes the node at `rel` and subtracts its size from every ancestor.
    pub fn remove(&mut self, rel: &[&str]) -> Option<u64> {
        let (first, rest) = rel.split_first()?;
        let idx = self.children.iter().position(|c| c.name == *first)?;
        let removed = if rest.is_empty() {
            let node = self.children.remove(idx);
            self.file_count = self.file_count.saturating_sub(node.file_count.max(1));
            node.size
        } else {
            let before = self.children[idx].file_count;
            let size = self.children[idx].remove(rest)?;
            let after = self.children[idx].file_count;
            self.file_count = self.file_count.saturating_sub(before - after);
            size
        };
        self.size = self.size.saturating_sub(removed);
        Some(removed)
    }
}

#[derive(Default)]
pub struct Progress {
    pub files: AtomicU64,
    pub bytes: AtomicU64,
    pub cancel: AtomicBool,
}

impl Progress {
    pub fn reset(&self) {
        self.files.store(0, Ordering::Relaxed);
        self.bytes.store(0, Ordering::Relaxed);
        self.cancel.store(false, Ordering::Relaxed);
    }
}

/// Recursively measures `root` using allocated blocks (so sparse files such as
/// Docker.raw report their real footprint). Symlinks are never followed and
/// other volumes are skipped.
pub fn scan(root: &Path, progress: &Progress) -> Node {
    let dev = fs::symlink_metadata(root).map(|m| m.dev()).unwrap_or(0);
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "/".into());
    let pool = rayon::ThreadPoolBuilder::new()
        .stack_size(16 * 1024 * 1024)
        .build()
        .expect("failed to build scan thread pool");
    pool.install(|| scan_dir(root.to_path_buf(), name, dev, progress))
}

fn scan_dir(path: PathBuf, name: String, dev: u64, progress: &Progress) -> Node {
    let mut node = Node {
        name,
        is_dir: true,
        ..Default::default()
    };
    if progress.cancel.load(Ordering::Relaxed) {
        return node;
    }
    let Ok(entries) = fs::read_dir(&path) else {
        return node;
    };

    let mut subdirs = Vec::new();
    let (mut files, mut bytes) = (0u64, 0u64);
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let fname = entry.file_name().to_string_lossy().into_owned();
        if PROJECT_MARKERS.contains(&fname.as_str()) {
            node.is_project = true;
        }
        let ft = meta.file_type();
        if ft.is_dir() {
            if meta.dev() == dev {
                subdirs.push((entry.path(), fname));
            }
            continue;
        }
        let size = meta.blocks() * 512;
        files += 1;
        bytes += size;
        if ft.is_file() && size >= LARGE_FILE {
            node.children.push(Node {
                name: fname,
                size,
                file_count: 1,
                ..Default::default()
            });
        } else {
            node.small_files += size;
        }
    }
    progress.files.fetch_add(files, Ordering::Relaxed);
    progress.bytes.fetch_add(bytes, Ordering::Relaxed);

    let dirs: Vec<Node> = subdirs
        .into_par_iter()
        .map(|(p, n)| scan_dir(p, n, dev, progress))
        .collect();
    node.file_count = files + dirs.iter().map(|d| d.file_count).sum::<u64>();
    node.children.extend(dirs);
    node.size = node.small_files + node.children.iter().map(|c| c.size).sum::<u64>();
    node.children.sort_unstable_by(|a, b| b.size.cmp(&a.size));
    node
}
