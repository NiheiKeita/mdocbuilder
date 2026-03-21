---
title: はじめに
description: mdocbuilder を導入して sample/docs をビルドするまでの最短手順です。
---

# はじめに

このページは `mdocbuilder` をどう使うかを最短で把握するためのガイドです。

## 1. インストール

公開後は使う側のリポジトリで以下を実行します。

```bash
npm install -D mdocbuilder
```

## 2. 設定ファイルを置く

プロジェクトルートに `mdocbuilder.config.mjs` を置きます。

```js
export default {
  siteName: "My Docs",
  docsDir: "docs",
  outDir: "dist",
  basePath: "/",
  github: {
    repoUrl: "https://github.com/owner/repo",
    branch: "main",
    sourceRoot: "docs-app",
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
npx mdocbuilder build
```

または `package.json` に script を置きます。

```json
{
  "scripts": {
    "docs:build": "mdocbuilder build"
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

- root: `mdocbuilder` のソースコード
- `sample/docs/`: サンプル Markdown
- `sample/package.json`: ライブラリを install して使う側

ローカルでは以下で sample を build できます。

```bash
npm run sample:build
```
