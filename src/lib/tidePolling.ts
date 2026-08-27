// src/lib/tidePolling.ts
import { tideService } from "@/services/tide.service";

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function pollOnce() {
    tideService.refreshTideStatus().catch((error) => {
        console.error("Tide poll failed:", error);
    });
}

export function startTidePolling(): void {
    pollOnce();
    setInterval(pollOnce, POLL_INTERVAL_MS);
}
