// Web Worker for countdown timer
// Runs on a separate thread, not affected by browser throttling in background tabs

let intervalId: number | null = null;
let targetTime: number | null = null;

self.onmessage = (e: MessageEvent) => {
  const { type, data } = e.data;

  switch (type) {
    case "start":
      // Start countdown with target time
      targetTime = data.targetTime;
      if (intervalId) {
        clearInterval(intervalId);
      }
      // Send initial remaining time
      sendRemaining();
      // Update every second
      intervalId = setInterval(sendRemaining, 1000) as unknown as number;
      break;

    case "updateTarget":
      // Update target time (for next capture)
      targetTime = data.targetTime;
      sendRemaining();
      break;

    case "stop":
      // Stop the countdown
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      targetTime = null;
      break;
  }
};

function sendRemaining() {
  if (targetTime === null) return;

  const remaining = Math.max(
    0,
    Math.ceil((targetTime - Date.now()) / 1000)
  );
  self.postMessage({ type: "tick", remaining });
}
