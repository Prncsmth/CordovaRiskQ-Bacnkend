// Every admin action that changes data, or signs an admin in, leaves an
// AdminAuditLog row with the admin's name -- and never a password, code or
// token. Prisma is stubbed (no database), same pattern as
// announcement.service.test.ts; $transaction runs its callback against the
// same stubbed delegates so a test can check what is written inside it.
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { afterEach, before, mock, test } from "node:test";

import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/services/adminAuditLog.service";
import { authService } from "@/services/auth.service";
import { evacuationCenterService } from "@/services/evacuationCenter.service";
import { hotlineService } from "@/services/hotline.service";
import { sosService } from "@/services/sos.service";
import { userService } from "@/services/user.service";

const PASSWORD = "OldPass1!";
let passwordHash = "";

before(async () => {
    process.env.JWT_SECRET ??= "test-secret";
    passwordHash = await bcrypt.hash(PASSWORD, 4);
});

const originals = new Map<object, Map<string, unknown>>();
let auditRows: { adminId: string; action: string; detail: string; targetId: string | null }[] = [];
let transactions = 0;

function stub(target: object, name: string, impl: (args?: any) => unknown) {
    const t = target as Record<string, unknown>;
    if (!originals.has(t)) originals.set(t, new Map());
    const perTarget = originals.get(t)!;
    if (!perTarget.has(name)) perTarget.set(name, t[name]);
    t[name] = async (args?: unknown) => impl(args);
}

// The admin's name lookup and the audit insert, recorded in auditRows.
function stubAudit({ failCreate = 0 }: { failCreate?: number } = {}) {
    let failuresLeft = failCreate;
    stub(prisma.user, "findUnique", async (args) =>
        args?.select?.name ? { name: "Admin Juan" } : null,
    );
    stub(prisma.adminAuditLog, "create", async (args) => {
        if (failuresLeft > 0) {
            failuresLeft--;
            throw new Error("database unavailable");
        }
        auditRows.push(args.data);
        return args.data;
    });
    stub(prisma, "$transaction", async (fn: (tx: unknown) => unknown) => {
        transactions++;
        return fn(prisma);
    });
}

afterEach(() => {
    mock.restoreAll();
    for (const [target, perTarget] of originals) {
        for (const [name, original] of perTarget) (target as Record<string, unknown>)[name] = original;
    }
    originals.clear();
    auditRows = [];
    transactions = 0;
});

// --- evacuation centers ----------------------------------------------------

const CENTER = { id: "buagsong-es", name: "Buagsong Elementary School", status: "open", facilities: ["Water"] };

test("updating an evacuation center records who changed what, in the same transaction", async () => {
    stubAudit();
    stub(prisma.evacuationCenter, "findUnique", async () => CENTER);
    stub(prisma.evacuationCenter, "update", async (args) => ({ ...CENTER, ...args.data, updatedAt: new Date() }));

    await evacuationCenterService.update(CENTER.id, { status: "full" }, "admin-1");

    assert.equal(transactions, 1);
    assert.deepEqual(auditRows, [
        {
            adminId: "admin-1",
            action: "evacuation_center_updated",
            detail: "Admin Juan — Buagsong Elementary School: status Open → Full",
            targetId: CENTER.id,
        },
    ]);
});

test("each evacuation center update gets its own audit row", async () => {
    stubAudit();
    stub(prisma.evacuationCenter, "findUnique", async () => CENTER);
    stub(prisma.evacuationCenter, "update", async (args) => ({ ...CENTER, ...args.data, updatedAt: new Date() }));

    await evacuationCenterService.update(CENTER.id, { status: "full" }, "admin-1");
    await evacuationCenterService.update(CENTER.id, { facilities: ["Water", "Power"] }, "admin-1");

    assert.equal(auditRows.length, 2);
});

test("an evacuation center update fails if its audit row cannot be written", async () => {
    stubAudit({ failCreate: 1 });
    stub(prisma.evacuationCenter, "findUnique", async () => CENTER);
    stub(prisma.evacuationCenter, "update", async (args) => ({ ...CENTER, ...args.data, updatedAt: new Date() }));

    await assert.rejects(evacuationCenterService.update(CENTER.id, { status: "full" }, "admin-1"));
    assert.equal(auditRows.length, 0);
});

// --- hotlines --------------------------------------------------------------

test("updating a hotline records the old and new number, in the same transaction", async () => {
    stubAudit();
    const hotline = { id: "bfp", name: "BFP Cordova", number: "0917 111 2222", category: "fire" };
    stub(prisma.hotline, "findUnique", async () => hotline);
    stub(prisma.hotline, "update", async (args) => ({ ...hotline, ...args.data }));

    await hotlineService.update("bfp", { number: "0918 333 4444" }, "admin-1");

    assert.equal(transactions, 1);
    assert.equal(auditRows[0].action, "hotline_updated");
    assert.equal(auditRows[0].detail, "Admin Juan — BFP Cordova: number 0917 111 2222 → 0918 333 4444");
    assert.equal(auditRows[0].targetId, "bfp");
});

// --- SOS alerts ------------------------------------------------------------

test("closing an SOS alert records the admin and the outcome", async () => {
    stubAudit();
    stub(prisma.incident, "findFirst", async () => null);
    stub(prisma.sosAlert, "updateMany", async () => ({ count: 1 }));

    await sosService.closeForAdmin("sos-1", "dismissed", "admin-1");

    assert.equal(auditRows[0].action, "sos_alert_closed");
    assert.equal(auditRows[0].detail, "Admin Juan — Dismissed an SOS alert (location unavailable)");
    assert.equal(auditRows[0].targetId, "sos-1");
});

test("a failed SOS close is not recorded as closed", async () => {
    stubAudit();
    stub(prisma.incident, "findFirst", async () => null);
    stub(prisma.sosAlert, "updateMany", async () => ({ count: 0 }));
    stub(prisma.sosAlert, "findUnique", async () => ({ id: "sos-1" }));

    await assert.rejects(sosService.closeForAdmin("sos-1", "resolved", "admin-1"));
    assert.equal(auditRows.length, 0);
});

// --- admin sign-in ---------------------------------------------------------

test("a successful admin sign-in is recorded, without the password or token", async () => {
    stubAudit();
    stub(prisma.user, "findFirst", async () => ({
        id: "admin-1",
        name: "Admin Juan",
        email: "admin@example.com",
        role: "admin",
        password: passwordHash,
        tokenVersion: 0,
    }));

    const { token } = await authService.adminLogin("admin@example.com", PASSWORD);

    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].action, "admin_login");
    assert.equal(auditRows[0].detail, "Admin Juan — Signed in to the admin portal");
    const written = JSON.stringify(auditRows);
    assert.ok(!written.includes(PASSWORD) && !written.includes(token) && !written.includes(passwordHash));
});

test("a failed admin sign-in is not recorded (out of scope for now)", async () => {
    stubAudit();
    stub(prisma.user, "findFirst", async () => null);

    await assert.rejects(authService.adminLogin("nobody@example.com", PASSWORD));
    assert.equal(auditRows.length, 0);
});

// --- admin profile and password ---------------------------------------------

test("an admin's name change is recorded, in the same transaction", async () => {
    stubAudit();
    stub(prisma.user, "findUnique", async (args) =>
        args?.select?.role ? { email: "admin@example.com", name: "Juan", role: "admin" } : { name: "Admin Juan" },
    );
    stub(prisma.user, "update", async (args) => ({ id: "admin-1", email: "admin@example.com", mobile: null, ...args.data }));

    await userService.updateProfile("admin-1", { name: "Juan D." });

    assert.equal(transactions, 1);
    assert.equal(auditRows[0].action, "admin_profile_updated");
    assert.equal(auditRows[0].detail, 'Admin Juan — Changed their name from "Juan" to "Juan D."');
});

test("a citizen's profile change is not an admin action", async () => {
    stubAudit();
    stub(prisma.user, "findUnique", async () => ({ email: "juana@example.com", name: "Juana", role: "citizen" }));
    stub(prisma.user, "update", async (args) => ({ id: "u-1", email: "juana@example.com", mobile: null, ...args.data }));

    await userService.updateProfile("u-1", { name: "Juana C." });

    assert.equal(auditRows.length, 0);
});

test("an admin's password change is recorded without the old or new password", async () => {
    stubAudit();
    stub(prisma.user, "findUnique", async (args) => {
        if (args?.select?.password) return { id: "admin-1", password: passwordHash };
        if (args?.select?.role) return { role: "admin" };
        return { name: "Admin Juan" };
    });
    stub(prisma.user, "update", async () => ({ id: "admin-1", tokenVersion: 1 }));

    const { token } = await userService.changePassword("admin-1", { oldPassword: PASSWORD, newPassword: "NewPass1!" });

    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].action, "admin_password_changed");
    assert.equal(auditRows[0].detail, "Admin Juan — Changed their password");
    const written = JSON.stringify(auditRows);
    assert.ok(!written.includes(PASSWORD) && !written.includes("NewPass1!") && !written.includes(token));
});

// --- not losing the trail silently ------------------------------------------

test("a best-effort audit write is retried once before giving up", async () => {
    stubAudit({ failCreate: 1 });
    mock.method(console, "error", () => {});

    await logAdminAction("admin-1", "admin_login", "Signed in to the admin portal");

    assert.equal(auditRows.length, 1);
});

test("an audit write that still fails is reported loudly, naming the action", async () => {
    stubAudit({ failCreate: 2 });
    const errors: string[] = [];
    mock.method(console, "error", (...args: unknown[]) => errors.push(args.map(String).join(" ")));

    await logAdminAction("admin-1", "sos_alert_closed", "Resolved the SOS alert at Day-as, Cordova", "sos-1");

    assert.equal(auditRows.length, 0);
    assert.ok(errors.some((line) => line.includes("sos_alert_closed") && line.includes("sos-1")));
});
