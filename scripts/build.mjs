import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";

const rootDir = process.cwd();
const docsDir = path.join(rootDir, "docs");
const distDir = path.join(rootDir, "dist");
const clientDir = path.join(rootDir, "src", "client");

const basePath = normalizeBasePath(process.env.SITE_BASE || "/");
const siteName = process.env.SITE_NAME || humanizeSegment(path.basename(rootDir));
const repoUrl = getGitHubRepoUrl();
const sourceBranch = process.env.SOURCE_BRANCH || getGitBranch();

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

async function main() {
  await resetDist();

  const markdownFiles = await findMarkdownFiles(docsDir);
  const assetFiles = await findAssetFiles(docsDir);
  const docs = [];
  const routeToDoc = new Map();

  for (const absolutePath of markdownFiles) {
    const doc = await parseDocument(absolutePath);
    docs.push(doc);
    routeToDoc.set(doc.path, doc);
  }

  docs.sort((a, b) => a.path.localeCompare(b.path));

  const tree = buildDirectoryTree(docs);
  const routeTitleMap = new Map(
    docs.map((doc) => [
      doc.path,
      doc.isIndex && doc.title === "Home" ? "Home" : doc.title,
    ]),
  );

  for (const doc of docs) {
    const siblings = getSiblingDocuments(tree, doc);
    const childDocuments = getChildDocuments(tree, doc);
    const breadcrumbs = buildBreadcrumbs(doc, routeTitleMap);
    const html = renderDocumentPage({
      doc,
      breadcrumbs,
      siblings,
      childDocuments,
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
  } else {
    const currentHtml = await fs.readFile(path.join(distDir, "index.html"), "utf8");
    const enhancedHome = injectHomeOverview({
      html: currentHtml,
      docs,
      tree,
    });
    await fs.writeFile(path.join(distDir, "index.html"), enhancedHome);
  }

  await copyClientAssets();
  await copyDocAssets(assetFiles);
  await writeDataFiles({ docs, tree });

  console.log(`Built ${docs.length} markdown document(s) into ${path.relative(rootDir, distDir)}.`);
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
    documents: [],
    children: new Map(),
  };
}

function getSiblingDocuments(tree, doc) {
  const node = findTreeNode(tree, doc.directory);
  if (!node) {
    return [];
  }

  const siblings = [];

  if (!doc.isIndex && node.indexDocument) {
    siblings.push(node.indexDocument);
  }

  for (const item of node.documents) {
    if (item.path !== doc.path) {
      siblings.push(item);
    }
  }

  return siblings;
}

function getChildDocuments(tree, doc) {
  if (!doc.isIndex) {
    return [];
  }

  const node = findTreeNode(tree, doc.directory);
  if (!node) {
    return [];
  }

  const childItems = [...node.documents];
  for (const childNode of node.children.values()) {
    if (childNode.indexDocument) {
      childItems.push(childNode.indexDocument);
    }
  }
  return childItems.sort((a, b) => a.title.localeCompare(b.title));
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

function buildBreadcrumbs(doc, routeTitleMap) {
  const crumbs = [{ label: "Home", href: "/" }];
  const relativeDocPath = doc.sourcePath.replace(/^docs\//, "");
  const withoutExtension = relativeDocPath.replace(/\.md$/, "");
  const segments = withoutExtension.split("/");

  if (segments.length === 1 && segments[0] === "index") {
    return [{ label: "Home", href: null }];
  }

  let currentRoute = "/";
  const crumbSegments = [...segments];
  if (crumbSegments[crumbSegments.length - 1] === "index") {
    crumbSegments.pop();
  }

  crumbSegments.forEach((segment, index) => {
    currentRoute = currentRoute === "/" ? `/${segment}/` : `${currentRoute}${segment}/`;
    const isLast = index === crumbSegments.length - 1;
    const label = routeTitleMap.get(currentRoute) || humanizeSegment(segment);
    crumbs.push({
      label,
      href: isLast ? null : currentRoute,
    });
  });

  return crumbs;
}

function renderDocumentPage({ doc, breadcrumbs, siblings, childDocuments }) {
  const outline = doc.headings.length
    ? `
      <section class="sidebar-panel">
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

  const sectionLinks = siblings.length || childDocuments.length
    ? `
      <section class="sidebar-panel">
        <h2 class="sidebar-heading">${doc.isIndex ? "In this section" : "Nearby pages"}</h2>
        <ul class="sidebar-list">
          ${[...childDocuments, ...siblings]
            .map(
              (item) => `
                <li>
                  <a class="sidebar-link" href="${escapeHtml(prefixBasePath(item.path))}">
                    <strong>${escapeHtml(item.title)}</strong>
                    <span>${escapeHtml(item.path)}</span>
                  </a>
                </li>
              `,
            )
            .join("")}
        </ul>
      </section>
    `
    : "";

  const githubActions = repoUrl
    ? `
      <div class="article-actions">
        <a class="action-link" href="${escapeHtml(`${repoUrl}/blob/${sourceBranch}/${doc.sourcePath}`)}" target="_blank" rel="noreferrer">GitHubでこのページを見る</a>
        <a class="action-link" href="${escapeHtml(`${repoUrl}/edit/${sourceBranch}/${doc.sourcePath}`)}" target="_blank" rel="noreferrer">GitHubで編集する</a>
      </div>
    `
    : "";

  const content = `
    <div class="page-grid article-layout">
      <section class="article-panel article-main">
        ${renderBreadcrumbs(breadcrumbs)}
        <div class="page-kicker">Document</div>
        <h1 class="page-title">${escapeHtml(doc.title)}</h1>
        ${doc.description ? `<p class="page-description">${escapeHtml(doc.description)}</p>` : ""}
        <div class="page-meta">
          <span><strong>URL</strong> ${escapeHtml(doc.path)}</span>
          <span><strong>Updated</strong> ${escapeHtml(formatDate(doc.updatedAt))}</span>
          <span><strong>Source</strong> ${escapeHtml(doc.sourcePath)}</span>
        </div>
        <div class="markdown">${doc.html}</div>
        ${githubActions}
      </section>
      <aside class="layout-stack">
        ${outline}
        ${sectionLinks}
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
    .filter((doc) => doc.path !== "/")
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
  const docCount = docs.length;
  const sectionCount = countSections(tree);
  const recentDocs = docs
    .filter((doc) => doc.path !== "/")
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
            <span class="overview-stat-value">${docCount}</span>
          </div>
          <div class="overview-stat">
            <span class="overview-stat-label">Sections</span>
            <span class="overview-stat-value">${sectionCount}</span>
          </div>
          <div class="overview-stat">
            <span class="overview-stat-label">Search</span>
            <span class="overview-stat-value">${docCount ? "Ready" : "Waiting"}</span>
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

function injectHomeOverview({ html, docs, tree }) {
  const recentDocs = docs
    .filter((doc) => doc.path !== "/")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 6);

  const overview = `
    <section class="overview-panel home-intro">
      <h2 class="overview-title">Site overview</h2>
      <div class="overview-hero">
        <div class="overview-stat">
          <span class="overview-stat-label">Documents</span>
          <span class="overview-stat-value">${docs.length}</span>
        </div>
        <div class="overview-stat">
          <span class="overview-stat-label">Sections</span>
          <span class="overview-stat-value">${countSections(tree)}</span>
        </div>
        <div class="overview-stat">
          <span class="overview-stat-label">Search</span>
          <span class="overview-stat-value">${docs.length ? "Ready" : "Waiting"}</span>
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
  `;

  return html.replace("</main>", `${overview}</main>`);
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
    sections.push(renderDirectoryNode(childNode));
  }

  if (!sections.length) {
    return renderEmptyState("まだドキュメントがありません。", "docs 配下に Markdown を追加すると、自動でここにグルーピングされます。");
  }

  return sections.join("");
}

function renderDirectoryNode(node) {
  const items = [];
  if (node.indexDocument) {
    items.push(node.indexDocument);
  }
  items.push(...node.documents);

  const childSections = [...node.children.values()]
    .sort((a, b) => a.route.localeCompare(b.route))
    .map((child) => renderDirectoryNode(child))
    .join("");

  return `
    <section class="directory-section">
      <div class="directory-heading">
        <h3 class="directory-title">
          <a href="${escapeHtml(prefixBasePath(node.route))}">${escapeHtml(node.title)}</a>
        </h3>
        <span class="directory-meta">${items.length + countDescendantIndexPages(node.children)} page(s)</span>
      </div>
      ${items.length ? renderDocList(items) : ""}
      ${childSections}
    </section>
  `;
}

function countDescendantIndexPages(children) {
  let count = 0;
  for (const node of children.values()) {
    if (node.indexDocument) {
      count += 1;
    }
    count += node.documents.length;
    count += countDescendantIndexPages(node.children);
  }
  return count;
}

function renderDocList(docs) {
  const sortedDocs = [...docs].sort((a, b) => a.title.localeCompare(b.title));
  return `
    <div class="doc-list">
      ${sortedDocs
        .map(
          (doc) => `
            <a class="doc-card" href="${escapeHtml(prefixBasePath(doc.path))}">
              <span class="doc-card-title">${escapeHtml(doc.title || doc.fallbackName)}</span>
              <span class="doc-card-path">${escapeHtml(doc.path)}</span>
              ${doc.description ? `<span class="doc-card-description">${escapeHtml(doc.description)}</span>` : ""}
            </a>
          `,
        )
        .join("")}
    </div>
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

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${escapeHtml(description || siteName)}">
    <link rel="stylesheet" href="${escapeHtml(prefixBasePath("/assets/styles.css"))}">
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
            <span class="brand-mark">Docs</span>
            <span class="brand-name">${escapeHtml(siteName)}</span>
          </a>
          <form class="search-shell" data-search-form action="${escapeHtml(prefixBasePath("/search/"))}" method="get">
            <label class="search-label">
              <span>Search</span>
              <input class="search-input" type="search" name="q" data-search-input placeholder="Find title, path, heading, text" autocomplete="off">
            </label>
            <div class="search-dropdown" data-search-dropdown hidden></div>
          </form>
          <nav class="header-links">
            <a class="header-link" href="${escapeHtml(prefixBasePath("/documents/"))}">All docs</a>
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
  await fs.copyFile(path.join(clientDir, "styles.css"), path.join(assetsDist, "styles.css"));
  await fs.copyFile(path.join(clientDir, "search.js"), path.join(assetsDist, "search.js"));
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
    indexDocument: node.indexDocument
      ? {
          title: node.indexDocument.title,
          path: node.indexDocument.path,
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

function getGitBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "main";
  }
}

function getGitHubRepoUrl() {
  try {
    const remote = execSync("git remote get-url origin", {
      cwd: rootDir,
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
