# CLAUDE.md - Claude Code 自動読み込みファイル

## プロジェクト概要

**SUGOMEMO** はブラウザベースのマルチメディア編集・メモ管理ツール。
3つの機能（MEMO / IMAGE / CUT）を1つのタブUIに統合したSPA。
フレームワーク不使用、純粋なHTML/CSS/Vanilla JSで構築。

## リポジトリ情報

- リポジトリ: https://github.com/daisukeman32/SUGOMEMO.git
- ブランチ: `master`
- リモート: `origin`
- 作者: daisukeman32
- 現バージョン: v3.1

## 開発環境の経緯

- 元々Windowsでコーディングしていた
- Mac環境（darwin）にクローンして開発を継続中
- Git履歴はWindows時代のコミットを含め全て引き継ぎ済み

## ファイル構成と役割

```
SUGOMEMO/
├── index.html          メインHTML（タブUI・全3セクション定義）
├── css/
│   └── style.css       デザインシステム（CSS変数テーマ・レイアウト・757行）
├── js/
│   ├── app.js          コアアプリ管理（タブ切替・モジュールライフサイクル・167行）
│   ├── memo.js         MEMOモジュール（タグ管理・テキスト保存・416行）
│   ├── image.js        IMAGEエディタ（Canvas描画・オブジェクト管理・827行）
│   ├── edit.js         CUTエディタ（統合タイムライン・トリム・1,176行）
│   ├── audio.js        レガシー音声モジュール（波形ビューア・401行）
│   └── video.js        レガシー動画モジュール（ビデオタイムライン・391行）
├── README.md           プロジェクト説明書
└── CLAUDE.md           このファイル（Claude Code自動読み込み用）
```

## アーキテクチャ

- 各モジュール（Memo, Image, Edit）はIIFEパターンで自己完結
- モジュールは `init()`, `destroy()`, `onThemeChange()` を公開
- app.js がタブ切替とモジュールライフサイクルを管理
- グローバル状態汚染なし（モジュールスコープのクロージャで管理）

## 技術スタック

- Vanilla JavaScript（ES6+）、フレームワークなし
- HTML5 Canvas API（描画・波形・サムネイル）
- Web Audio API（音声再生・デコード・ゲイン制御）
- HTML5 Video API / MediaRecorder API
- FFmpeg.wasm `@ffmpeg/ffmpeg@0.12.10`（CDN読み込み・エンコード用）
- localStorage でデータ永続化
- CSS Custom Properties でDay/Nightテーマ切替

## localStorage キー一覧

- `sugomemo-memo` — メモデータ（タグ・アイテムのJSON）
- `sugomemo-theme` — テーマ設定（day / night）
- `sugomemo-fontsize` — フォントサイズ（1〜5の5段階）
- `sugomemo-sidebar-width` — MEMOサイドバー幅

## 各モジュールの機能

### MEMO（memo.js）
タグベースのメモ管理。ワンクリックコピー、インライン編集・自動保存、一括削除モード、リサイズ可能サイドバー。HTMLレンダリング対応（サニタイズ付き）、フォーマットツールバー（B/I/U/S/サイズ/色/リンク/コード）、プレビュー/ソース切替。

### IMAGE（image.js）
Canvas画像エディタ。D&D画像読み込み、プリセットサイズ（A4/FHD/4K/Instagram等）、オブジェクト操作（移動・回転・拡縮・レイヤー順序）、描画ツール（ペン・ガウスぼかし・モザイク）、テキスト配置、PNG/JPEGエクスポート。

### CUT（edit.js）
音声/動画NLEエディタ。タイムライン（波形+サムネイル）、In/Outトリム、トラック別ミュート・ボリューム制御（0-200%）、FFmpegエクスポート（MP3/MP4/WAV）。

## バージョニング方針

- **メジャー (X.0)**: アーキテクチャ変更・大規模機能追加 → 1.0 → 2.0 → 3.0
- **マイナー (X.Y)**: 機能追加・改善・バグ修正 → 3.1, 3.2, 3.3...
- バージョン表記は `index.html` の `.logo-version` と `CLAUDE.md` の両方を更新する
- コミット時にバージョンに応じたタグ付けを行う

## コーディング規約

- 純粋なVanilla JS（フレームワーク・npm不使用）
- IIFEパターンでモジュール化
- CSS変数でテーマ管理
- モノスペースフォント使用（SF Mono, Fira Code, JetBrains Mono）
- 日本語コメント可

## 起動方法

```bash
python3 -m http.server 8000
# または
npx serve .
```

FFmpeg.wasmはCDN読み込みのためインターネット接続が必要。
