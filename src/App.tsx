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
  DEFAULT_AUTO_ANALYZE,
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
  const [autoAnalyze, setAutoAnalyze] = useState(DEFAULT_AUTO_ANALYZE);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [captureCount, setCaptureCount] = useState(0);
  const autoCaptureTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const isStoppingRef = useRef(false);
  const nextCaptureTimeRef = useRef<Date | null>(null);
  const isCapturingRef = useRef(false);

  // トレーアイコン更新用関数
  const updateTrayTitle = useCallback(async (title: string) => {
    try {
      await invoke("update_tray_title", { title });
    } catch (error) {
      console.error("Failed to update tray title:", error);
    }
  }, []);

  const clearTrayTitle = useCallback(async () => {
    try {
      await invoke("clear_tray_title");
    } catch (error) {
      console.error("Failed to clear tray title:", error);
    }
  }, []);

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

  // 自動撮影設定を読み込む
  async function loadAutoCaptureSettings() {
    try {
      const store = await load("settings.json");
      const savedInterval = await store.get<number>("autoCaptureInterval");
      const savedAutoAnalyze = await store.get<boolean>("autoAnalyze");
      if (savedInterval) {
        setAutoCaptureInterval(savedInterval);
      }
      if (savedAutoAnalyze !== undefined) {
        setAutoAnalyze(savedAutoAnalyze);
      }
    } catch (error) {
      console.error("Failed to load auto capture settings:", error);
    }
  }

  useEffect(() => {
    checkPermission();
    checkApiKey();
    loadAutoCaptureSettings();
  }, []);

  // 自動撮影のクリーンアップ
  useEffect(() => {
    return () => {
      if (autoCaptureTimerRef.current) {
        clearInterval(autoCaptureTimerRef.current);
      }
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
      // クリーンアップ時にトレーアイコンをリセット
      clearTrayTitle();
    };
  }, [clearTrayTitle]);

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

      // 自動AI分析が有効かつAPIキーがある場合、分析を実行
      if (autoAnalyze && hasApiKey) {
        setIsAnalyzing(true);
        setDebugInfo("AI分析中...");
        setAnalysisResult(null);
        const result = await runAIAnalysis(savedPath);
        if (result) {
          setAnalysisResult(result);
          setDebugInfo("撮影・分析完了");
        } else {
          setDebugInfo("撮影完了（分析エラー）");
        }
        setIsAnalyzing(false);
      }
    } catch (error) {
      setDebugInfo(`Error: ${error}`);
      console.error("Failed to take screenshot:", error);
    } finally {
      setIsCapturing(false);
    }
  }

  // 指定されたパスでAI分析を実行（UI更新なし、バックグラウンド用）
  const runAIAnalysis = useCallback(
    async (imagePath: string): Promise<string | null> => {
      try {
        const store = await load("settings.json");
        const model = (await store.get<string>("model")) || DEFAULT_MODEL;
        const prompt = (await store.get<string>("prompt")) || DEFAULT_PROMPT;

        const result = await invoke<string>("analyze_screenshot", {
          imagePath,
          model,
          prompt,
        });

        return result;
      } catch (error) {
        console.error("Failed to analyze screenshot:", error);
        return null;
      }
    },
    [],
  );

  // 自動撮影用の内部関数（UIのisCapturingを更新しない）
  const takeScreenshotForAuto = useCallback(async () => {
    // 撮影中フラグを設定（トレーアイコンの更新用）
    isCapturingRef.current = true;

    try {
      // 撮影中のステータスをトレーアイコンに表示
      await updateTrayTitle("📷");

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

      // 自動AI分析が有効かつAPIキーがある場合、バックグラウンドで分析を実行
      if (autoAnalyze && hasApiKey) {
        setDebugInfo(`自動撮影・分析中: ${savedPath}`);
        // トレーアイコンを分析中表示に
        await updateTrayTitle("🤖");
        const result = await runAIAnalysis(savedPath);
        if (result) {
          setAnalysisResult(result);
          setDebugInfo(`自動撮影・分析完了: ${savedPath}`);
        } else {
          setDebugInfo(`自動撮影完了（分析エラー）: ${savedPath}`);
        }
      } else {
        setDebugInfo(`自動撮影: ${savedPath}`);
      }
    } catch (error) {
      setDebugInfo(`自動撮影エラー: ${error}`);
      console.error("Auto capture failed:", error);
    } finally {
      // 撮影完了フラグをリセット
      isCapturingRef.current = false;
    }
  }, [updateTrayTitle, autoAnalyze, hasApiKey, runAIAnalysis]);

  // 自動撮影を開始
  async function startAutoCapture() {
    if (isAutoCapturing) return;

    // 停止フラグをリセット
    isStoppingRef.current = false;

    // ツールチップを更新
    await updateTrayTooltip(`自動撮影中（${autoCaptureInterval}秒間隔）`);

    // 最初の撮影を即実行
    takeScreenshotForAuto();
    setCaptureCount(1);

    // 次回撮影時刻を設定
    const nextTime = new Date(Date.now() + autoCaptureInterval * 1000);
    nextCaptureTimeRef.current = nextTime;
    setRemainingSeconds(autoCaptureInterval);

    // 撮影タイマーを設定
    autoCaptureTimerRef.current = window.setInterval(() => {
      const newNextTime = new Date(Date.now() + autoCaptureInterval * 1000);
      nextCaptureTimeRef.current = newNextTime;
      takeScreenshotForAuto();
      setCaptureCount((prev) => prev + 1);
    }, autoCaptureInterval * 1000);

    // カウントダウン更新用タイマー（1秒ごと）- トレーアイコンも同時更新
    // 目標時刻から計算するため、setIntervalのドリフトに影響されない
    countdownTimerRef.current = window.setInterval(() => {
      // 停止フラグが立っている場合はトレーアイコンを更新しない
      if (isStoppingRef.current) return;

      const targetTime = nextCaptureTimeRef.current;
      if (!targetTime) return;

      const remaining = Math.max(
        0,
        Math.ceil((targetTime.getTime() - Date.now()) / 1000),
      );
      setRemainingSeconds(remaining);

      // 撮影中でなければ残り時間をトレーアイコンに表示
      if (!isCapturingRef.current) {
        updateTrayTitle(`${remaining}秒`);
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
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setIsAutoCapturing(false);
    nextCaptureTimeRef.current = null;
    setRemainingSeconds(0);
    setDebugInfo("自動撮影を停止しました");

    // トレーアイコンをリセット
    await clearTrayTitle();
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
      const result = await runAIAnalysis(screenshotPath);
      if (result) {
        setAnalysisResult(result);
        setDebugInfo("分析完了");
      } else {
        setDebugInfo("AI分析エラー");
      }
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
