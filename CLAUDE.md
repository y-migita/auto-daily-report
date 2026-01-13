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

### 注意点

- Vite開発サーバーはポート1420固定（`vite.config.ts`で設定）
- パッケージマネージャーはbunを使用
