use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::scanner::Node;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Safety {
    Safe,
    Review,
}

enum Matcher {
    /// Fixed locations relative to the home folder.
    Paths(&'static [&'static str]),
    /// Directories found anywhere in user content (outside `~/Library` and
    /// top-level dot folders) whose name matches and that pass the predicate.
    Find {
        names: &'static [&'static str],
        accept: fn(&Path) -> bool,
    },
}

struct Rule {
    id: &'static str,
    title: &'static str,
    subtitle: &'static str,
    safety: Safety,
    approx: bool,
    matcher: Matcher,
}

const IDLE_AFTER: Duration = Duration::from_secs(30 * 24 * 3600);

/// Evaluated in order: a path already claimed by an earlier rule (or nested
/// inside one) is not counted again, so containers like worktrees come first.
const RULES: &[Rule] = &[
    Rule {
        id: "worktrees",
        title: "Claude worktrees",
        subtitle: "~/*/.claude/worktrees",
        safety: Safety::Review,
        approx: true,
        matcher: Matcher::Find {
            names: &["worktrees"],
            accept: |p| p.parent().and_then(|d| d.file_name()).is_some_and(|n| n == ".claude"),
        },
    },
    Rule {
        id: "npm",
        title: "npm cache",
        subtitle: "~/.npm",
        safety: Safety::Safe,
        approx: false,
        matcher: Matcher::Paths(&[".npm/_cacache", ".npm/_npx", ".npm/_logs"]),
    },
    Rule {
        id: "pnpm-yarn-bun",
        title: "pnpm, Yarn & Bun caches",
        subtitle: "~/Library/pnpm/store, ~/Library/Caches/Yarn, ~/.bun/install/cache",
        safety: Safety::Safe,
        approx: false,
        matcher: Matcher::Paths(&[
            "Library/pnpm/store",
            "Library/Caches/pnpm",
            "Library/Caches/Yarn",
            ".bun/install/cache",
        ]),
    },
    Rule {
        id: "build-output",
        title: "Next.js & Turbo build output",
        subtitle: "~/*/.next, .turbo",
        safety: Safety::Safe,
        approx: false,
        matcher: Matcher::Find {
            names: &[".next", ".turbo"],
            accept: |_| true,
        },
    },
    Rule {
        id: "gradle",
        title: "Gradle caches",
        subtitle: "~/.gradle",
        safety: Safety::Safe,
        approx: false,
        matcher: Matcher::Paths(&[".gradle/caches", ".gradle/wrapper/dists", ".gradle/daemon"]),
    },
    Rule {
        id: "xcode-derived",
        title: "Xcode DerivedData",
        subtitle: "~/Library/Developer/Xcode",
        safety: Safety::Safe,
        approx: false,
        matcher: Matcher::Paths(&["Library/Developer/Xcode/DerivedData"]),
    },
    Rule {
        id: "py-browser",
        title: "uv, pip & Puppeteer caches",
        subtitle: "~/.cache/uv, ~/.cache/puppeteer",
        safety: Safety::Safe,
        approx: false,
        matcher: Matcher::Paths(&[
            ".cache/uv",
            ".cache/puppeteer",
            ".cache/pip",
            "Library/Caches/pip",
            "Library/Caches/ms-playwright",
        ]),
    },
    Rule {
        id: "homebrew",
        title: "Homebrew downloads",
        subtitle: "~/Library/Caches/Homebrew",
        safety: Safety::Safe,
        approx: false,
        matcher: Matcher::Paths(&["Library/Caches/Homebrew"]),
    },
    Rule {
        id: "go-cargo",
        title: "Go & Cargo caches",
        subtitle: "~/Library/Caches/go-build, ~/.cargo/registry",
        safety: Safety::Safe,
        approx: false,
        matcher: Matcher::Paths(&[
            "Library/Caches/go-build",
            ".cargo/registry/cache",
            ".cargo/registry/src",
        ]),
    },
    Rule {
        id: "cocoapods",
        title: "CocoaPods cache",
        subtitle: "~/Library/Caches/CocoaPods",
        safety: Safety::Safe,
        approx: false,
        matcher: Matcher::Paths(&["Library/Caches/CocoaPods"]),
    },
    Rule {
        id: "android",
        title: "Android SDK & emulators",
        subtitle: "~/Library/Android, ~/.android",
        safety: Safety::Review,
        approx: false,
        matcher: Matcher::Paths(&["Library/Android/sdk", ".android/avd"]),
    },
    Rule {
        id: "ollama",
        title: "Ollama models",
        subtitle: "~/.ollama/models",
        safety: Safety::Review,
        approx: false,
        matcher: Matcher::Paths(&[".ollama/models"]),
    },
    Rule {
        id: "hf-lmstudio",
        title: "Hugging Face & LM Studio models",
        subtitle: "~/.cache/huggingface, ~/.lmstudio/models",
        safety: Safety::Review,
        approx: false,
        matcher: Matcher::Paths(&[".cache/huggingface", ".lmstudio/models", ".cache/lm-studio"]),
    },
    Rule {
        id: "xcode-device",
        title: "Xcode device support & archives",
        subtitle: "~/Library/Developer/Xcode/iOS DeviceSupport",
        safety: Safety::Review,
        approx: false,
        matcher: Matcher::Paths(&[
            "Library/Developer/Xcode/iOS DeviceSupport",
            "Library/Developer/Xcode/watchOS DeviceSupport",
            "Library/Developer/Xcode/Archives",
        ]),
    },
    Rule {
        id: "rust-target",
        title: "Rust build output",
        subtitle: "~/*/target",
        safety: Safety::Review,
        approx: false,
        matcher: Matcher::Find {
            names: &["target"],
            accept: |p| p.join("CACHEDIR.TAG").exists(),
        },
    },
    Rule {
        id: "node-modules",
        title: "node_modules in idle projects",
        subtitle: "~/*/node_modules · untouched 30+ days",
        safety: Safety::Review,
        approx: false,
        matcher: Matcher::Find {
            names: &["node_modules"],
            accept: |p| p.parent().is_some_and(is_idle),
        },
    },
];

fn is_idle(project: &Path) -> bool {
    let now = SystemTime::now();
    ["package.json", "."].iter().all(|f| {
        std::fs::metadata(project.join(f))
            .and_then(|m| m.modified())
            .map(|t| now.duration_since(t).unwrap_or_default() > IDLE_AFTER)
            .unwrap_or(true)
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchedPath {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub id: &'static str,
    pub title: &'static str,
    pub subtitle: &'static str,
    pub safety: Safety,
    pub approx: bool,
    pub size: u64,
    pub paths: Vec<MatchedPath>,
}

const MIN_SIZE: u64 = 1024 * 1024;

pub fn evaluate(home: &Path, root: &Node) -> Vec<Recommendation> {
    let mut claimed: Vec<String> = Vec::new();
    let mut recs: Vec<Recommendation> = RULES
        .iter()
        .filter_map(|rule| {
            let mut paths = Vec::new();
            match &rule.matcher {
                Matcher::Paths(list) => {
                    for rel in *list {
                        let parts: Vec<&str> = rel.split('/').collect();
                        if let Some(node) = root.find(&parts) {
                            paths.push(MatchedPath {
                                path: home.join(rel).to_string_lossy().into_owned(),
                                size: node.size,
                            });
                        }
                    }
                }
                Matcher::Find { names, accept } => {
                    let mut buf = home.to_path_buf();
                    for child in root.children.iter().filter(|c| is_user_content(c)) {
                        find(child, &mut buf, names, *accept, &mut paths);
                    }
                }
            }
            paths.retain(|p| p.size > 0 && !claimed.iter().any(|c| is_within(&p.path, c)));
            claimed.extend(paths.iter().map(|p| p.path.clone()));
            paths.sort_unstable_by(|a, b| b.size.cmp(&a.size));
            let size = paths.iter().map(|p| p.size).sum();
            (size >= MIN_SIZE).then_some(Recommendation {
                id: rule.id,
                title: rule.title,
                subtitle: rule.subtitle,
                safety: rule.safety,
                approx: rule.approx,
                size,
                paths,
            })
        })
        .collect();
    recs.sort_by(|a, b| (a.safety as u8, b.size).cmp(&(b.safety as u8, a.size)));
    recs
}

pub fn is_within(path: &str, base: &str) -> bool {
    path.strip_prefix(base)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

fn is_user_content(node: &Node) -> bool {
    node.is_dir && node.name != "Library" && !node.name.starts_with('.')
}

fn find(
    node: &Node,
    buf: &mut PathBuf,
    names: &[&str],
    accept: fn(&Path) -> bool,
    out: &mut Vec<MatchedPath>,
) {
    if !node.is_dir || node.size < MIN_SIZE {
        return;
    }
    buf.push(&node.name);
    if names.contains(&node.name.as_str()) && accept(buf) {
        out.push(MatchedPath {
            path: buf.to_string_lossy().into_owned(),
            size: node.size,
        });
    } else if node.name != "node_modules" && node.name != ".git" {
        for child in &node.children {
            find(child, buf, names, accept, out);
        }
    }
    buf.pop();
}
