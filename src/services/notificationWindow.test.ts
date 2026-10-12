import assert from "node:assert/strict";
import { test } from "node:test";

import {
    NOTIFICATION_TTL_MS,
    adminActivityNotification,
    canAccessNotification,
    notificationWindowStart,
} from "@/services/notificationWindow";

const NOW = new Date("2026-10-12T12:00:00.000Z");

test("admins and responders only see the last 24 hours, counted from createdAt", () => {
    assert.equal(NOTIFICATION_TTL_MS, 24 * 60 * 60 * 1000);
    for (const role of ["admin", "responder"]) {
        assert.equal(notificationWindowStart(role, NOW)?.toISOString(), "2026-10-11T12:00:00.000Z");
    }
});

test("citizens keep their existing, unexpiring notification list", () => {
    assert.equal(notificationWindowStart("citizen", NOW), null);
    assert.equal(notificationWindowStart(undefined, NOW), null);
});

test("only the notification's own user may read or change it", () => {
    assert.equal(canAccessNotification({ userId: "a" }, "a"), true);
    assert.equal(canAccessNotification({ userId: "a" }, "b"), false);
    assert.equal(canAccessNotification(null, "a"), false);
});

test("an admin activity becomes the admin's own notification row", () => {
    assert.deepEqual(
        adminActivityNotification({
            type: "sos_alert",
            title: "New SOS alert",
            detail: "Barangay Day-as, Cordova",
            occurredAt: NOW.toISOString(),
        }),
        { type: "sos_alert", title: "New SOS alert", body: "Barangay Day-as, Cordova" },
    );
});
