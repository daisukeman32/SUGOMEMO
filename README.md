# SUGOMEMO

ブラウザベースのマルチメディア編集・メモ管理ツール。
メモ管理、画像編集、音声/動画カットの3つの機能を1つのタブUIに統合。

## Git情報

| 項目 | 内容 |
|------|------|
| リポジトリ | https://github.com/daisukeman32/SUGOMEMO.git |
| ブランチ | `master` |
| リモート | `origin` |
| 現在のバージョン | v2.0 |

### コミット履歴

| ハッシュ | メッセージ |
|----------|-----------|
| `88a0a73` | SUGOMEMO v2.0 - 全モジュール大幅強化 |
| `86e17a3` | SUGOMEMO v1.0 - ミニマル幾何学Webスーパーツール |

## ファイル構成

```
SUGOMEMO/
├── index.html          メインHTML（タブUI・全セクション）
├── css/
│   └── style.css       デザインシステム（テーマ・レイアウト）
├── js/
│   ├── app.js          コアアプリ管理（タブ切替・モジュールライフサイクル）
│   ├── memo.js         メモモジュール（タグ管理・テキスト保存）
│   ├── image.js        画像エディタ（Canvas描画・オブジェクト管理）
│   ├── edit.js         統合カットエディタ（タイムライン・トリム）
│   ├── audio.js        レガシー音声モジュール
│   └── video.js        レガシー動画モジュール
└── README.md
```

## 機能概要

### MEMO タブ
- タグベースのメモ管理システム
- ワンクリックでクリップボードコピー
- インライン編集・自動保存
- 一括削除モード
- リサイズ可能なサイドバー

### IMAGE タブ
- ドラッグ&ドロップで画像読み込み
- キャンバスプリセット（A4, A3, FHD, 4K, Instagram等）
- オブジェクト操作（移動・回転・拡縮・レイヤー順序）
- 描画ツール（ペン・ガウスぼかし・モザイク）
- テキストオブジェクト（ダブルクリック編集）
- PNG / JPEG エクスポート

### CUT タブ
- 音声/動画ファイルのトリム編集
- タイムライン表示（波形・サムネイル）
- In/Outポイントによるトリム
- トラック別ミュート・ボリューム制御（0-200%）
- FFmpeg.wasmによるエクスポート（MP3 / MP4 / WAV）

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| 言語 | Vanilla JavaScript（ES6+） |
| 描画 | HTML5 Canvas API |
| 音声処理 | Web Audio API |
| 動画処理 | HTML5 Video API / MediaRecorder API |
| エンコード | FFmpeg.wasm (`@ffmpeg/ffmpeg@0.12.10`) CDN読み込み |
| データ保存 | localStorage |
| フレームワーク | なし（純粋なHTML/CSS/JS） |

## localStorage キー

| キー | 内容 |
|------|------|
| `sugomemo-memo` | メモデータ（タグ・アイテム） |
| `sugomemo-theme` | テーマ設定（day / night） |
| `sugomemo-fontsize` | フォントサイズ（S / M / L） |
| `sugomemo-sidebar-width` | サイドバー幅 |

## キーボードショートカット（CUTタブ）

| キー | 動作 |
|------|------|
| `Space` | 再生/停止 |
| `←` `→` | 1フレーム移動 |
| `J` / `L` | 5秒スキップ |
| `I` / `O` | In/Outポイント設定 |
| `Q` / `E` | ズームアウト/イン |
| `0` | ズームフィット |
| `Del` | 選択トラック削除/ミュート |

## テーマ

- **Dayモード**: ライト背景（#f2f0ed）
- **Nightモード**: ダーク背景（#121212）
- ヘッダーのアイコンで即時切替

## 起動方法

ローカルサーバーで `index.html` を開く。

```bash
# 例: Python
python3 -m http.server 8000

# 例: Node.js (npx)
npx serve .
```

ブラウザで `http://localhost:8000` にアクセス。

> FFmpeg.wasmはCDNから読み込むためインターネット接続が必要です。
