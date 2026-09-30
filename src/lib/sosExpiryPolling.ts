// src/lib/sosExpiryPolling.ts
import { incidentService } from "@/services/incident.service";

// How long an SOS may sit with no responder joining before it's marked
// "expired" (Unattended on the admin panel). Override with SOS_EXPIRY_MINUTES.
const DEFAULT_EXPIRY_MINUTES = 60;
const POLL_INTERVAL_MS = 60 * 1000;

// Also used by sos.service.ts to age out alerts that have no incident.
export function sosExpiryMs(): number {
    const minutes = Number(process.env.SOS_EXPIRY_MINUTES);
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_EXPIRY_MINUTES) * 30 * 1000;
}

let pollInFlight = false;

function pollOnce() {
    if (pollInFlight) return;
    pollInFlight = true;
    incidentService
        .expireStaleSos(sosExpiryMs())
        .then((count) => {
            if (count > 0) console.log(`Expired ${count} unattended SOS alert(s)`);
        })
        .catch((error) => {
            console.error("SOS expiry poll failed:", error);
        })
        .finally(() => {
            pollInFlight = false;
        });
}

export function startSosExpiryPolling(): void {
    pollOnce();
    setInterval(pollOnce, POLL_INTERVAL_MS);
}
