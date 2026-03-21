---
title: リポジトリ構成
description: root と sample の役割分担、主要ディレクトリの意味をまとめます。
---

# リポジトリ構成

この repository は「ライブラリ本体」と「利用例」を分けています。

## 大枠

```text
.
├─ bin/
├─ src/
├─ sample/
├─ test/
└─ .github/workflows/
```

## 各ディレクトリ

### `src/`

ライブラリ本体です。

- `src/core/`: build ロジック
- `src/theme-default/`: デフォルトテーマ
- `src/index.ts`: export の入口

### `bin/`

CLI の入口です。`git-md-pages build` がここから始まります。

### `sample/`

ライブラリを実際に install して使う例です。

- `sample/package.json`
- `sample/git-md-pages.config.mjs`
- `sample/docs/`
- `sample/docs-theme.css`

### `test/`

node:test ベースの integration test です。

### `.github/workflows/`

CI, GitHub Pages deploy, npm release の workflow です。

## なぜ sample を分けたか

- ライブラリ本体と利用側の責務を分けるため
- `npm install` して使う形をそのまま見せるため
- Pages deploy を sample 側の build に合わせるため
