---
title: Git MD Pages
description: Markdown から一覧・検索・パンくず付きのドキュメントサイトを生成するサンプルです。
---

# Git MD Pages

Markdown を `docs/` に置くだけで、検索しやすく読みやすいドキュメントサイトとして公開するためのサンプルです。

## まず見るページ

- [ガイド一覧](./guides/index.md)
- [検索を試す](./guides/search.md)
- [書き方サンプル](./guides/writing.md)
- [フロントマター設定](./reference/frontmatter.md)
- [自動インデックスの例](./test/)

## このサンプルで確認できること

- タイトル自動抽出
- パンくず
- 一覧ページ
- クライアントサイド検索
- index.md が無いディレクトリの自動インデックス
- コードブロック、テーブル、blockquote の見た目

> 検索欄で `検索`, `frontmatter`, `breadcrumb` などを入れるとヒットを確認しやすいです。

## ディレクトリ構成

```text
docs/
  index.md
  guides/
    index.md
    search.md
    writing.md
  reference/
    index.md
    frontmatter.md
```
