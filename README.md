# Auto Daily Report

スクリーンショットを自動で撮影・蓄積し、それをもとに日報を自動生成するデスクトップアプリケーションです。

## 機能

- 定期的なスクリーンショットの自動撮影
- 撮影したスクリーンショットの蓄積・管理
- 蓄積されたスクリーンショットをもとにした日報の自動生成

## 技術スタック

- **フロントエンド**: React + TypeScript
- **バックエンド**: Rust (Tauri)
- **ビルドツール**: Vite
- **パッケージマネージャー**: bun

## 開発

```bash
# 依存関係のインストール
bun install

# Tauriアプリを開発モードで起動
bun run tauri dev

# 本番ビルド
bun run tauri build
```

## 推奨IDE設定

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
