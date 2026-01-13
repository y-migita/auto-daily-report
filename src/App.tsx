import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  checkScreenRecordingPermission,
  requestScreenRecordingPermission,
} from "tauri-plugin-macos-permissions-api";
import {
  getScreenshotableMonitors,
  getMonitorScreenshot,
} from "tauri-plugin-screenshots-api";

type PermissionStatus = "checking" | "granted" | "denied" | "unknown";

function App() {
  const [screenshotSrc, setScreenshotSrc] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [permissionStatus, setPermissionStatus] =
    useState<PermissionStatus>("checking");
  const [debugInfo, setDebugInfo] = useState<string>("");

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
      // 権限設定を開く
      await openScreenRecordingSettings();
    } catch (e) {
      setDebugInfo(`Failed to request permission: ${e}`);
    }
  }

  useEffect(() => {
    checkPermission();
  }, []);

  async function takeScreenshot() {
    setIsCapturing(true);
    setDebugInfo("Starting capture...");
    try {
      // 権限チェック
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

      // モニター一覧を取得
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

      // メインモニターのスクリーンショットを取得
      const mainMonitor = monitors[0];
      setDebugInfo(`Taking screenshot of monitor: ${mainMonitor.id}`);
      const tempPath = await getMonitorScreenshot(mainMonitor.id);
      setDebugInfo(`Screenshot captured to: ${tempPath}`);

      // Rustでリサイズ・JPEG変換・保存
      const savedPath = await invoke<string>("process_screenshot", {
        sourcePath: tempPath,
      });
      setDebugInfo(`Processed and saved to: ${savedPath}`);

      // 表示
      const assetUrl = `${convertFileSrc(savedPath)}?t=${Date.now()}`;
      setScreenshotSrc(assetUrl);
    } catch (error) {
      setDebugInfo(`Error: ${error}`);
      console.error("Failed to take screenshot:", error);
    } finally {
      setIsCapturing(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800 p-4">
      <div className="max-w-2xl">
        <h1 className="text-xl font-medium mb-4 text-slate-700">
          スクリーンショット
        </h1>

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
          disabled={isCapturing}
          className="w-full mb-3 px-4 py-2.5 text-sm border border-slate-400 rounded-sm bg-slate-600 hover:bg-slate-700 active:bg-slate-800 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isCapturing ? "撮影中..." : "スクリーンショットを撮る"}
        </button>

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
      </div>
    </main>
  );
}

export default App;
