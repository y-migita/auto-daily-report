# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

日報自動作成のためのTauriデスクトップアプリケーション。React + TypeScript（フロントエンド）とRust（バックエンド）で構成されている。

### 主な機能

1. **スクリーンショット自動撮影**: 定期的にスクリーンショットを自動で撮影
2. **スクリーンショット蓄積**: 撮影した画像をローカルに保存・管理
3. **日報自動生成**: 蓄積されたスクリーンショットを解析し、日報を自動作成

## 開発コマンド

```bash
# 開発サーバー起動（フロントエンドのみ）
bun run dev

# Tauriアプリを開発モードで起動（推奨）
bun run tauri dev

# 本番ビルド
bun run build
bun run tauri build

# 型チェック
tsc
```

## アーキテクチャ

```
src/           # Reactフロントエンド（TypeScript）
src-tauri/     # Tauriバックエンド（Rust）
  └── src/
      ├── lib.rs   # Tauriコマンド定義・プラグイン設定
      └── main.rs  # エントリーポイント
```

### フロントエンド⇔バックエンド通信

- フロントエンドから`@tauri-apps/api/core`の`invoke`関数でRustコマンドを呼び出す
- Rustコマンドは`src-tauri/src/lib.rs`で`#[tauri::command]`マクロを使って定義
- 新しいコマンドは`invoke_handler`に登録が必要

### スクリーンショット保存

- 保存先: `~/Pictures/auto-daily-report/YYYY-MM-DD/`
- ファイル名形式: `screenshot_HH-MM-SS_NNN.png`（時刻 + 連番）
- Rustコマンド `save_screenshot_to_pictures` で保存処理を実行
- 依存クレート: `dirs`（Picturesフォルダ取得）、`chrono`（日時フォーマット）

### 注意点

- Vite開発サーバーはポート1420固定（`vite.config.ts`で設定）
- パッケージマネージャーはbunを使用

## デザインルール

### 基本方針

- Tailwind CSSを使用
- シンプルで機能的なデザイン
- 左揃えレイアウト（中央寄せは使わない）

### カラーパレット

- **ベースカラー**: slate系を使用
  - 背景: `slate-50`（ページ）、`white`（カード・ボタン）
  - テキスト: `slate-700`（メイン）、`slate-600`（サブ）、`slate-500`（補助）
  - ボーダー: `slate-200`（薄）、`slate-300`（標準）、`slate-400`（強調）

### ボタンスタイル

- **標準ボタン**: 白背景、ボーダーあり
  - `border border-slate-300 bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700`
- **プライマリボタン**: 濃い背景、白文字
  - `border border-slate-400 bg-slate-600 hover:bg-slate-700 active:bg-slate-800 text-white font-medium`
- **サイズ**:
  - 標準: `px-3 py-1.5 text-sm`
  - 大: `px-4 py-2.5 text-sm`

### 共通スタイル

- **角丸**: `rounded-sm`（控えめな角丸）
- **トランジション**: `transition-colors`
- **無効状態**: `disabled:opacity-50 disabled:cursor-not-allowed`
- **余白**: コンパクトに（p-2〜p-4, mb-3, gap-2 など）
