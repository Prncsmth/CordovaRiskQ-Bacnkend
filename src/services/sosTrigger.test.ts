import assert from "node:assert/strict";
import { test } from "node:test";

import {
    triggerSos,
    type SosAlertRow,
    type SosStore,
    type SosTriggerInput,
    type TriggerSosDeps,
} from "@/services/sosTrigger";

type FakeIncident = { id: string; sosAlertId: string; reporterId: string; status: string };

const INPUT: SosTriggerInput = { latitude: 10.25, longitude: 123.95, locationLabel: "Poblacion" };
const ACTIVE = ["pending", "lobby", "on_the_way", "arrived"];

// In-memory stand-in for the Prisma-backed store. runExclusive serializes
// work per user with a promise chain, mirroring the per-user advisory lock
// the real implementation takes.
function createFakeDeps(options: { failIncident?: boolean; notify?: () => Promise<void> } = {}) {
    const alerts: SosAlertRow[] = [];
    const incidents: FakeIncident[] = [];
    const announced: { alert: SosAlertRow; incident: FakeIncident | null }[] = [];
    const notified: FakeIncident[] = [];
    const locks = new Map<string, Promise<unknown>>();
    let seq = 0;

    const store: SosStore<FakeIncident> = {
        async findActive(userId) {
            const incident = [...incidents]
                .reverse()
                .find((i) => i.reporterId === userId && ACTIVE.includes(i.status));
            if (!incident) return null;
            const alert = alerts.find((a) => a.id === incident.sosAlertId);
            return alert ? { alert, incidentId: incident.id } : null;
        },
        async create(userId) {
            // Yield so concurrent callers would interleave here without a lock.
            await new Promise((resolve) => setImmediate(resolve));
            const alert = { id: `alert-${++seq}`, status: "active", createdAt: new Date() };
            alerts.push(alert);
            if (options.failIncident) return { alert, incident: null };
            const incident = { id: `incident-${seq}`, sosAlertId: alert.id, reporterId: userId, status: "pending" };
            incidents.push(incident);
            return { alert, incident };
        },
    };

    const deps: TriggerSosDeps<FakeIncident> = {
        runExclusive(userId, work) {
            const previous = locks.get(userId) ?? Promise.resolve();
            const next = previous.then(() => work(store));
            locks.set(userId, next.catch(() => {}));
            return next;
        },
        announce(alert, incident) {
            announced.push({ alert, incident });
        },
        notifyResponders(incident) {
            notified.push(incident);
            return options.notify ? options.notify() : Promise.resolve();
        },
    };

    return { deps, alerts, incidents, announced, notified };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("triggerSos creates a new SOS when the user has no active one", async () => {
    const { deps, alerts, incidents, announced, notified } = createFakeDeps();

    const result = await triggerSos("user-1", INPUT, deps);
    await flush();

    assert.equal(result.duplicate, false);
    assert.equal(result.id, "alert-1");
    assert.equal(result.incidentId, "incident-1");
    assert.equal(alerts.length, 1);
    assert.equal(incidents.length, 1);
    assert.equal(announced.length, 1);
    assert.equal(notified.length, 1);
});

test("triggerSos returns the existing active SOS instead of creating a duplicate", async () => {
    const { deps, alerts, incidents, announced, notified } = createFakeDeps();

    const first = await triggerSos("user-1", INPUT, deps);
    const second = await triggerSos("user-1", INPUT, deps);
    await flush();

    assert.equal(second.duplicate, true);
    assert.equal(second.id, first.id);
    assert.equal(second.incidentId, first.incidentId);
    assert.deepEqual(second.createdAt, first.createdAt);
    assert.equal(alerts.length, 1);
    assert.equal(incidents.length, 1);
    // A repeat tap must not re-page responders or re-announce to admins.
    assert.equal(announced.length, 1);
    assert.equal(notified.length, 1);
});

test("triggerSos collapses concurrent taps from the same user into one SOS", async () => {
    const { deps, alerts, notified } = createFakeDeps();

    const results = await Promise.all([
        triggerSos("user-1", INPUT, deps),
        triggerSos("user-1", INPUT, deps),
        triggerSos("user-1", INPUT, deps),
    ]);
    await flush();

    assert.equal(alerts.length, 1);
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    assert.equal(results.filter((r) => !r.duplicate).length, 1);
    assert.equal(notified.length, 1);
});

test("triggerSos allows a new SOS once the previous incident is no longer active", async () => {
    const { deps, alerts, incidents } = createFakeDeps();

    await triggerSos("user-1", INPUT, deps);
    incidents[0].status = "completed";
    const next = await triggerSos("user-1", INPUT, deps);

    assert.equal(next.duplicate, false);
    assert.equal(alerts.length, 2);

    incidents[1].status = "cancelled";
    const third = await triggerSos("user-1", INPUT, deps);
    assert.equal(third.duplicate, false);
    assert.equal(alerts.length, 3);
});

test("triggerSos does not dedupe across different users", async () => {
    const { deps, alerts } = createFakeDeps();

    const a = await triggerSos("user-1", INPUT, deps);
    const b = await triggerSos("user-2", INPUT, deps);

    assert.equal(a.duplicate, false);
    assert.equal(b.duplicate, false);
    assert.notEqual(a.id, b.id);
    assert.equal(alerts.length, 2);
});

test("triggerSos resolves without waiting for the responder push", async () => {
    let pushSettled = false;
    const { deps, notified } = createFakeDeps({
        // Never resolves -- simulates a hung Expo request.
        notify: () =>
            new Promise<void>(() => {}).finally(() => {
                pushSettled = true;
            }),
    });

    const result = await triggerSos("user-1", INPUT, deps);
    await flush();

    assert.equal(result.duplicate, false);
    assert.equal(notified.length, 1);
    assert.equal(pushSettled, false);
});

test("triggerSos still succeeds when the responder push fails", async (t) => {
    const errorLog = t.mock.method(console, "error", () => {});
    const { deps } = createFakeDeps({ notify: () => Promise.reject(new Error("expo 500")) });

    const result = await triggerSos("user-1", INPUT, deps);
    await flush();

    assert.equal(result.duplicate, false);
    assert.equal(result.incidentId, "incident-1");
    assert.equal(errorLog.mock.callCount(), 1);
});

test("triggerSos keeps the SOS and skips the push when the linked incident could not be created", async () => {
    const { deps, alerts, announced, notified } = createFakeDeps({ failIncident: true });

    const result = await triggerSos("user-1", INPUT, deps);
    await flush();

    assert.equal(result.duplicate, false);
    assert.equal(result.incidentId, null);
    assert.equal(alerts.length, 1);
    assert.equal(announced.length, 1);
    assert.equal(notified.length, 0);
});
