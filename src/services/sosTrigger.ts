// src/services/sosTrigger.ts
// Orchestrates POST /sos: dedupe against the user's active SOS, create a new
// one otherwise, then announce it and page responders in the background. No
// Prisma -- storage, locking and side effects are injected (see
// sosService.trigger for the real wiring) so this is unit-tested directly.
import { runInBackground } from "@/utils/runInBackground";

export type SosTriggerInput = { latitude: number; longitude: number; locationLabel?: string };

export type SosAlertRow = { id: string; status: string; createdAt: Date };

export interface SosStore<TIncident extends { id: string }> {
    // The user's SOS whose linked incident is still active, if any.
    findActive(userId: string): Promise<{ alert: SosAlertRow; incidentId: string } | null>;
    // incident is null when the best-effort linked Incident write failed.
    create(
        userId: string,
        data: SosTriggerInput,
    ): Promise<{ alert: SosAlertRow; incident: TIncident | null }>;
}

export interface TriggerSosDeps<TIncident extends { id: string }> {
    // Must serialize work per user, so two concurrent taps can't both miss
    // findActive() and each create an SOS.
    runExclusive<T>(userId: string, work: (store: SosStore<TIncident>) => Promise<T>): Promise<T>;
    announce(alert: SosAlertRow, incident: TIncident | null, data: SosTriggerInput): void;
    notifyResponders(incident: TIncident): Promise<void>;
}

export async function triggerSos<TIncident extends { id: string }>(
    userId: string,
    data: SosTriggerInput,
    deps: TriggerSosDeps<TIncident>,
) {
    const outcome = await deps.runExclusive(userId, async (store) => {
        const existing = await store.findActive(userId);
        if (existing) {
            return { duplicate: true, alert: existing.alert, incidentId: existing.incidentId, incident: null };
        }
        const created = await store.create(userId, data);
        return {
            duplicate: false,
            alert: created.alert,
            incidentId: created.incident?.id ?? null,
            incident: created.incident,
        };
    });

    // A repeat tap returns the existing SOS as-is: admins were already
    // announced to and responders already paged when it was first created.
    if (!outcome.duplicate) {
        deps.announce(outcome.alert, outcome.incident, data);
        const incident = outcome.incident;
        if (incident) {
            runInBackground(`SOS responder push for incident ${incident.id}`, () =>
                deps.notifyResponders(incident),
            );
        }
    }

    return {
        id: outcome.alert.id,
        status: outcome.alert.status,
        createdAt: outcome.alert.createdAt,
        incidentId: outcome.incidentId,
        duplicate: outcome.duplicate,
    };
}
