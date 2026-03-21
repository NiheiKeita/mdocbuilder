import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSite } from "../lib/index.js";
import { loadConfig } from "../lib/index.js";

test("buildSite generates search index and auto directory pages", async () => {
  const rootDir = await createTempProject({
    "docs/index.md": "# Home\n\n[Jump](./test/)\n",
    "docs/test/fuga.md": "# Fuga\n\nTop page.\n",
    "docs/test/hoge/note.md": "# Hoge Note\n\nNested page.\n",
  });

  await buildSite({
    rootDir,
    siteName: "Fixture Docs",
    docsDir: "docs",
    outDir: "dist",
  });

  const autoIndex = await fs.readFile(path.join(rootDir, "dist", "test", "index.html"), "utf8");
  assert.match(autoIndex, /Hoge/);
  assert.match(autoIndex, /Fuga/);
  assert.doesNotMatch(autoIndex, /Hoge Note/);

  const nestedIndex = await fs.readFile(path.join(rootDir, "dist", "test", "hoge", "index.html"), "utf8");
  assert.match(nestedIndex, /Hoge Note/);

  const searchIndex = JSON.parse(await fs.readFile(path.join(rootDir, "dist", "search-index.json"), "utf8"));
  assert.equal(searchIndex.documents.some((doc) => doc.path === "/test/"), true);
  assert.equal(searchIndex.documents.some((doc) => doc.path === "/test/hoge/"), true);
});

test("{{mdocbuildindex}} embeds only direct children for index pages", async () => {
  const rootDir = await createTempProject({
    "docs/index.md": "# Home\n",
    "docs/reference/index.md": "# Reference\n\n{{mdocbuildindex}}\n",
    "docs/reference/frontmatter.md": "# Frontmatter\n\nFlat page.\n",
    "docs/reference/deep/note.md": "# Deep Note\n\nNested page.\n",
  });

  await buildSite({
    rootDir,
    siteName: "Fixture Docs",
    docsDir: "docs",
    outDir: "dist",
  });

  const referencePage = await fs.readFile(path.join(rootDir, "dist", "reference", "index.html"), "utf8");
  assert.match(referencePage, /Frontmatter/);
  assert.match(referencePage, /Deep/);
  assert.doesNotMatch(referencePage, /Deep Note/);
});

test("loadConfig reads mdocbuilder.config.mjs and custom CSS is emitted", async () => {
  const rootDir = await createTempProject({
    "docs/index.md": "# Home\n",
    "docs-theme.css": ":root { --accent: #000; }\n",
    "mdocbuilder.config.mjs": `
      export default {
        siteName: "Configured Docs",
        docsDir: "docs",
        outDir: "public",
        github: {
          repoUrl: "https://github.com/example/mdocbuilder",
          branch: "main",
          sourceRoot: "sample"
        },
        theme: {
          customCss: "./docs-theme.css"
        }
      };
    `,
  });

  const config = await loadConfig({ rootDir });
  await buildSite(config);

  const html = await fs.readFile(path.join(rootDir, "public", "index.html"), "utf8");
  assert.match(html, /Configured Docs/);
  assert.match(html, /assets\/custom\.css/);
  assert.match(html, /https:\/\/github\.com\/example\/mdocbuilder\/edit\/main\/sample\/docs\/index\.md/);

  const customCss = await fs.readFile(path.join(rootDir, "public", "assets", "custom.css"), "utf8");
  assert.match(customCss, /--accent/);
});

async function createTempProject(files) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdocbuilder-test-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(rootDir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);
  }
  return rootDir;
}
