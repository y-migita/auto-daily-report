import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { useEffect, useState } from "react";

const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_PROMPT =
  "このスクリーンショットから、今やっている作業を日本語で1〜3行で記録してください。固有名詞（アプリ名、ファイル名、URLなど）は可能な限り残してください。";

const AVAILABLE_MODELS = [
  { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite (推奨)" },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
  { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
  { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
];

interface SettingsProps {
  onSettingsChange?: () => void;
}

function Settings({ onSettingsChange }: SettingsProps) {
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      // APIキーの存在確認
      const hasKey = await invoke<boolean>("has_gemini_api_key");
      setHasApiKey(hasKey);

      // Storeから設定を読み込み
      const store = await load("settings.json");
      const savedModel = await store.get<string>("model");
      const savedPrompt = await store.get<string>("prompt");

      if (savedModel) setModel(savedModel);
      if (savedPrompt) setPrompt(savedPrompt);
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }

  async function handleSaveApiKey() {
    if (!apiKey.trim()) {
      setMessage({ type: "error", text: "APIキーを入力してください" });
      return;
    }

    setIsSaving(true);
    try {
      await invoke("set_gemini_api_key", { apiKey: apiKey.trim() });
      setHasApiKey(true);
      setApiKey("");
      setMessage({ type: "success", text: "APIキーを保存しました" });
      onSettingsChange?.();
    } catch (error) {
      setMessage({ type: "error", text: `保存に失敗しました: ${error}` });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteApiKey() {
    setIsSaving(true);
    try {
      await invoke("delete_gemini_api_key");
      setHasApiKey(false);
      setMessage({ type: "success", text: "APIキーを削除しました" });
      onSettingsChange?.();
    } catch (error) {
      setMessage({ type: "error", text: `削除に失敗しました: ${error}` });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveSettings() {
    setIsSaving(true);
    try {
      const store = await load("settings.json");
      await store.set("model", model);
      await store.set("prompt", prompt);
      await store.save();
      setMessage({ type: "success", text: "設定を保存しました" });
      onSettingsChange?.();
    } catch (error) {
      setMessage({ type: "error", text: `保存に失敗しました: ${error}` });
    } finally {
      setIsSaving(false);
    }
  }

  function handleResetPrompt() {
    setPrompt(DEFAULT_PROMPT);
  }

  return (
    <div className="space-y-4">
      {/* メッセージ表示 */}
      {message && (
        <div
          className={`p-2 text-sm rounded-sm border ${
            message.type === "success"
              ? "border-slate-400 bg-slate-100 text-slate-700"
              : "border-slate-400 bg-slate-200 text-slate-700"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* APIキー設定 */}
      <div className="p-3 border border-slate-200 rounded-sm bg-white">
        <h2 className="text-sm font-medium text-slate-700 mb-2">
          Gemini APIキー
        </h2>
        <p className="text-xs text-slate-500 mb-2">
          APIキーはmacOS Keychainに安全に保存されます。
        </p>

        {hasApiKey ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">APIキー: 設定済み</span>
            <button
              type="button"
              onClick={handleDeleteApiKey}
              disabled={isSaving}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-sm bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 transition-colors disabled:opacity-50"
            >
              削除
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="APIキーを入力"
              className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-sm bg-white focus:outline-none focus:border-slate-400"
            />
            <button
              type="button"
              onClick={handleSaveApiKey}
              disabled={isSaving}
              className="px-3 py-1.5 text-sm border border-slate-400 rounded-sm bg-slate-600 hover:bg-slate-700 active:bg-slate-800 text-white font-medium transition-colors disabled:opacity-50"
            >
              保存
            </button>
          </div>
        )}
      </div>

      {/* モデル設定 */}
      <div className="p-3 border border-slate-200 rounded-sm bg-white">
        <h2 className="text-sm font-medium text-slate-700 mb-2">モデル</h2>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-sm bg-white focus:outline-none focus:border-slate-400"
        >
          {AVAILABLE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {/* プロンプト設定 */}
      <div className="p-3 border border-slate-200 rounded-sm bg-white">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-slate-700">プロンプト</h2>
          <button
            type="button"
            onClick={handleResetPrompt}
            className="px-2 py-1 text-xs border border-slate-300 rounded-sm bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-600 transition-colors"
          >
            リセット
          </button>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-sm bg-white focus:outline-none focus:border-slate-400 resize-none"
        />
      </div>

      {/* 保存ボタン */}
      <button
        type="button"
        onClick={handleSaveSettings}
        disabled={isSaving}
        className="w-full px-4 py-2.5 text-sm border border-slate-400 rounded-sm bg-slate-600 hover:bg-slate-700 active:bg-slate-800 text-white font-medium transition-colors disabled:opacity-50"
      >
        設定を保存
      </button>
    </div>
  );
}

export default Settings;

export { DEFAULT_MODEL, DEFAULT_PROMPT };
