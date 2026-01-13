import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkScreenRecordingPermission,
  requestScreenRecordingPermission,
} from "tauri-plugin-macos-permissions-api";
import {
  getScreenshotableMonitors,
  getMonitorScreenshot,
} from "tauri-plugin-screenshots-api";
import Settings, { DEFAULT_MODEL, DEFAULT_PROMPT, DEFAULT_AUTO_CAPTURE_INTERVAL } from "./Settings";

type PermissionStatus = "checking" | "granted" | "denied" | "unknown";
type Tab = "screenshot" | "settings";

function App() {
  const [screenshotSrc, setScreenshotSrc] = useState<string | null>(null);
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [permissionStatus, setPermissionStatus] =
    useState<PermissionStatus>("checking");
  const [debugInfo, setDebugInfo] = useState<string>("");
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("screenshot");
  const [hasApiKey, setHasApiKey] = useState(false);

  // 自動撮影用state
  const [isAutoCapturing, setIsAutoCapturing] = useState(false);
  const [autoCaptureInterval, setAutoCaptureInterval] = useState(DEFAULT_AUTO_CAPTURE_INTERVAL);
  const [nextCaptureTime, setNextCaptureTime] = useState<Date | null>(null);
  const [captureCount, setCaptureCount] = useState(0);
  const autoCaptureTImerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);

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

  async function handleRequestPermission() {
    try {
      setDebugInfo("Requesting screen recording permission...");
      await requestScreenRecordingPermission();
      setDebugInfo(
        "Permission requested. Please enable in System Settings and restart the app."
      );
      await openScreenRecordingSettings();
    } catch (e) {
      setDebugInfo(`Failed to request permission: ${e}`);
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
      if (autoCaptureTImerRef.current) {
        clearInterval(autoCaptureTImerRef.current);
      }
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
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
          "Screen recording permission denied. Please enable in System Settings."
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
          "No monitors found. This typically means screen recording permission is not granted."
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
      const hasPermission = await checkScreenRecordingPermission();
      if (!hasPermission) {
        setDebugInfo("自動撮影: 権限がありません。自動撮影を停止します。");
        stopAutoCapture();
        return;
      }

      const monitors = await getScreenshotableMonitors();
      if (!monitors || monitors.length === 0) {
        setDebugInfo("自動撮影: モニターが見つかりません。自動撮影を停止します。");
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

      setCaptureCount((prev) => prev + 1);
      setDebugInfo(`自動撮影: ${savedPath}`);
    } catch (error) {
      setDebugInfo(`自動撮影エラー: ${error}`);
      console.error("Auto capture failed:", error);
    }
  }, []);

  // 自動撮影を開始
  function startAutoCapture() {
    if (isAutoCapturing) return;

    // 最初の撮影を即実行
    takeScreenshotForAuto();
    setCaptureCount(1);

    // 次回撮影時刻を設定
    const nextTime = new Date(Date.now() + autoCaptureInterval * 1000);
    setNextCaptureTime(nextTime);

    // 撮影タイマーを設定
    autoCaptureTImerRef.current = window.setInterval(() => {
      takeScreenshotForAuto();
      setCaptureCount((prev) => prev + 1);
      setNextCaptureTime(new Date(Date.now() + autoCaptureInterval * 1000));
    }, autoCaptureInterval * 1000);

    // カウントダウン更新用タイマー（1秒ごと）
    countdownTimerRef.current = window.setInterval(() => {
      setNextCaptureTime((prev) => prev ? new Date(prev.getTime()) : null);
    }, 1000);

    setIsAutoCapturing(true);
    setDebugInfo(`自動撮影を開始しました（${autoCaptureInterval}秒間隔）`);
  }

  // 自動撮影を停止
  function stopAutoCapture() {
    if (autoCaptureTImerRef.current) {
      clearInterval(autoCaptureTImerRef.current);
      autoCaptureTImerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setIsAutoCapturing(false);
    setNextCaptureTime(null);
    setDebugInfo("自動撮影を停止しました");
  }

  // 次回撮影までの残り秒数を計算
  function getRemainingSeconds(): number {
    if (!nextCaptureTime) return 0;
    const remaining = Math.max(0, Math.ceil((nextCaptureTime.getTime() - Date.now()) / 1000));
    return remaining;
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
    <main className="min-h-screen bg-slate-50 text-slate-800 p-4">
      <div className="max-w-2xl">
        {/* タブナビゲーション */}
        <div className="flex gap-1 mb-4 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab("screenshot")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "screenshot"
                ? "text-slate-700 border-b-2 border-slate-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            スクリーンショット
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("settings")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "settings"
                ? "text-slate-700 border-b-2 border-slate-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            設定
          </button>
        </div>

        {activeTab === "screenshot" ? (
          <>
            {/* 権限ステータス */}
            <div className="mb-3 p-3 border border-slate-200 rounded-sm bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">権限:</span>
                  <span
                    className={`px-2 py-0.5 text-xs rounded-sm border ${
                      permissionStatus === "granted"
                        ? "border-slate-400 bg-slate-100 text-slate-700"
                        : permissionStatus === "denied"
                          ? "border-slate-400 bg-slate-200 text-slate-700"
                          : "border-slate-300 bg-slate-50 text-slate-600"
                    }`}
                  >
                    {permissionStatus === "granted"
                      ? "許可済み"
                      : permissionStatus === "denied"
                        ? "拒否"
                        : permissionStatus === "checking"
                          ? "確認中"
                          : "不明"}
                  </span>
                  {!hasApiKey && (
                    <span className="px-2 py-0.5 text-xs rounded-sm border border-slate-400 bg-slate-200 text-slate-700">
                      APIキー未設定
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={checkPermission}
                    className="px-3 py-1.5 text-sm border border-slate-300 rounded-sm bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 transition-colors"
                  >
                    再確認
                  </button>
                  {permissionStatus === "denied" && (
                    <button
                      type="button"
                      onClick={handleRequestPermission}
                      className="px-3 py-1.5 text-sm border border-slate-400 rounded-sm bg-slate-600 hover:bg-slate-700 active:bg-slate-800 text-white transition-colors"
                    >
                      権限を要求
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={openScreenRecordingSettings}
                    className="px-3 py-1.5 text-sm border border-slate-300 rounded-sm bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 transition-colors"
                  >
                    設定を開く
                  </button>
                </div>
              </div>
            </div>

            {/* デバッグ情報 */}
            {debugInfo && (
              <div className="mb-3 p-2 border border-slate-200 rounded-sm bg-slate-50">
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
              className="w-full mb-3 px-4 py-2.5 text-sm border border-slate-400 rounded-sm bg-slate-600 hover:bg-slate-700 active:bg-slate-800 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isCapturing ? "撮影中..." : "スクリーンショットを撮る"}
            </button>

            {/* 自動撮影コントロール */}
            <div className="mb-3 p-3 border border-slate-200 rounded-sm bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-700">自動撮影</span>
                  {isAutoCapturing && (
                    <>
                      <span className="px-2 py-0.5 text-xs rounded-sm border border-slate-400 bg-slate-100 text-slate-700">
                        {captureCount}枚撮影済み
                      </span>
                      <span className="text-xs text-slate-500">
                        次回まで {getRemainingSeconds()}秒
                      </span>
                    </>
                  )}
                  {!isAutoCapturing && (
                    <span className="text-xs text-slate-500">
                      {autoCaptureInterval}秒間隔
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={isAutoCapturing ? stopAutoCapture : startAutoCapture}
                  disabled={permissionStatus !== "granted"}
                  className={`px-3 py-1.5 text-sm border rounded-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    isAutoCapturing
                      ? "border-slate-300 bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700"
                      : "border-slate-400 bg-slate-600 hover:bg-slate-700 active:bg-slate-800 text-white"
                  }`}
                >
                  {isAutoCapturing ? "停止" : "開始"}
                </button>
              </div>
            </div>

            {/* AI分析ボタン */}
            {screenshotPath && (
              <button
                type="button"
                onClick={analyzeWithAI}
                disabled={isAnalyzing || !hasApiKey}
                className="w-full mb-3 px-4 py-2.5 text-sm border border-slate-300 rounded-sm bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
              <div className="mb-3 p-3 border border-slate-200 rounded-sm bg-white">
                <h3 className="text-sm font-medium text-slate-700 mb-2">
                  AI分析結果
                </h3>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">
                  {analysisResult}
                </p>
              </div>
            )}

            {/* スクリーンショット表示 */}
            {screenshotSrc && (
              <div className="border border-slate-200 rounded-sm bg-white p-2">
                <img
                  src={screenshotSrc}
                  alt="スクリーンショット"
                  className="w-full h-auto rounded-sm"
                />
              </div>
            )}
          </>
        ) : (
          <Settings
            onSettingsChange={() => {
              checkApiKey();
            }}
          />
        )}
      </div>
    </main>
  );
}

export default App;
