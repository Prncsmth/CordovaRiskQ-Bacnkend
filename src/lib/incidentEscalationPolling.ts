// src/lib/incidentEscalationPolling.ts
// Checks for incidents left unanswered past the escalation window and
// pages the responders outside their territory (incidentService
// .escalateUnattendedIncidents). Same shape as sosExpiryPolling.ts.
import { incidentService } from "@/services/incident.service";

// Often enough that an escalation goes out within ~30s of the 2 minutes.
const POLL_INTERVAL_MS = 30 * 1000;

let pollInFlight = false;

function pollOnce() {
    if (pollInFlight) return;
    pollInFlight = true;
    incidentService
        .escalateUnattendedIncidents()
        .then((count) => {
            if (count > 0) console.log(`Escalated ${count} unanswered incident(s)`);
        })
        .catch((error) => {
            console.error("Incident escalation poll failed:", error);
        })
        .finally(() => {
            pollInFlight = false;
        });
}

export function startIncidentEscalationPolling(): void {
    pollOnce();
    setInterval(pollOnce, POLL_INTERVAL_MS);
}
