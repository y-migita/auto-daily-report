import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import {
  getMonitorScreenshot,
  getScreenshotableMonitors,
} from "tauri-plugin-screenshots-api";
import reactLogo from "./assets/react.svg";
import "./App.css";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
  const [screenshotSrc, setScreenshotSrc] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  async function greet() {
    setGreetMsg(await invoke("greet", { name }));
  }

  async function takeScreenshot() {
    setIsCapturing(true);
    try {
      const monitors = await getScreenshotableMonitors();
      if (monitors.length === 0) {
        alert("No monitors available for screenshot");
        return;
      }
      const path = await getMonitorScreenshot(monitors[0].id);
      const assetUrl = convertFileSrc(path);
      setScreenshotSrc(assetUrl);
    } catch (error) {
      console.error("Failed to take screenshot:", error);
      alert(`Failed to take screenshot: ${error}`);
    } finally {
      setIsCapturing(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 pt-[10vh] flex flex-col items-center">
      <h1 className="text-3xl font-bold mb-6">Welcome to Tauri + React</h1>

      <div className="flex justify-center gap-4 mb-4">
        <a href="https://vite.dev" target="_blank" rel="noopener">
          <img
            src="/vite.svg"
            className="h-24 p-6 transition-all duration-700 hover:drop-shadow-[0_0_2em_#747bff]"
            alt="Vite logo"
          />
        </a>
        <a href="https://tauri.app" target="_blank" rel="noopener">
          <img
            src="/tauri.svg"
            className="h-24 p-6 transition-all duration-700 hover:drop-shadow-[0_0_2em_#24c8db]"
            alt="Tauri logo"
          />
        </a>
        <a href="https://react.dev" target="_blank" rel="noopener">
          <img
            src={reactLogo}
            className="h-24 p-6 transition-all duration-700 hover:drop-shadow-[0_0_2em_#61dafb]"
            alt="React logo"
          />
        </a>
      </div>
      <p className="mb-6">
        Click on the Tauri, Vite, and React logos to learn more.
      </p>

      <form
        className="flex justify-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors cursor-pointer"
        >
          Greet
        </button>
      </form>
      <p className="mt-4 text-lg">{greetMsg}</p>

      <div className="mt-8 flex flex-col items-center">
        <button
          type="button"
          onClick={takeScreenshot}
          disabled={isCapturing}
          className="px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 active:bg-green-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isCapturing ? "Capturing..." : "Take Screenshot"}
        </button>

        {screenshotSrc && (
          <div className="mt-4 max-w-2xl">
            <img
              src={screenshotSrc}
              alt="Screenshot"
              className="rounded-lg shadow-lg max-w-full h-auto"
            />
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
