# ぱしゃログ (Auto Daily Report)

スクリーンショットを自動で撮影・蓄積し、AIを使って日報を自動生成するデスクトップアプリケーションです。

## 機能

- **定期的なスクリーンショットの自動撮影**: 設定した間隔で自動的にスクリーンショットを撮影
- **スクリーンショットの蓄積・管理**: 撮影した画像を日付別にローカル保存（`~/Pictures/auto-daily-report/YYYY-MM-DD/`）
- **AI日報自動生成**: Gemini APIを使用してスクリーンショットを解析し、日報を自動作成

## 技術スタック

- **フロントエンド**: React 19 + TypeScript
- **バックエンド**: Rust (Tauri 2)
- **スタイリング**: Tailwind CSS v4
- **ビルドツール**: Vite 7
- **パッケージマネージャー**: bun
- **リンター/フォーマッター**: Biome
- **AI**: Gemini API

## 開発

```bash
# 依存関係のインストール
bun install

# Tauriアプリを開発モードで起動
bun run tauri dev

# 本番ビルド
bun run tauri build

# コード品質
bun run typecheck # 型チェック
bun run lint      # リント
bun run format    # フォーマット
bun run check     # リント + フォーマット
```

## プロジェクト構成

```
src/                # Reactフロントエンド
  ├── App.tsx       # メインコンポーネント
  ├── Settings.tsx  # 設定画面
  └── main.tsx      # エントリーポイント
src-tauri/          # Tauriバックエンド（Rust）
  └── src/
      ├── lib.rs    # Tauriコマンド定義
      └── main.rs   # エントリーポイント
```

## 推奨IDE設定

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
