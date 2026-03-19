---
title: 検索を試す
description: タイトル、URL、見出し、本文から絞り込める検索の動作確認用ページです。
---

# 検索を試す

このページは検索インデックスに `検索`, `search`, `breadcrumb`, `listing` といった語が入るようにしてあります。

## 検索キーワード例

- 検索
- search
- breadcrumb
- listing
- frontmatter

### 期待する挙動

ヘッダーの検索ボックスからページ名、URL、見出し、本文テキストを横断して見つけられることを確認します。

## サンプル JSON

```json
{
  "title": "検索を試す",
  "path": "/guides/search/",
  "headings": ["検索キーワード例", "期待する挙動"],
  "plainText": "タイトル、URL、見出し、本文から検索できます。"
}
```

## 関連ページ

- [ガイド一覧](./index.md)
- [書き方サンプル](./writing.md)
- [フロントマター設定](../reference/frontmatter.md)
