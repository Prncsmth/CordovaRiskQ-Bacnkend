// src/lib/tidePolling.ts
import { tideService } from "@/services/tide.service";

// 8 hours -- tide curves are smooth so frequent polling buys little, and
// this keeps well under Stormglass's daily request quota: 3 polls/day x
// 3 Stormglass calls/poll (sea-level + extremes + weather) = 9 requests/day,
// staying under the account's confirmed 10/day quota with a 1-request
// margin. tide.service.ts's own freshness check additionally no-ops a
// redundant call within the last hour, e.g. from a dev-server restart.
const POLL_INTERVAL_MS = 8 * 60 * 60 * 1000;

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
