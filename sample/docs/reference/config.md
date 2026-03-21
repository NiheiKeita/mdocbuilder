---
title: 設定リファレンス
description: mdocbuilder.config.mjs で指定できる項目の意味をまとめます。
---

# 設定リファレンス

`mdocbuilder` はプロジェクトルートの `mdocbuilder.config.mjs` を読み込んで build 設定を決めます。

## 基本形

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

## 各項目

| キー | 役割 |
| --- | --- |
| `siteName` | ヘッダーや title に使うサイト名 |
| `docsDir` | Markdown を読むディレクトリ |
| `outDir` | HTML を出力する先 |
| `basePath` | GitHub Pages などのサブパス対応 |
| `github.repoUrl` | GitHub で見る / 編集するリンクの元 URL |
| `github.branch` | GitHub リンクに使うブランチ名 |
| `github.sourceRoot` | サブディレクトリ配下で build する場合の source ファイル起点 |
| `theme.customCss` | デフォルトテーマの上から読み込む CSS |

## `basePath` の使い分け

- ローカル: `/`
- GitHub Pages project site: `/${repository-name}/`

## sample での実例

この repository の sample 設定は以下です。

- `sample/mdocbuilder.config.mjs`
- `sample/docs-theme.css`
