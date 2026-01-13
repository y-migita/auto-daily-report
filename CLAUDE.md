# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

**ぱしゃログ** - 日報自動作成のためのTauriデスクトップアプリケーション（macOS向け）。React + TypeScript（フロントエンド）とRust（バックエンド）で構成されている。

### 主な機能

1. **スクリーンショット撮影**: 手動/自動でスクリーンショットを撮影
2. **自動撮影機能**: 設定した間隔（10〜3600秒）で定期的に自動撮影
3. **画像最適化**: FHD（1920px幅）にリサイズ、JPEG圧縮（品質80）で保存
4. **AI分析**: Vercel AI Gateway経由で複数プロバイダー（Google, OpenAI, Anthropic, xAI）のVisionモデルで画像解析
5. **メニューバーアプリ**: Dockに表示せず、メニューバーのトレーアイコンから操作

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
bun run typecheck

# Lint・フォーマット（Biome）
bun run lint
bun run format
bun run check
```

## アーキテクチャ

```
src/                    # Reactフロントエンド（TypeScript）
  ├── App.tsx           # メイン画面（スクリーンショット撮影・表示・自動撮影制御）
  ├── Settings.tsx      # 設定画面（APIキー・モデル・プロンプト・撮影間隔）
  └── main.tsx          # エントリーポイント
src-tauri/              # Tauriバックエンド（Rust）
  └── src/
      ├── lib.rs        # Tauriコマンド定義・プラグイン設定・トレーアイコン
      └── main.rs       # エントリーポイント
```

### フロントエンド⇔バックエンド通信

- フロントエンドから`@tauri-apps/api/core`の`invoke`関数でRustコマンドを呼び出す
- Rustコマンドは`src-tauri/src/lib.rs`で`#[tauri::command]`マクロを使って定義
- 新しいコマンドは`invoke_handler`に登録が必要

### 主要Rustコマンド

| コマンド | 説明 |
|---------|------|
| `process_screenshot` | スクリーンショットをリサイズ・JPEG圧縮して保存 |
| `analyze_screenshot` | Vercel AI Gateway経由でAI分析 |
| `set_vercel_api_key` | APIキーをKeychainに保存 |
| `has_vercel_api_key` | APIキーの存在確認 |
| `delete_vercel_api_key` | APIキーを削除 |
| `update_tray_title` | トレーアイコンのタイトル更新 |
| `clear_tray_title` | トレーアイコンのタイトルクリア |
| `update_tray_tooltip` | トレーアイコンのツールチップ更新 |
| `open_screen_recording_settings` | 画面収録の設定画面を開く |

### スクリーンショット保存

- 保存先: `~/Pictures/auto-daily-report/YYYY-MM-DD/`
- ファイル名形式: `YYYYMMDD_HHMMSS_NNN.jpg`（年月日_時刻_連番、JPEG形式、ソート可能）
- 画像処理: 1920px幅にリサイズ（Lanczos3）、JPEG品質80で圧縮
- 依存クレート: `dirs`（Picturesフォルダ取得）、`chrono`（日時フォーマット）、`image`（画像処理）

### セキュリティ

- APIキーはmacOS Keychainに保存（`keyring`クレート使用）
- パスのバリデーション:
  - 一時ファイル: システム一時ディレクトリ、アプリキャッシュのみ許可
  - 画像ファイル: `~/Pictures/auto-daily-report/`内のみ許可
- シンボリックリンク攻撃対策として`canonicalize()`で正規化

### Tauriプラグイン

- `tauri-plugin-opener`: 外部リンクを開く
- `tauri-plugin-shell`: シェルコマンド実行
- `tauri-plugin-macos-permissions`: 画面収録権限の確認・要求
- `tauri-plugin-dialog`: ダイアログ表示
- `tauri-plugin-screenshots`: スクリーンショット撮影
- `tauri-plugin-store`: 設定の永続化（settings.json）

### 注意点

- Vite開発サーバーはポート1420固定（`vite.config.ts`で設定）
- パッケージマネージャーはbunを使用
- macOS専用アプリ（`ActivationPolicy::Accessory`でDock非表示）
- 画面サイズは1280x720固定

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
