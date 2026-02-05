# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

**SUGOMEMO** はブラウザベースのマルチメディア編集・メモ管理ツール。
3つの機能（MEMO / IMAGE / CUT）を1つのタブUIに統合したSPA。
フレームワーク不使用、純粋なHTML/CSS/Vanilla JSで構築。

## 起動方法

```bash
python3 -m http.server 8000
# または
npx serve .
```

FFmpeg.wasmはCDN読み込みのためインターネット接続が必要。

## アーキテクチャ

### モジュールシステム
- 各モジュール（Memo, Image, Edit）はIIFEパターンで`window.ModuleName`に公開
- app.js がタブ切替時に各モジュールのライフサイクルを管理
- グローバル状態汚染なし（モジュールスコープのクロージャで管理）

### モジュール共通インターフェース
```javascript
window.ModuleName = (() => {
  function init() { }           // 必須: タブ表示時に呼ばれる
  function destroy() { }        // 必須: タブ非表示時に呼ばれる
  function onThemeChange() { }  // 必須: テーマ切替時に呼ばれる

  // オプション（app.jsのキーボードハンドラから呼ばれる）
  function onSpace() { }        // Space キー
  function onSeek(delta) { }    // J/L/←/→ キー
  function onMarkIn() { }       // I キー
  function onMarkOut() { }      // O キー
  function onDelete() { }       // Del キー
  function onZoomIn() { }       // E/+ キー
  function onZoomOut() { }      // Q/- キー
  function onZoomFit() { }      // 0 キー

  return { init, destroy, onThemeChange, /* ... */ };
})();
```

### テーマシステム
- CSS Custom Properties（`--fg`, `--bg`, `--subtle`, `--border`等）で管理
- `html[data-theme="day"|"night"]`で切替
- localStorage `sugomemo-theme`に保存

## 各モジュール

### MEMO（memo.js）
タグベースのメモ管理。展開表示編集（全画面エディタ）・自動保存、一括削除モード、リサイズ可能サイドバー。HTMLレンダリング対応（サニタイズ付き）、フォーマットツールバー。

### IMAGE（image.js）
Canvas画像エディタ。D&D画像読み込み、プリセットサイズ（SNS公式サイズ対応：X/Instagram/Pixiv等）、オブジェクト操作（移動・回転・拡縮・レイヤー順序）、スナップ機能（キャンバス端・オブジェクト間吸着）、描画ツール（ペン・ガウスぼかし・モザイク）、PNG/JPEGエクスポート。

### CUT（edit.js）
音声/動画NLEエディタ。タイムライン（波形+サムネイル）、In/Outトリム、トラック別ミュート・ボリューム制御（0-200%）、FFmpegエクスポート（MP3/MP4/WAV）。

## localStorage キー

| キー | 内容 |
|------|------|
| `sugomemo-memo` | メモデータ（タグ・アイテムのJSON） |
| `sugomemo-theme` | テーマ設定（day / night） |
| `sugomemo-fontsize` | フォントサイズ（1〜5の5段階） |
| `sugomemo-sidebar-width` | MEMOサイドバー幅 |

## キーボードショートカット（CUT/IMAGEタブ）

| キー | 動作 |
|------|------|
| `Space` | 再生/停止 |
| `←` `→` | 1フレーム移動 |
| `J` / `L` | 5秒スキップ |
| `I` / `O` | In/Outポイント設定 |
| `Q` / `E` | ズームアウト/イン |
| `0` | ズームフィット |
| `Del` | 選択削除 |

## バージョニング

- **メジャー (X.0)**: アーキテクチャ変更・大規模機能追加
- **マイナー (X.Y)**: 機能追加・改善・バグ修正
- バージョン表記は `index.html` の `.logo-version` と この CLAUDE.md の両方を更新
- 現バージョン: v3.2

## コーディング規約

- 純粋なVanilla JS（フレームワーク・npm不使用）
- IIFEパターンでモジュール化
- CSS変数でテーマ管理
- 日本語コメント可
