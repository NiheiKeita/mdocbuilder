# 書き方サンプル

本文の読みやすさを確認するためのページです。行間、余白、見出し差、コードブロック、テーブル、blockquote、list がどう見えるかをざっと確認できます。

## チェックリスト

- 1 行が長すぎないか
- h1, h2, h3 の差が見えるか
- コードブロックが読みやすいか
- テーブルがモバイルでも崩れにくいか

## コードブロック

```ts
type SearchEntry = {
  title: string;
  path: string;
  headings: string[];
  plainText: string;
};

function pickTitle(entry: SearchEntry) {
  return entry.title || entry.path;
}
```

## テーブル

| 項目 | 例 | 用途 |
| --- | --- | --- |
| title | 検索を試す | 一覧と検索結果表示 |
| path | /guides/search/ | URL とパンくず |
| plainText | 本文テキスト | 検索対象 |

## 引用

> GitHub の Markdown ビューより、読む体験と辿る体験を優先する。

## 関連リンク

- [トップへ戻る](../index.md)
- [ガイド一覧](./index.md)
