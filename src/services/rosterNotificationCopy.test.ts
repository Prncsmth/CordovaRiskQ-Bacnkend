import assert from "node:assert/strict";
import { test } from "node:test";

import { ROSTER_NOTIFICATION_COPY } from "@/services/rosterNotificationCopy";

test("teammate notifications are titled as team updates", () => {
    assert.deepEqual(ROSTER_NOTIFICATION_COPY.joined?.("Juan"), {
        title: "Teammate joined",
        body: "Juan joined this incident.",
    });
    assert.deepEqual(ROSTER_NOTIFICATION_COPY.on_the_way?.("Juan"), {
        title: "Teammate en route",
        body: "Juan is on the way.",
    });
    assert.deepEqual(ROSTER_NOTIFICATION_COPY.arrived?.("Juan"), {
        title: "Teammate arrived",
        body: "Juan arrived on scene.",
    });
    assert.deepEqual(ROSTER_NOTIFICATION_COPY.left?.("Juan"), {
        title: "Teammate left",
        body: "Juan left this incident.",
    });
});

test("no teammate title reuses the citizen-facing 'Responder ...' wording", () => {
    for (const copy of Object.values(ROSTER_NOTIFICATION_COPY)) {
        assert.ok(!copy!("Juan").title.startsWith("Responder"));
    }
});

test("declining notifies nobody", () => {
    assert.equal(ROSTER_NOTIFICATION_COPY.declined, undefined);
});
