use serde::Serialize;

use crate::rules::{Recommendation, Safety, is_within};
use crate::scanner::Node;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Media,
    Other,
    Code,
    Sdk,
    Ai,
    Cache,
}

/// Path prefixes (relative to home) that pin a category, checked in order so
/// more specific prefixes win (e.g. `.cache/huggingface` before `.cache`).
const PREFIXES: &[(&str, Category)] = &[
    (".cache/huggingface", Category::Ai),
    (".cache/lm-studio", Category::Ai),
    (".ollama", Category::Ai),
    (".lmstudio", Category::Ai),
    ("Library/Developer", Category::Sdk),
    ("Library/Android", Category::Sdk),
    (".android", Category::Sdk),
    ("Library/Caches", Category::Cache),
    ("Library/pnpm", Category::Cache),
    (".npm", Category::Cache),
    (".gradle", Category::Cache),
    (".cache", Category::Cache),
    (".cargo", Category::Cache),
    (".m2", Category::Cache),
    (".bun", Category::Cache),
    (".pnpm-store", Category::Cache),
    (".yarn", Category::Cache),
    ("Documents", Category::Media),
    ("Pictures", Category::Media),
    ("Movies", Category::Media),
    ("Music", Category::Media),
    ("Downloads", Category::Media),
];

const CODE_ROOTS: &[&str] = &[
    "Desktop", "Code", "code", "Projects", "projects", "Developer", "dev", "src", "repos",
    "workspace", "Workspace", "GitHub", "github", "work",
];

fn classify(rel: &str, depth: usize, node: &Node, parent: Category) -> Category {
    if let Some((_, cat)) = PREFIXES.iter().find(|(p, _)| is_within(rel, p)) {
        return *cat;
    }
    if parent != Category::Other {
        return parent;
    }
    if node.is_project || (depth == 1 && CODE_ROOTS.contains(&node.name.as_str())) {
        return Category::Code;
    }
    Category::Other
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Dir,
    File,
    /// Small files folded together by the scanner.
    Files,
    /// Children too small to draw, merged into one tile.
    Rest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeItem {
    pub name: String,
    pub path: Option<String>,
    pub size: u64,
    pub kind: ItemKind,
    pub category: Category,
    pub cleanable: Option<Safety>,
    pub file_count: u64,
    /// Whether drilling into this item would show anything beyond loose files.
    pub expandable: bool,
    pub children: Vec<TreeItem>,
}

const MAX_CHILDREN: usize = 40;
const MIN_SHARE: f64 = 0.003;

pub struct View<'a> {
    pub home: &'a str,
    pub marks: Vec<(&'a str, Safety)>,
}

impl<'a> View<'a> {
    pub fn new(home: &'a str, recs: &'a [Recommendation]) -> Self {
        let marks = recs
            .iter()
            .flat_map(|r| r.paths.iter().map(move |p| (p.path.as_str(), r.safety)))
            .collect();
        Self { home, marks }
    }

    /// Builds the view for the node at `abs`, returning `None` if it is not
    /// part of the scanned tree.
    pub fn build(&self, root: &Node, abs: &str, depth: u8) -> Option<TreeItem> {
        let rel = abs.strip_prefix(self.home)?.trim_start_matches('/');
        let parts: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
        let mut node = root;
        let mut cat = Category::Other;
        let mut rel_buf = String::new();
        for (i, part) in parts.iter().enumerate() {
            node = node.child(part)?;
            if i > 0 {
                rel_buf.push('/');
            }
            rel_buf.push_str(part);
            cat = classify(&rel_buf, i + 1, node, cat);
        }
        Some(self.item(node, abs.to_string(), rel_buf, parts.len(), cat, depth))
    }

    fn item(&self, node: &Node, abs: String, rel: String, depth: usize, cat: Category, levels: u8) -> TreeItem {
        let cleanable = self
            .marks
            .iter()
            .find(|(p, _)| is_within(&abs, p))
            .map(|(_, s)| *s);
        let mut children = Vec::new();
        if node.is_dir && levels > 0 {
            let min = (node.size as f64 * MIN_SHARE) as u64;
            let mut rest = (0u64, 0u64, 0usize);
            for child in &node.children {
                if children.len() < MAX_CHILDREN && child.size >= min && child.size > 0 {
                    let child_rel = if rel.is_empty() { child.name.clone() } else { format!("{rel}/{}", child.name) };
                    let child_cat = classify(&child_rel, depth + 1, child, cat);
                    let child_abs = format!("{abs}/{}", child.name);
                    children.push(self.item(child, child_abs, child_rel, depth + 1, child_cat, levels - 1));
                } else {
                    rest.0 += child.size;
                    rest.1 += child.file_count;
                    rest.2 += 1;
                }
            }
            if node.small_files > 0 {
                children.push(TreeItem {
                    name: "Other files".into(),
                    path: None,
                    size: node.small_files,
                    kind: ItemKind::Files,
                    category: cat,
                    cleanable,
                    file_count: 0,
                    expandable: false,
                    children: Vec::new(),
                });
            }
            if rest.0 > 0 {
                children.push(TreeItem {
                    name: format!("{} more", rest.2),
                    path: None,
                    size: rest.0,
                    kind: ItemKind::Rest,
                    category: cat,
                    cleanable,
                    file_count: rest.1,
                    expandable: false,
                    children: Vec::new(),
                });
            }
            children.sort_unstable_by(|a, b| b.size.cmp(&a.size));
        }
        TreeItem {
            name: node.name.clone(),
            path: Some(abs),
            size: node.size,
            kind: if node.is_dir { ItemKind::Dir } else { ItemKind::File },
            category: cat,
            cleanable,
            file_count: node.file_count,
            expandable: node.is_dir && !node.children.is_empty(),
            children,
        }
    }
}
