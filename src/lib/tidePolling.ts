// src/lib/tidePolling.ts
import { tideService } from "@/services/tide.service";

// 8 hours -- tide curves are smooth so frequent polling buys little, and
// this keeps well under Stormglass's daily request quota: 3 polls/day x
// 2 Stormglass calls/poll (sea-level + extremes) = 6 requests/day, staying
// under the account's confirmed 10/day quota. tide.service.ts's own
// freshness check additionally no-ops a redundant call within the last
// ~7 hours, e.g. from a dev-server restart.
const TIDE_POLL_INTERVAL_MS = 8 * 60 * 60 * 1000;

// Weather now comes from Open-Meteo, which has no comparable daily-request
// ceiling for this single-location use, so it can refresh far more often
// than the tide half -- hourly is already more than a simple temp/cloud/
// rain summary needs.
const WEATHER_POLL_INTERVAL_MS = 60 * 60 * 1000;

let tidePollInFlight = false;
let weatherPollInFlight = false;

function pollTideOnce() {
    if (tidePollInFlight) return;
    tidePollInFlight = true;
    tideService
        .refreshTide()
        .catch((error) => {
            console.error("Tide poll failed:", error);
        })
        .finally(() => {
            tidePollInFlight = false;
        });
}

function pollWeatherOnce() {
    if (weatherPollInFlight) return;
    weatherPollInFlight = true;
    tideService
        .refreshWeather()
        .catch((error) => {
            console.error("Weather poll failed:", error);
        })
        .finally(() => {
            weatherPollInFlight = false;
        });
}

export function startTidePolling(): void {
    pollTideOnce();
    setInterval(pollTideOnce, TIDE_POLL_INTERVAL_MS);
}

export function startWeatherPolling(): void {
    pollWeatherOnce();
    setInterval(pollWeatherOnce, WEATHER_POLL_INTERVAL_MS);
}
