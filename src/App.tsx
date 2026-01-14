import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkScreenRecordingPermission,
  requestScreenRecordingPermission,
} from "tauri-plugin-macos-permissions-api";
import {
  getMonitorScreenshot,
  getScreenshotableMonitors,
} from "tauri-plugin-screenshots-api";
import { Badge } from "./components/Badge";
import Settings, {
  DEFAULT_AUTO_CAPTURE_INTERVAL,
  DEFAULT_MODEL,
  DEFAULT_PROMPT,
} from "./Settings";

type PermissionStatus = "checking" | "granted" | "denied" | "unknown";
type Tab = "capture" | "settings";

function App() {
  const [screenshotSrc, setScreenshotSrc] = useState<string | null>(null);
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [permissionStatus, setPermissionStatus] =
    useState<PermissionStatus>("checking");
  const [debugInfo, setDebugInfo] = useState<string>("");
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("capture");
  const [hasApiKey, setHasApiKey] = useState(false);

  // 自動撮影用state
  const [isAutoCapturing, setIsAutoCapturing] = useState(false);
  const [autoCaptureInterval, setAutoCaptureInterval] = useState(
    DEFAULT_AUTO_CAPTURE_INTERVAL,
  );
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [captureCount, setCaptureCount] = useState(0);
  const autoCaptureTimerRef = useRef<number | null>(null);
  const uiUpdateTimerRef = useRef<number | null>(null);
  const isStoppingRef = useRef(false);

  // トレーアイコンツールチップ更新用関数
  const updateTrayTooltip = useCallback(async (tooltip: string) => {
    try {
      await invoke("update_tray_tooltip", { tooltip });
    } catch (error) {
      console.error("Failed to update tray tooltip:", error);
    }
  }, []);

  async function checkApiKey() {
    try {
      const has = await invoke<boolean>("has_vercel_api_key");
      setHasApiKey(has);
    } catch {
      setHasApiKey(false);
    }
  }

  async function checkPermission(): Promise<boolean> {
    setPermissionStatus("checking");
    try {
      const hasPermission = await checkScreenRecordingPermission();
      setDebugInfo(`Screen recording permission: ${hasPermission}`);
      setPermissionStatus(hasPermission ? "granted" : "denied");
      return hasPermission;
    } catch (e) {
      setDebugInfo(`Error checking permission: ${e}`);
      setPermissionStatus("unknown");
      return false;
    }
  }

  async function openScreenRecordingSettings() {
    try {
      await invoke("open_screen_recording_settings");
      setDebugInfo("Opened screen recording settings");
    } catch (e) {
      setDebugInfo(`Failed to open settings: ${e}`);
    }
  }

  // 自動撮影間隔を設定から読み込む
  async function loadAutoCaptureInterval() {
    try {
      const store = await load("settings.json");
      const savedInterval = await store.get<number>("autoCaptureInterval");
      if (savedInterval) {
        setAutoCaptureInterval(savedInterval);
      }
    } catch (error) {
      console.error("Failed to load auto capture interval:", error);
    }
  }

  useEffect(() => {
    checkPermission();
    checkApiKey();
    loadAutoCaptureInterval();
  }, []);

  // 自動撮影のクリーンアップ
  useEffect(() => {
    return () => {
      if (autoCaptureTimerRef.current) {
        clearInterval(autoCaptureTimerRef.current);
      }
      if (uiUpdateTimerRef.current) {
        clearInterval(uiUpdateTimerRef.current);
      }
      // クリーンアップ時にRust側のタイマーを停止
      invoke("stop_countdown_timer").catch(console.error);
    };
  }, []);

  async function takeScreenshot() {
    setIsCapturing(true);
    setDebugInfo("Starting capture...");
    setAnalysisResult(null);
    try {
      const hasPermission = await checkScreenRecordingPermission();
      if (!hasPermission) {
        setDebugInfo(
          "Screen recording permission denied. Please enable in System Settings.",
        );
        setPermissionStatus("denied");
        await requestScreenRecordingPermission();
        await openScreenRecordingSettings();
        return;
      }

      setDebugInfo("Getting monitors...");
      const monitors = await getScreenshotableMonitors();
      if (!monitors || monitors.length === 0) {
        setDebugInfo(
          "No monitors found. This typically means screen recording permission is not granted.",
        );
        setPermissionStatus("denied");
        return;
      }
      setDebugInfo(`Found ${monitors.length} monitor(s)`);

      const mainMonitor = monitors[0];
      setDebugInfo(`Taking screenshot of monitor: ${mainMonitor.id}`);
      const tempPath = await getMonitorScreenshot(mainMonitor.id);
      setDebugInfo(`Screenshot captured to: ${tempPath}`);

      const savedPath = await invoke<string>("process_screenshot", {
        sourcePath: tempPath,
      });
      setDebugInfo(`Processed and saved to: ${savedPath}`);
      setScreenshotPath(savedPath);

      const assetUrl = `${convertFileSrc(savedPath)}?t=${Date.now()}`;
      setScreenshotSrc(assetUrl);
    } catch (error) {
      setDebugInfo(`Error: ${error}`);
      console.error("Failed to take screenshot:", error);
    } finally {
      setIsCapturing(false);
    }
  }

  // 自動撮影用の内部関数（UIのisCapturingを更新しない）
  const takeScreenshotForAuto = useCallback(async () => {
    try {
      // Rust側に撮影中フラグを設定（トレーアイコンに📷を表示）
      await invoke("set_capturing_flag", { isCapturing: true });

      const hasPermission = await checkScreenRecordingPermission();
      if (!hasPermission) {
        setDebugInfo("自動撮影: 権限がありません。自動撮影を停止します。");
        stopAutoCapture();
        return;
      }

      const monitors = await getScreenshotableMonitors();
      if (!monitors || monitors.length === 0) {
        setDebugInfo(
          "自動撮影: モニターが見つかりません。自動撮影を停止します。",
        );
        stopAutoCapture();
        return;
      }

      const mainMonitor = monitors[0];
      const tempPath = await getMonitorScreenshot(mainMonitor.id);

      const savedPath = await invoke<string>("process_screenshot", {
        sourcePath: tempPath,
      });

      setScreenshotPath(savedPath);
      const assetUrl = `${convertFileSrc(savedPath)}?t=${Date.now()}`;
      setScreenshotSrc(assetUrl);

      setDebugInfo(`自動撮影: ${savedPath}`);
    } catch (error) {
      setDebugInfo(`自動撮影エラー: ${error}`);
      console.error("Auto capture failed:", error);
    } finally {
      // Rust側の撮影中フラグをリセット
      await invoke("set_capturing_flag", { isCapturing: false });
      // カウントダウンをリセット（次の撮影サイクル開始）
      await invoke("reset_countdown");
    }
  }, []);

  // 自動撮影を開始
  async function startAutoCapture() {
    if (isAutoCapturing) return;

    // 停止フラグをリセット
    isStoppingRef.current = false;

    // ツールチップを更新
    await updateTrayTooltip(`自動撮影中（${autoCaptureInterval}秒間隔）`);

    // Rust側のカウントダウンタイマーを開始
    await invoke("start_countdown_timer", { intervalSeconds: autoCaptureInterval });

    // 最初の撮影を即実行
    takeScreenshotForAuto();
    setCaptureCount(1);
    setRemainingSeconds(autoCaptureInterval);

    // 撮影タイマーを設定
    autoCaptureTimerRef.current = window.setInterval(() => {
      takeScreenshotForAuto();
      setCaptureCount((prev) => prev + 1);
    }, autoCaptureInterval * 1000);

    // UI更新用タイマー（Rust側から残り秒数を取得）
    uiUpdateTimerRef.current = window.setInterval(async () => {
      if (isStoppingRef.current) return;
      try {
        const remaining = await invoke<number>("get_remaining_seconds");
        setRemainingSeconds(remaining);
      } catch {
        // エラーは無視
      }
    }, 1000);

    setIsAutoCapturing(true);
    setDebugInfo(`自動撮影を開始しました（${autoCaptureInterval}秒間隔）`);
  }

  // 自動撮影を停止
  async function stopAutoCapture() {
    // 停止フラグを先に立てて、タイマーコールバックからのトレー更新を防ぐ
    isStoppingRef.current = true;

    if (autoCaptureTimerRef.current) {
      clearInterval(autoCaptureTimerRef.current);
      autoCaptureTimerRef.current = null;
    }
    if (uiUpdateTimerRef.current) {
      clearInterval(uiUpdateTimerRef.current);
      uiUpdateTimerRef.current = null;
    }
    setIsAutoCapturing(false);
    setRemainingSeconds(0);
    setDebugInfo("自動撮影を停止しました");

    // Rust側のカウントダウンタイマーを停止（トレーアイコンもクリアされる）
    await invoke("stop_countdown_timer");
    await updateTrayTooltip("ぱしゃログ");
  }

  async function analyzeWithAI() {
    if (!screenshotPath) {
      setDebugInfo("先にスクリーンショットを撮影してください");
      return;
    }

    if (!hasApiKey) {
      setDebugInfo("先にAPIキーを設定してください");
      setActiveTab("settings");
      return;
    }

    setIsAnalyzing(true);
    setDebugInfo("AI分析中...");
    setAnalysisResult(null);

    try {
      // Storeから設定を読み込み
      const store = await load("settings.json");
      const model = (await store.get<string>("model")) || DEFAULT_MODEL;
      const prompt = (await store.get<string>("prompt")) || DEFAULT_PROMPT;

      const result = await invoke<string>("analyze_screenshot", {
        imagePath: screenshotPath,
        model,
        prompt,
      });

      setAnalysisResult(result);
      setDebugInfo("分析完了");
    } catch (error) {
      setDebugInfo(`AI分析エラー: ${error}`);
      console.error("Failed to analyze screenshot:", error);
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <main className="h-screen bg-slate-50 text-slate-800 p-4 overflow-hidden">
      <div className="h-full flex flex-col">
        {/* タブナビゲーション */}
        <div className="flex gap-1 mb-4 border-b border-slate-200 flex-shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("capture")}
            className={`px-4 py-2 text-sm transition-colors ${
              activeTab === "capture"
                ? "text-slate-700 border-b-2 border-slate-600 font-bold"
                : "text-slate-500 hover:text-slate-700 font-medium"
            }`}
          >
            撮影
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("settings")}
            className={`px-4 py-2 text-sm transition-colors ${
              activeTab === "settings"
                ? "text-slate-700 border-b-2 border-slate-600 font-bold"
                : "text-slate-500 hover:text-slate-700 font-medium"
            }`}
          >
            設定
          </button>
        </div>

        {activeTab === "capture" ? (
          <div className="flex-1 flex gap-4 min-h-0">
            {/* 左カラム: コントロール */}
            <div className="w-80 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
              {/* ステータス表示 */}
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    permissionStatus === "granted"
                      ? "default"
                      : permissionStatus === "denied"
                        ? "warning"
                        : "muted"
                  }
                >
                  {permissionStatus === "granted"
                    ? "権限: 許可済み"
                    : permissionStatus === "denied"
                      ? "権限: 拒否"
                      : permissionStatus === "checking"
                        ? "権限: 確認中"
                        : "権限: 不明"}
                </Badge>
                {!hasApiKey && <Badge variant="warning">APIキー未設定</Badge>}
              </div>

              {/* デバッグ情報 */}
              {debugInfo && (
                <div className="p-2 border border-slate-200 rounded-sm bg-slate-50">
                  <span className="text-xs text-slate-500 font-mono break-all">
                    {debugInfo}
                  </span>
                </div>
              )}

              {/* キャプチャボタン */}
              <button
                type="button"
                onClick={takeScreenshot}
                disabled={isCapturing || isAutoCapturing}
                className="w-full px-4 py-2.5 text-sm border border-slate-400 rounded-sm bg-slate-600 hover:bg-slate-700 active:bg-slate-800 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isCapturing ? "撮影中..." : "スクリーンショットを撮る"}
              </button>

              {/* 自動撮影コントロール */}
              <div className="p-3 border border-slate-200 rounded-sm bg-white">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-slate-700">
                    自動撮影
                  </span>
                  <button
                    type="button"
                    onClick={
                      isAutoCapturing ? stopAutoCapture : startAutoCapture
                    }
                    disabled={permissionStatus !== "granted"}
                    className={`px-3 py-1.5 text-sm border rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      isAutoCapturing
                        ? "border-slate-300 bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 font-medium"
                        : "border-slate-400 bg-slate-600 hover:bg-slate-700 active:bg-slate-800 text-white font-bold"
                    }`}
                  >
                    {isAutoCapturing ? "停止" : "開始"}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {isAutoCapturing ? (
                    <>
                      <Badge>{captureCount}枚撮影済み</Badge>
                      <span className="text-xs text-slate-500">
                        次回まで {remainingSeconds}秒
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">
                      {autoCaptureInterval}秒間隔
                    </span>
                  )}
                </div>
              </div>

              {/* AI分析ボタン */}
              {screenshotPath && (
                <button
                  type="button"
                  onClick={analyzeWithAI}
                  disabled={isAnalyzing || !hasApiKey}
                  className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-sm bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isAnalyzing
                    ? "分析中..."
                    : !hasApiKey
                      ? "APIキーを設定してください"
                      : "AIで分析する"}
                </button>
              )}

              {/* AI分析結果 */}
              {analysisResult && (
                <div className="p-3 border border-slate-200 rounded-sm bg-white">
                  <h3 className="text-sm font-bold text-slate-700 mb-2">
                    AI分析結果
                  </h3>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">
                    {analysisResult}
                  </p>
                </div>
              )}
            </div>

            {/* 右カラム: スクリーンショット表示 */}
            <div className="flex-1 min-w-0 overflow-hidden">
              {screenshotSrc ? (
                <div className="h-full border border-slate-200 rounded-sm bg-white p-2 overflow-auto">
                  <img
                    src={screenshotSrc}
                    alt="スクリーンショット"
                    className="w-full h-auto rounded-sm"
                  />
                </div>
              ) : (
                <div className="h-full border border-slate-200 rounded-sm bg-white flex items-center justify-center">
                  <span className="text-sm text-slate-400">
                    スクリーンショットがここに表示されます
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <Settings
              onSettingsChange={() => {
                checkApiKey();
              }}
            />
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
