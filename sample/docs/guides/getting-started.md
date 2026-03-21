---
title: はじめに
description: git-md-pages を導入して sample/docs をビルドするまでの最短手順です。
---

# はじめに

このページは `git-md-pages` をどう使うかを最短で把握するためのガイドです。

## 1. インストール

公開後は使う側のリポジトリで以下を実行します。

```bash
npm install -D git-md-pages
```

## 2. 設定ファイルを置く

プロジェクトルートに `git-md-pages.config.mjs` を置きます。

```js
export default {
  siteName: "My Docs",
  docsDir: "docs",
  outDir: "dist",
  basePath: "/",
  github: {
    repoUrl: "https://github.com/owner/repo",
    branch: "main",
  },
  theme: {
    customCss: "./docs-theme.css",
  },
};
```

## 3. docs を書く

最低限これだけで動きます。

```text
docs/
  index.md
  guide/
    intro.md
```

## 4. build する

```bash
npx git-md-pages build
```

または `package.json` に script を置きます。

```json
{
  "scripts": {
    "docs:build": "git-md-pages build"
  }
}
```

## 5. 何が生成されるか

- `dist/**/*.html`
- `dist/search-index.json`
- `dist/site-data.json`
- `dist/assets/*`

## この repository での見方

この repository では root がライブラリ本体、`sample/` が利用側プロジェクトです。

- root: `git-md-pages` のソースコード
- `sample/docs/`: サンプル Markdown
- `sample/package.json`: ライブラリを install して使う側

ローカルでは以下で sample を build できます。

```bash
npm run sample:build
```
