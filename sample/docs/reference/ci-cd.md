---
title: CI / CD
description: GitHub Actions で何を検証し、どう Pages / npm release しているかを説明します。
---

# CI / CD

この repository には 3 種類の workflow があります。

## 1. CI

`push` と `pull_request` で走ります。

### 役割

- ライブラリ build
- sample build
- テスト実行
- package の publish 内容確認

### 見ている workflow

- `.github/workflows/ci.yml`

## 2. GitHub Pages deploy

`main` への push で sample サイトを build し、`sample/dist` を Pages に出します。

### ポイント

- root のライブラリを build
- `sample/package.json` からローカル install
- `sample/docs/` を build
- `SITE_BASE` を GitHub Pages 向けに設定

### 見ている workflow

- `.github/workflows/deploy-pages.yml`

## 3. npm release

`v*` タグの push で publish を行います。

### 前提

- タグは `v1.0.0` または `v1.0.0-r1` の形式
- `package.json` の version とタグが一致していること
- npm 側に Trusted Publisher を設定していること

### 見ている workflow

- `.github/workflows/release.yml`

## よく使うコマンド

```bash
npm run build:lib
npm run sample:build
npm run check
npm test
```
