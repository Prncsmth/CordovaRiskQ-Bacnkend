// src/lib/tidePolling.ts
import { tideService } from "@/services/tide.service";

// 6 hours -- tide curves are smooth so frequent polling buys little, and
// this keeps well under Stormglass's daily request quota (2 requests per
// poll). tide.service.ts's own freshness check additionally no-ops a
// redundant call within the last hour, e.g. from a dev-server restart.
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;

let pollInFlight = false;

function pollOnce() {
    if (pollInFlight) return;
    pollInFlight = true;
    tideService
        .refreshTideStatus()
        .catch((error) => {
            console.error("Tide poll failed:", error);
        })
        .finally(() => {
            pollInFlight = false;
        });
}

export function startTidePolling(): void {
    pollOnce();
    setInterval(pollOnce, POLL_INTERVAL_MS);
}
