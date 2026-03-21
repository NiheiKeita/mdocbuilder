---
title: 内部アーキテクチャ
description: git-md-pages の build が何をしているかを処理の流れで説明します。
---

# 内部アーキテクチャ

`git-md-pages` は大きく `config load -> core build -> theme assets copy` の流れで動きます。

## 処理の流れ

1. `git-md-pages.config.mjs` を読む
2. `docs/**/*.md` を走査する
3. frontmatter, h1, 見出し, 本文テキストを抽出する
4. ディレクトリツリーを構築する
5. `index.md` が無いディレクトリに自動 index を生成する
6. HTML, `search-index.json`, `site-data.json` を出力する
7. theme の `styles.css`, `search.js`, `custom.css` を配置する

## 主なモジュール

| パス | 役割 |
| --- | --- |
| `src/core/build-site.ts` | build 本体 |
| `src/core/load-config.ts` | config の読み込み |
| `src/index.ts` | 公開 API |
| `bin/git-md-pages.mjs` | CLI |
| `src/theme-default/styles.css` | デフォルトテーマ |
| `src/theme-default/search.js` | クライアント検索 |

## build-site.ts がやっていること

- Markdown 解析
- title / description の決定
- 見出し slug の付与
- `.md` リンクのルート URL 化
- パンくず計算
- 同階層 / 直下の一覧生成
- `dlindex` 差し込み
- 自動 directory index 生成

## 出力データ

### HTML

各ページを静的 HTML として出力します。

### `search-index.json`

クライアント検索用のインデックスです。

- title
- description
- path
- sourcePath
- headings
- plainText
- updatedAt
- directory

### `site-data.json`

サイト全体の構造とメタ情報です。将来の theme / plugin 拡張でも使えるように残しています。
