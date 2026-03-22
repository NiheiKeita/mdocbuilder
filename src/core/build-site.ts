import fs from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";

const DEFAULT_THEME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/theme-default");

export type BuildConfig = {
  rootDir?: string;
  docsDir?: string;
  outDir?: string;
  basePath?: string;
  siteName?: string;
  github?: {
    repoUrl?: string;
    branch?: string;
    sourceRoot?: string;
  };
  theme?: {
    directory?: string;
    customCss?: string;
  };
};

export type ResolvedBuildConfig = {
  rootDir: string;
  docsDir: string;
  outDir: string;
  themeDir: string;
  customCssPath: string;
  basePath: string;
  siteName: string;
  repoUrl: string;
  sourceBranch: string;
  sourceRoot: string;
};

type Heading = {
  depth: number;
  text: string;
  slug: string;
};

type DocumentRecord = {
  title: string;
  description: string;
  path: string;
  sourcePath: string;
  headings: Heading[];
  plainText: string;
  updatedAt: string;
  directory: string;
  html: string;
  isIndex: boolean;
  isGeneratedIndex: boolean;
  fallbackName: string;
};

type DirectoryEntry = {
  kind: "group" | "page";
  title: string;
  path: string;
  description: string;
};

type DirectoryNode = {
  name: string;
  route: string;
  title: string;
  indexDocument: DocumentRecord | null;
  generatedDocument: DocumentRecord | null;
  documents: DocumentRecord[];
  children: Map<string, DirectoryNode>;
};

type BreadcrumbItem = {
  label: string;
  href: string | null;
};

let rootDir = process.cwd();
let docsDir = path.join(rootDir, "docs");
let distDir = path.join(rootDir, "dist");
let themeDir = DEFAULT_THEME_DIR;
let customCssPath = "";
let basePath = "/";
let siteName = humanizeSegment(path.basename(rootDir));
let repoUrl = "";
let sourceBranch = "main";
let sourceRoot = "";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(code, language) {
    if (language && hljs.getLanguage(language)) {
      const html = hljs.highlight(code, { language }).value;
      return `<pre><code class="hljs language-${escapeHtml(language)}">${html}</code></pre>`;
    }
    return `<pre><code class="hljs">${escapeHtml(code)}</code></pre>`;
  },
});

export async function buildSite(userConfig: BuildConfig = {}): Promise<void> {
  configureBuild(userConfig);
  await resetDist();

  const markdownFiles = await findMarkdownFiles(docsDir);
  const assetFiles = await findAssetFiles(docsDir);
  const sourceDocs = [];

  for (const absolutePath of markdownFiles) {
    const doc = await parseDocument(absolutePath);
    sourceDocs.push(doc);
  }

  const tree = buildDirectoryTree(sourceDocs);
  const generatedDocs = createGeneratedDirectoryDocs(tree);
  const docs = [...sourceDocs, ...generatedDocs];
  docs.sort((a, b) => a.path.localeCompare(b.path));

  const routeToDoc = new Map(docs.map((doc) => [doc.path, doc]));
  const routeTitleMap = new Map(
    docs.map((doc) => [
      doc.path,
      doc.title,
    ]),
  );

  for (const doc of docs) {
    const sectionEntries = getSectionEntries(tree, doc);
    const breadcrumbs = buildBreadcrumbs(doc, routeTitleMap);
    const bodyHtml = buildDocumentBodyHtml(doc, tree);
    const html = renderDocumentPage({
      doc,
      breadcrumbs,
      sectionEntries,
      bodyHtml,
    });
    await writePage(doc.path, html);
  }

  const listingPage = renderListingPage({ docs, tree });
  await writePage("/documents/", listingPage);

  const searchPage = renderSearchPage();
  await writePage("/search/", searchPage);

  const homeDoc = routeToDoc.get("/");
  if (!homeDoc) {
    const homePage = renderHomePage({ docs, tree });
    await writePage("/", homePage);
  }

  await copyClientAssets();
  await copyDocAssets(assetFiles);
  await writeDataFiles({ docs, tree });
  await fs.writeFile(path.join(distDir, ".nojekyll"), "");

  console.log(
    `Built ${sourceDocs.length} markdown document(s) and ${generatedDocs.length} generated directory page(s) into ${path.relative(rootDir, distDir)}.`,
  );
}

function configureBuild(userConfig: BuildConfig): void {
  const resolved = resolveBuildConfig(userConfig);
  rootDir = resolved.rootDir;
  docsDir = resolved.docsDir;
  distDir = resolved.outDir;
  themeDir = resolved.themeDir;
  customCssPath = resolved.customCssPath;
  basePath = resolved.basePath;
  siteName = resolved.siteName;
  repoUrl = resolved.repoUrl;
  sourceBranch = resolved.sourceBranch;
  sourceRoot = resolved.sourceRoot;
}

export function resolveBuildConfig(userConfig: BuildConfig = {}): ResolvedBuildConfig {
  const currentRoot = path.resolve(userConfig.rootDir || process.cwd());
  return {
    rootDir: currentRoot,
    docsDir: path.resolve(currentRoot, userConfig.docsDir || "docs"),
    outDir: path.resolve(currentRoot, userConfig.outDir || "dist"),
    themeDir: userConfig.theme?.directory
      ? path.resolve(currentRoot, userConfig.theme.directory)
      : DEFAULT_THEME_DIR,
    customCssPath: userConfig.theme?.customCss
      ? path.resolve(currentRoot, userConfig.theme.customCss)
      : "",
    basePath: normalizeBasePath(process.env.SITE_BASE ?? userConfig.basePath ?? "/"),
    siteName: userConfig.siteName || process.env.SITE_NAME || humanizeSegment(path.basename(currentRoot)),
    repoUrl: userConfig.github?.repoUrl || getGitHubRepoUrl(currentRoot),
    sourceBranch: userConfig.github?.branch || process.env.SOURCE_BRANCH || getGitBranch(currentRoot),
    sourceRoot: normalizeSourceRoot(userConfig.github?.sourceRoot || ""),
  };
}

async function resetDist() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });
}

async function findMarkdownFiles(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await findMarkdownFiles(absolutePath)));
      } else if (entry.isFile() && absolutePath.endsWith(".md")) {
        files.push(absolutePath);
      }
    }
    return files.sort();
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.mkdir(directory, { recursive: true });
      return [];
    }
    throw error;
  }
}

async function findAssetFiles(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await findAssetFiles(absolutePath)));
      } else if (entry.isFile() && !absolutePath.endsWith(".md") && entry.name !== ".gitkeep") {
        files.push(absolutePath);
      }
    }
    return files.sort();
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function parseDocument(absolutePath) {
  const source = await fs.readFile(absolutePath, "utf8");
  const relativeSourcePath = toPosix(path.relative(rootDir, absolutePath));
  const relativeDocPath = toPosix(path.relative(docsDir, absolutePath));
  const { data, content } = matter(source);
  const env = {};
  const tokens = md.parse(content, env);

  const headings = collectHeadings(tokens);
  assignHeadingIds(tokens, headings);
  rewriteRelativeLinks(tokens, absolutePath);

  const firstH1 = headings.find((heading) => heading.depth === 1)?.text || "";
  const title = deriveTitle({ data, firstH1, relativeDocPath });
  const renderTokens = stripLeadingTitleHeading(tokens, { data, firstH1 });
  const html = md.renderer.render(renderTokens, md.options, env);
  const paragraphs = collectParagraphs(tokens);
  const plainText = buildPlainText(tokens);
  const description = deriveDescription({
    data,
    paragraphs,
    plainText,
    title,
  });
  const stats = await fs.stat(absolutePath);
  const route = toRoutePath(relativeDocPath);
  const directory = getDirectoryPath(relativeDocPath);
  const isIndex = path.posix.basename(relativeDocPath) === "index.md";
  const routePath = route;

  return {
    title,
    description,
    path: routePath,
    sourcePath: relativeSourcePath,
    headings: headings.filter((heading) => heading.depth >= 2 && heading.depth <= 3),
    plainText,
    updatedAt: stats.mtime.toISOString(),
    directory,
    html,
    isIndex,
    isGeneratedIndex: false,
    fallbackName: fallbackDisplayName(relativeDocPath),
  };
}

function collectHeadings(tokens) {
  const seen = new Map();
  const headings = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "heading_open") {
      continue;
    }

    const inline = tokens[index + 1];
    if (!inline || inline.type !== "inline") {
      continue;
    }

    const text = collectInlineText(inline).trim();
    const depth = Number(token.tag.slice(1));
    const baseSlug = slugify(text);
    const occurrence = seen.get(baseSlug) || 0;
    seen.set(baseSlug, occurrence + 1);
    const slug = occurrence === 0 ? baseSlug : `${baseSlug}-${occurrence + 1}`;

    headings.push({ depth, text, slug });
  }

  return headings;
}

function assignHeadingIds(tokens, headings) {
  let headingIndex = 0;
  for (const token of tokens) {
    if (token.type === "heading_open") {
      const heading = headings[headingIndex];
      if (heading) {
        token.attrSet("id", heading.slug);
      }
      headingIndex += 1;
    }
  }
}

function rewriteRelativeLinks(tokens, sourceAbsolutePath) {
  const sourceDirectory = path.dirname(sourceAbsolutePath);

  for (const token of tokens) {
    rewriteTokenAttributes(token, sourceDirectory);
    if (token.children) {
      for (const child of token.children) {
        rewriteTokenAttributes(child, sourceDirectory);
      }
    }
  }
}

function rewriteTokenAttributes(token, sourceDirectory) {
  if (!token.attrs) {
    return;
  }

  for (const attributeName of ["href", "src"]) {
    const value = token.attrGet(attributeName);
    if (!value || isExternalLink(value)) {
      continue;
    }

    const rewritten = rewriteLinkValue(value, sourceDirectory);
    if (rewritten) {
      token.attrSet(attributeName, rewritten);
    }
  }
}

function rewriteLinkValue(value, sourceDirectory) {
  const [rawPath, rawHash = ""] = value.split("#");
  if (!rawPath) {
    return rawHash ? `#${rawHash}` : value;
  }

  const decodedPath = decodeURIComponent(rawPath);
  const docsRelative = decodedPath.startsWith("/")
    ? decodedPath.slice(1)
    : toPosix(path.relative(docsDir, path.resolve(sourceDirectory, decodedPath)));

  if (!docsRelative.startsWith("..") && docsRelative.endsWith(".md")) {
    const targetRoute = toRoutePath(docsRelative);
    return `${prefixBasePath(targetRoute)}${rawHash ? `#${rawHash}` : ""}`;
  }

  const absoluteTarget = decodedPath.startsWith("/")
    ? path.join(docsDir, decodedPath)
    : path.resolve(sourceDirectory, decodedPath);

  if (existsSync(absoluteTarget) && statSync(absoluteTarget).isDirectory()) {
    const directoryRelative = toPosix(path.relative(docsDir, absoluteTarget));
    if (!directoryRelative.startsWith("..")) {
      return `${prefixBasePath(`/${directoryRelative}/`)}${rawHash ? `#${rawHash}` : ""}`;
    }
  }

  const outputRelative = toPosix(path.relative(docsDir, absoluteTarget));
  if (!outputRelative.startsWith("..")) {
    return `${prefixBasePath(`/${outputRelative}`)}${rawHash ? `#${rawHash}` : ""}`;
  }

  return value;
}

function deriveTitle({ data, firstH1, relativeDocPath }) {
  if (typeof data.title === "string" && data.title.trim()) {
    return data.title.trim();
  }
  if (firstH1) {
    return firstH1;
  }
  return fallbackDisplayName(relativeDocPath);
}

function deriveDescription({ data, paragraphs, plainText, title }) {
  if (typeof data.description === "string" && data.description.trim()) {
    return data.description.trim();
  }

  const paragraph = paragraphs.find((item) => item && normalizeText(item) !== normalizeText(title));
  if (paragraph) {
    return truncate(paragraph, 180);
  }

  return truncate(plainText, 180);
}

function collectParagraphs(tokens) {
  const paragraphs = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type === "paragraph_open" && tokens[index + 1]?.type === "inline") {
      paragraphs.push(collectInlineText(tokens[index + 1]).trim());
    }
  }
  return paragraphs;
}

function buildPlainText(tokens) {
  const chunks = [];
  for (const token of tokens) {
    if (token.type === "inline") {
      const text = collectInlineText(token).trim();
      if (text) {
        chunks.push(text);
      }
    } else if (token.type === "fence" || token.type === "code_block") {
      const code = token.content.trim();
      if (code) {
        chunks.push(code);
      }
    }
  }
  return truncate(chunks.join(" ").replace(/\s+/g, " ").trim(), 2400);
}

function collectInlineText(token) {
  if (!token.children?.length) {
    return token.content || "";
  }

  return token.children
    .map((child) => {
      if (child.type === "text" || child.type === "code_inline") {
        return child.content;
      }
      if (child.type === "image") {
        return child.content || child.attrGet("alt") || "";
      }
      return "";
    })
    .join(" ");
}

function stripLeadingTitleHeading(tokens, { data, firstH1 }) {
  if (tokens.length < 3) {
    return tokens;
  }

  const [open, inline, close] = tokens;
  if (
    open?.type === "heading_open" &&
    open.tag === "h1" &&
    inline?.type === "inline" &&
    close?.type === "heading_close"
  ) {
    const h1Text = collectInlineText(inline).trim();
    if (!data.title || normalizeText(data.title) === normalizeText(firstH1 || h1Text)) {
      return tokens.slice(3);
    }
  }

  return tokens;
}

function buildDirectoryTree(docs) {
  const root = createTreeNode("", "/", "Home");

  for (const doc of docs) {
    const segments = doc.directory ? doc.directory.split("/") : [];
    let current = root;
    let currentRoute = "/";

    for (const segment of segments) {
      currentRoute = currentRoute === "/" ? `/${segment}/` : `${currentRoute}${segment}/`;
      if (!current.children.has(segment)) {
        current.children.set(segment, createTreeNode(segment, currentRoute, humanizeSegment(segment)));
      }
      current = current.children.get(segment);
    }

    if (doc.isIndex) {
      current.indexDocument = doc;
      current.title = doc.title;
    } else {
      current.documents.push(doc);
    }
  }

  return root;
}

function createTreeNode(name, route, title) {
  return {
    name,
    route,
    title,
    indexDocument: null,
    generatedDocument: null,
    documents: [],
    children: new Map(),
  };
}

function findTreeNode(tree, directory) {
  if (!directory) {
    return tree;
  }

  let current = tree;
  for (const segment of directory.split("/")) {
    current = current.children.get(segment);
    if (!current) {
      return null;
    }
  }
  return current;
}

function findTreeNodeByRoute(tree, route) {
  const normalized = route.replace(/^\/|\/$/g, "");
  if (!normalized) {
    return tree;
  }
  return findTreeNode(tree, normalized);
}

function createGeneratedDirectoryDocs(tree) {
  const generatedDocs = [];

  function visit(node) {
    if (node.route !== "/" && !node.indexDocument) {
      const entries = getDirectoryEntries(node);
      const generatedDoc = {
        title: node.title,
        description: `${node.title} 配下の一覧です。`,
        path: node.route,
        sourcePath: "",
        headings: [],
        plainText: [node.title, ...entries.map((entry) => `${entry.title} ${entry.description || ""}`)]
          .join(" ")
          .trim(),
        updatedAt: getLatestUpdatedAt(node),
        directory: parentDirectoryFromRoute(node.route),
        html: "",
        isIndex: true,
        isGeneratedIndex: true,
        fallbackName: node.title,
      };
      node.generatedDocument = generatedDoc;
      generatedDocs.push(generatedDoc);
    }

    for (const child of node.children.values()) {
      visit(child);
    }
  }

  visit(tree);
  return generatedDocs;
}

function getLatestUpdatedAt(node) {
  const timestamps = [];
  if (node.indexDocument?.updatedAt) {
    timestamps.push(node.indexDocument.updatedAt);
  }
  for (const doc of node.documents) {
    timestamps.push(doc.updatedAt);
  }
  for (const child of node.children.values()) {
    timestamps.push(getLatestUpdatedAt(child));
  }
  const valid = timestamps.filter(Boolean).sort();
  return valid.at(-1) || new Date().toISOString();
}

function getNodePageDocument(node) {
  return node.indexDocument || node.generatedDocument || null;
}

function getDirectoryEntries(node) {
  const entries = [];

  for (const childNode of node.children.values()) {
    entries.push(createDirectoryEntry(childNode));
  }

  for (const doc of node.documents) {
    entries.push(createDocumentEntry(doc));
  }

  return sortEntries(entries);
}

function getSectionEntries(tree, doc) {
  const node = doc.isIndex || doc.isGeneratedIndex
    ? findTreeNodeByRoute(tree, doc.path)
    : findTreeNode(tree, doc.directory);

  if (!node) {
    return [];
  }

  if (doc.isIndex || doc.isGeneratedIndex) {
    return getDirectoryEntries(node);
  }

  const entries = getDirectoryEntries(node).filter((entry) => entry.path !== doc.path);
  const sectionDoc = getNodePageDocument(node);
  if (sectionDoc && sectionDoc.path !== doc.path) {
    entries.unshift(createDocumentEntry(sectionDoc));
  }

  return sortEntries(entries);
}

function createDirectoryEntry(node) {
  const pageDoc = getNodePageDocument(node);
  return {
    kind: "group",
    title: pageDoc?.title || node.title,
    path: node.route,
    description: pageDoc?.description || summarizeNode(node),
  };
}

function createDocumentEntry(doc) {
  return {
    kind: "page",
    title: doc.title,
    path: doc.path,
    description: doc.description,
  };
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "group" ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });
}

function summarizeNode(node) {
  const parts = [];
  if (node.children.size) {
    parts.push(`${node.children.size} group${node.children.size === 1 ? "" : "s"}`);
  }
  if (node.documents.length) {
    parts.push(`${node.documents.length} page${node.documents.length === 1 ? "" : "s"}`);
  }
  return parts.join(" / ") || "Empty group";
}

function buildBreadcrumbs(doc, routeTitleMap) {
  if (doc.path === "/") {
    return [{ label: "Home", href: null }];
  }

  const crumbs = [{ label: "Home", href: "/" }];
  const segments = doc.path.replace(/^\/|\/$/g, "").split("/").filter(Boolean);
  let currentRoute = "/";

  segments.forEach((segment, index) => {
    currentRoute = currentRoute === "/" ? `/${segment}/` : `${currentRoute}${segment}/`;
    const isLast = index === segments.length - 1;
    const label = routeTitleMap.get(currentRoute) || humanizeSegment(segment);
    crumbs.push({
      label,
      href: isLast ? null : currentRoute,
    });
  });

  return crumbs;
}

function buildDocumentBodyHtml(doc, tree) {
  if (doc.isGeneratedIndex) {
    const node = findTreeNodeByRoute(tree, doc.path);
    return renderAutoDirectoryIndex(node);
  }

  return replaceDirectoryIndexMarker(doc.html, doc, tree);
}

function replaceDirectoryIndexMarker(html, doc, tree) {
  const embedded = renderEmbeddedDirectoryIndex(doc, tree);
  return html.replace(
    /<p>(?:\s*\{\{mdocbuildindex\}\}\s*)<\/p>/gi,
    embedded,
  );
}

function renderAutoDirectoryIndex(node) {
  if (!node) {
    return "";
  }

  return `
    <p>このページは <code>index.md</code> が無いため、自動生成された一覧ページです。表示するのはこの階層の直下だけです。</p>
    ${renderEmbeddedDirectoryEntries(getDirectoryEntries(node))}
  `;
}

function renderEmbeddedDirectoryIndex(doc, tree) {
  const node = doc.isIndex || doc.isGeneratedIndex
    ? findTreeNodeByRoute(tree, doc.path)
    : findTreeNode(tree, doc.directory);

  return renderEmbeddedDirectoryEntries(node ? getDirectoryEntries(node) : []);
}

function renderEmbeddedDirectoryEntries(entries) {
  return `
    <section class="directory-embed">
      <h2>このディレクトリの一覧</h2>
      ${entries.length ? renderEntryList(entries) : renderEmptyState("この階層にはまだ子ページがありません。", "Markdown を追加するとここに自動表示されます。")}
    </section>
  `;
}

function renderDocumentPage({ doc, breadcrumbs, sectionEntries, bodyHtml }) {
  const outline = doc.headings.length
    ? `
      <section class="sidebar-panel sidebar-panel-outline">
        <h2 class="sidebar-heading">On this page</h2>
        <ul class="sidebar-list">
          ${doc.headings
            .map(
              (heading) => `
                <li>
                  <a class="sidebar-link" href="#${escapeHtml(heading.slug)}">
                    <strong>${escapeHtml(heading.text)}</strong>
                  </a>
                </li>
              `,
            )
            .join("")}
        </ul>
      </section>
    `
    : "";

  const sectionLinks = doc.path !== "/" && sectionEntries.length
    ? `
      <section class="sidebar-panel sidebar-panel-nearby">
        <h2 class="sidebar-heading">${doc.isIndex || doc.isGeneratedIndex ? "In this directory" : "Nearby pages"}</h2>
        ${renderSidebarEntryList(sectionEntries)}
      </section>
    `
    : "";

  const githubActions = repoUrl && doc.sourcePath
    ? `
      <div class="article-actions">
        <a class="action-link" href="${escapeHtml(buildGitHubSourceUrl("blob", doc.sourcePath))}" target="_blank" rel="noreferrer">GitHubでこのページを見る</a>
        <a class="action-link" href="${escapeHtml(buildGitHubSourceUrl("edit", doc.sourcePath))}" target="_blank" rel="noreferrer">GitHubで編集する</a>
      </div>
    `
    : "";

  const content = `
    <div class="page-grid article-layout">
      <section class="article-panel article-main">
        ${renderBreadcrumbs(breadcrumbs)}
        <header class="page-header">
          <div class="page-kicker">${doc.isGeneratedIndex ? "Directory" : "Document"}</div>
          <h1 class="page-title">${escapeHtml(doc.title)}</h1>
          ${doc.description ? `<p class="page-description">${escapeHtml(doc.description)}</p>` : ""}
        </header>
        <div class="page-meta">
          <span class="page-updated">Updated ${escapeHtml(formatDate(doc.updatedAt))}</span>
        </div>
        <div class="markdown">${bodyHtml}</div>
        ${githubActions}
        ${sectionLinks}
      </section>
      <aside class="layout-stack">
        ${outline}
      </aside>
    </div>
  `;

  return renderShell({
    title: doc.title,
    description: doc.description,
    currentPath: doc.path,
    content,
  });
}

function renderListingPage({ docs, tree }) {
  const directSections = renderDirectorySections(tree);
  const recentDocs = docs
    .filter((doc) => doc.path !== "/" && !doc.isGeneratedIndex)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 8);

  const content = `
    <div class="section-layout">
      <section class="overview-panel">
        ${renderBreadcrumbs([
          { label: "Home", href: "/" },
          { label: "Documents", href: null },
        ])}
        <div class="page-kicker">Overview</div>
        <h1 class="page-title">All documents</h1>
        <p class="page-description">ディレクトリ構造ベースで全体像を辿れる一覧です。タイトルが無いページはファイル名から補完します。</p>
      </section>

      <section class="overview-panel">
        <h2 class="overview-title">Recently updated</h2>
        ${recentDocs.length ? renderDocList(recentDocs) : renderEmptyState("まだドキュメントがありません。", "docs 配下に Markdown を追加すると一覧に載ります。")}
      </section>

      <section class="overview-panel">
        <h2 class="overview-title">Directory overview</h2>
        ${directSections}
      </section>
    </div>
  `;

  return renderShell({
    title: "All documents",
    description: "全ドキュメント一覧",
    currentPath: "/documents/",
    content,
  });
}

function renderHomePage({ docs, tree }) {
  const markdownCount = docs.filter((doc) => !doc.isGeneratedIndex).length;
  const sectionCount = countSections(tree);
  const recentDocs = docs
    .filter((doc) => doc.path !== "/" && !doc.isGeneratedIndex)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 6);

  const content = `
    <div class="section-layout">
      <section class="overview-panel">
        <div class="page-kicker">Docs site</div>
        <h1 class="page-title">${escapeHtml(siteName)}</h1>
        <p class="page-description">Markdown を置くだけで、一覧・検索・パンくず付きの閲覧サイトとして出力します。</p>
        <div class="overview-hero">
          <div class="overview-stat">
            <span class="overview-stat-label">Documents</span>
            <span class="overview-stat-value">${markdownCount}</span>
          </div>
          <div class="overview-stat">
            <span class="overview-stat-label">Sections</span>
            <span class="overview-stat-value">${sectionCount}</span>
          </div>
          <div class="overview-stat">
            <span class="overview-stat-label">Search</span>
            <span class="overview-stat-value">${markdownCount ? "Ready" : "Waiting"}</span>
          </div>
        </div>
      </section>

      <section class="overview-panel">
        <h2 class="overview-title">Recently updated</h2>
        ${recentDocs.length ? renderDocList(recentDocs) : renderEmptyState("まだ公開ページがありません。", "docs/**/*.md を追加して build するとここに並びます。")}
      </section>

      <section class="overview-panel">
        <h2 class="overview-title">Browse by directory</h2>
        ${renderDirectorySections(tree)}
      </section>
    </div>
  `;

  return renderShell({
    title: siteName,
    description: `${siteName} documentation`,
    currentPath: "/",
    content,
  });
}

function renderSearchPage() {
  const content = `
    <section class="search-page-shell" data-search-page>
      ${renderBreadcrumbs([
        { label: "Home", href: "/" },
        { label: "Search", href: null },
      ])}
      <header class="search-page-header">
        <div class="page-kicker">Search</div>
        <h1 class="page-title">Find a page fast</h1>
        <p class="page-description">タイトル、URL、見出し、本文テキストをクライアントサイドで絞り込みます。</p>
        <p class="search-page-count" data-search-page-count>Loading search index...</p>
      </header>
      <div class="section-list" data-search-page-results></div>
    </section>
  `;

  return renderShell({
    title: "Search",
    description: "Search documents",
    currentPath: "/search/",
    content,
  });
}

function renderDirectorySections(tree) {
  const sections = [];

  if (tree.documents.length) {
    sections.push(`
      <section class="directory-section">
        <div class="directory-heading">
          <h3 class="directory-title"><a href="${escapeHtml(prefixBasePath("/"))}">Top level</a></h3>
          <span class="directory-meta">${tree.documents.length} page(s)</span>
        </div>
        ${renderDocList(tree.documents)}
      </section>
    `);
  }

  for (const childNode of [...tree.children.values()].sort((a, b) => a.route.localeCompare(b.route))) {
    sections.push(renderDirectoryNode(childNode, { recursive: false }));
  }

  if (!sections.length) {
    return renderEmptyState("まだドキュメントがありません。", "docs 配下に Markdown を追加すると、自動でここにグルーピングされます。");
  }

  return sections.join("");
}

function renderDirectoryNode(node, { recursive = true } = {}) {
  const items = [];
  if (node.indexDocument) {
    items.push(node.indexDocument);
  }
  items.push(...node.documents);

  const childSections = recursive
    ? [...node.children.values()]
        .sort((a, b) => a.route.localeCompare(b.route))
        .map((child) => renderDirectoryNode(child, { recursive: true }))
        .join("")
    : "";

  return `
    <section class="directory-section">
      <div class="directory-heading">
        <h3 class="directory-title">
          <a href="${escapeHtml(prefixBasePath(node.route))}">${escapeHtml(node.title)}</a>
        </h3>
        <span class="directory-meta">${getDirectoryEntries(node).length} item(s)</span>
      </div>
      ${renderEntryList(getDirectoryEntries(node))}
      ${childSections}
    </section>
  `;
}

function renderDocList(docs) {
  return renderEntryList(docs.map((doc) => createDocumentEntry(doc)));
}

function renderEntryList(entries) {
  const sortedEntries = sortEntries(entries);
  return `
    <div class="doc-list">
      ${sortedEntries
        .map(
          (entry) => `
            <a class="doc-card" href="${escapeHtml(prefixBasePath(entry.path))}">
              <span class="doc-card-kind">${entry.kind === "group" ? "Group" : "Page"}</span>
              <span class="doc-card-title">${escapeHtml(entry.title)}</span>
              ${entry.description ? `<span class="doc-card-description">${escapeHtml(entry.description)}</span>` : ""}
            </a>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderSidebarEntryList(entries) {
  return `
    <ul class="sidebar-list">
      ${sortEntries(entries)
        .map(
          (entry) => `
            <li>
              <a class="sidebar-link" href="${escapeHtml(prefixBasePath(entry.path))}">
                <strong>${escapeHtml(entry.title)}</strong>
              </a>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function renderEmptyState(title, description) {
  return `
    <div class="empty-state">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(description)}</p>
    </div>
  `;
}

function renderBreadcrumbs(items) {
  return `
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      ${items
        .map((item, index) => {
          const separator = index === 0 ? "" : `<span>/</span>`;
          const label = escapeHtml(item.label);
          if (item.href) {
            return `${separator}<a href="${escapeHtml(prefixBasePath(item.href))}">${label}</a>`;
          }
          return `${separator}<span aria-current="page">${label}</span>`;
        })
        .join("")}
    </nav>
  `;
}

function renderShell({ title, description, currentPath, content }) {
  const pageTitle = currentPath === "/" ? `${title}` : `${title} | ${siteName}`;
  const repoLink = repoUrl
    ? `<a class="header-link" href="${escapeHtml(repoUrl)}" target="_blank" rel="noreferrer">GitHub</a>`
    : "";
  const customCssLink = customCssPath
    ? `<link rel="stylesheet" href="${escapeHtml(prefixBasePath("/assets/custom.css"))}">`
    : "";

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${escapeHtml(description || siteName)}">
    <link rel="stylesheet" href="${escapeHtml(prefixBasePath("/assets/styles.css"))}">
    ${customCssLink}
    <script>
      window.__SITE_CONFIG__ = ${JSON.stringify({ basePath, siteName })};
    </script>
    <script defer src="${escapeHtml(prefixBasePath("/assets/search.js"))}"></script>
  </head>
  <body>
    <div class="site-shell">
      <header class="site-header">
        <div class="site-header-inner">
          <a class="brand-link" href="${escapeHtml(prefixBasePath("/"))}">
            <span class="brand-home">Home</span>
          </a>
          <button class="search-toggle" type="button" data-search-toggle aria-expanded="false" aria-controls="site-search">
            <span class="search-toggle-icon" aria-hidden="true">⌕</span>
            <span class="search-toggle-label">検索</span>
          </button>
          <form class="search-shell" id="site-search" data-search-form action="${escapeHtml(prefixBasePath("/search/"))}" method="get">
            <label class="search-label">
              <span class="search-icon" aria-hidden="true">⌕</span>
              <input class="search-input" type="search" name="q" data-search-input placeholder="ドキュメントを検索" autocomplete="off">
              <span class="search-shortcut" aria-hidden="true">/</span>
            </label>
            <div class="search-dropdown" data-search-dropdown hidden></div>
          </form>
          <nav class="header-links">
            <a class="header-link header-link-primary" href="${escapeHtml(prefixBasePath("/documents/"))}">一覧</a>
            ${repoLink}
          </nav>
        </div>
      </header>
      <main class="site-main">
        ${content}
      </main>
      <footer class="site-footer">
        <div class="site-footer-inner">
          <div class="site-footer-card">
            Markdown を docs 配下に置くだけで、一覧・検索・パンくず付きのドキュメントサイトとして出力されます。
          </div>
        </div>
      </footer>
    </div>
  </body>
</html>`;
}

async function writePage(route, html) {
  const outputDirectory = route === "/" ? distDir : path.join(distDir, route.replace(/^\/|\/$/g, ""));
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(path.join(outputDirectory, "index.html"), html);
}

async function copyClientAssets() {
  const assetsDist = path.join(distDir, "assets");
  await fs.mkdir(assetsDist, { recursive: true });
  await fs.copyFile(path.join(themeDir, "styles.css"), path.join(assetsDist, "styles.css"));
  await fs.copyFile(path.join(themeDir, "search.js"), path.join(assetsDist, "search.js"));
  if (customCssPath) {
    await fs.copyFile(customCssPath, path.join(assetsDist, "custom.css"));
  }
}

async function copyDocAssets(files) {
  for (const absolutePath of files) {
    const relativePath = path.relative(docsDir, absolutePath);
    const outputPath = path.join(distDir, relativePath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.copyFile(absolutePath, outputPath);
  }
}

async function writeDataFiles({ docs, tree }) {
  const documents = docs.map((doc) => ({
    title: doc.title,
    description: doc.description,
    path: doc.path,
    sourcePath: doc.sourcePath,
    headings: doc.headings,
    plainText: doc.plainText,
    updatedAt: doc.updatedAt,
    directory: doc.directory,
  }));

  await fs.writeFile(
    path.join(distDir, "search-index.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), documents }, null, 2),
  );

  await fs.writeFile(
    path.join(distDir, "site-data.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        site: {
          name: siteName,
          basePath,
          repoUrl,
          sourceBranch,
          sourceRoot,
        },
        documents,
        directories: serializeTree(tree),
      },
      null,
      2,
    ),
  );
}

function serializeTree(node) {
  return {
    title: node.title,
    route: node.route,
    indexDocument: getNodePageDocument(node)
      ? {
          title: getNodePageDocument(node).title,
          path: getNodePageDocument(node).path,
        }
      : null,
    documents: node.documents.map((doc) => ({
      title: doc.title,
      path: doc.path,
    })),
    children: [...node.children.values()].map((child) => serializeTree(child)),
  };
}

function countSections(tree) {
  let count = tree.children.size;
  for (const child of tree.children.values()) {
    count += countSections(child);
  }
  return count;
}

function parentDirectoryFromRoute(route) {
  const normalized = route.replace(/^\/|\/$/g, "");
  if (!normalized) {
    return "";
  }
  const parent = path.posix.dirname(normalized);
  return parent === "." ? "" : parent;
}

function toRoutePath(relativeDocPath) {
  const normalized = toPosix(relativeDocPath);
  if (normalized === "index.md") {
    return "/";
  }
  if (normalized.endsWith("/index.md")) {
    return `/${normalized.slice(0, -"index.md".length)}`;
  }
  return `/${normalized.replace(/\.md$/, "/")}`;
}

function getDirectoryPath(relativeDocPath) {
  const directory = path.posix.dirname(toPosix(relativeDocPath));
  return directory === "." ? "" : directory;
}

function fallbackDisplayName(relativeDocPath) {
  const normalized = toPosix(relativeDocPath);
  const basename = path.posix.basename(normalized, ".md");
  if (basename === "index") {
    const parent = path.posix.basename(path.posix.dirname(normalized));
    return parent && parent !== "." ? humanizeSegment(parent) : "Home";
  }
  return humanizeSegment(basename);
}

function humanizeSegment(value) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "Untitled";
}

function normalizeBasePath(value) {
  if (!value || value === "/") {
    return "/";
  }
  return `/${value.replace(/^\/+|\/+$/g, "")}/`;
}

function normalizeSourceRoot(value) {
  return value.replace(/^\/+|\/+$/g, "");
}

function buildGitHubSourceUrl(mode, sourcePath) {
  const sourceLocation = sourceRoot ? `${sourceRoot}/${sourcePath}` : sourcePath;
  return `${repoUrl}/${mode}/${sourceBranch}/${sourceLocation}`;
}

function prefixBasePath(route) {
  const target = route.startsWith("/") ? route : `/${route}`;
  if (basePath === "/") {
    return target;
  }
  return `${basePath}${target.slice(1)}`;
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .trim()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-") || "section"
  );
}

function truncate(value, maxLength) {
  if (!value) {
    return "";
  }
  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trim()}…` : value;
}

function normalizeText(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function toPosix(value) {
  return value.split(path.sep).join(path.posix.sep);
}

function isExternalLink(value) {
  return /^(?:[a-z]+:|\/\/|#)/i.test(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getGitBranch(cwd = rootDir) {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "main";
  }
}

function getGitHubRepoUrl(cwd = rootDir) {
  try {
    const remote = execSync("git remote get-url origin", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();

    if (remote.startsWith("git@github.com:")) {
      return `https://github.com/${remote.slice("git@github.com:".length).replace(/\.git$/, "")}`;
    }

    if (remote.startsWith("https://github.com/")) {
      return remote.replace(/\.git$/, "");
    }

    return "";
  } catch {
    return "";
  }
}
