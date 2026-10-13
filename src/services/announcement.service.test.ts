// Service-level checks for the announcement current/delete fix, with the
// Prisma delegates stubbed (no database) -- same pattern as
// auth.service.test.ts. getActive/getActiveForResponder/getById/listForAdmin
// only ever touch prisma.announcement, so stubbing just that delegate fully
// isolates them. remove() also cascades into logAdminAction (prisma.user.
// findUnique + prisma.adminAuditLog.create), so those are stubbed too --
// without that, an unstubbed call would hit the real configured database.
// emitAnnouncementDeleted is not stubbed: it no-ops safely on its own,
// since realtime/socket.ts's initRealtime (the only thing that ever calls
// setIo) never runs in this test process, so its module-level ioInstance
// stays null.
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { announcementService } from "@/services/announcement.service";

type AnnouncementDelegate = "findFirst" | "findUnique" | "update" | "count" | "findMany";
type UserDelegate = "findUnique";
type AuditLogDelegate = "create";

const announcementDelegate = prisma.announcement as unknown as Record<AnnouncementDelegate, unknown>;
const userDelegate = prisma.user as unknown as Record<UserDelegate, unknown>;
const auditLogDelegate = prisma.adminAuditLog as unknown as Record<AuditLogDelegate, unknown>;

const originals = new Map<object, Map<string, unknown>>();
const calls: Record<string, number> = {};

function stub(target: Record<string, unknown>, name: string, impl: (args?: any) => Promise<unknown>) {
    if (!originals.has(target)) originals.set(target, new Map());
    const perTarget = originals.get(target)!;
    if (!perTarget.has(name)) perTarget.set(name, target[name]);
    calls[name] = 0;
    target[name] = async (args?: unknown) => {
        calls[name]++;
        return impl(args);
    };
}

afterEach(() => {
    mock.restoreAll();
    for (const [target, perTarget] of originals) {
        for (const [name, original] of perTarget) {
            (target as Record<string, unknown>)[name] = original;
        }
    }
    originals.clear();
    for (const k of Object.keys(calls)) delete calls[k];
});

function makeRow(overrides: Record<string, unknown> = {}) {
    return {
        id: "row-1",
        title: "HAZE ALERT!",
        content: "Stay indoors.",
        priority: "Critical",
        audience: "All Users",
        barangayName: null,
        createdByUserId: "admin-1",
        createdAt: new Date("2026-10-13T12:00:00Z"),
        updatedAt: new Date("2026-10-13T12:00:00Z"),
        deletedAt: null,
        ...overrides,
    };
}

// --- getActive ---------------------------------------------------------

test("getActive: the newest row, undeleted, is returned as current", async () => {
    const row = makeRow();
    stub(announcementDelegate, "findFirst", async () => row);
    const result = await announcementService.getActive();
    assert.equal(result?.id, "row-1");
});

test("getActive: the newest row, deleted, yields no current announcement -- the regression this fixes", async () => {
    stub(announcementDelegate, "findFirst", async () => makeRow({ deletedAt: new Date() }));
    const result = await announcementService.getActive();
    assert.equal(result, null);
});

test("getActive: an older announcement is never promoted -- the query is only ever asked for the single newest row", async () => {
    let capturedArgs: any;
    // The stub stands in for Postgres: findFirst with orderBy createdAt
    // desc only ever returns one row, the newest one, whatever its
    // deletedAt is -- there is no "second call for the older row" for a
    // regression to sneak back in through.
    stub(announcementDelegate, "findFirst", async (args) => {
        capturedArgs = args;
        return makeRow({ id: "newest", deletedAt: new Date() });
    });
    const result = await announcementService.getActive();
    assert.equal(result, null);
    assert.equal(capturedArgs.orderBy.createdAt, "desc");
    assert.equal(calls.findFirst, 1, "exactly one query -- no fallback lookup for an older row");
});

test("getActive: barangayName is still passed through to the audience filter", async () => {
    let capturedArgs: any;
    stub(announcementDelegate, "findFirst", async (args) => {
        capturedArgs = args;
        return null;
    });
    await announcementService.getActive("Poblacion");
    const barangayCondition = capturedArgs.where.OR.find((c: any) => c.audience === "Specific Barangay");
    assert.equal(barangayCondition.barangayName.equals, "Poblacion");
});

// --- getActiveForResponder ----------------------------------------------

test("getActiveForResponder: same never-fall-back rule applies", async () => {
    stub(announcementDelegate, "findFirst", async () => makeRow({ deletedAt: new Date() }));
    const result = await announcementService.getActiveForResponder();
    assert.equal(result, null);
});

test("getActiveForResponder: includes Responders Only in the audience filter", async () => {
    let capturedArgs: any;
    stub(announcementDelegate, "findFirst", async (args) => {
        capturedArgs = args;
        return null;
    });
    await announcementService.getActiveForResponder();
    assert.ok(capturedArgs.where.OR.some((c: any) => c.audience === "Responders Only"));
});

// --- getById -------------------------------------------------------------

test("getById: a soft-deleted announcement is not found, same as a nonexistent id", async () => {
    // The query itself filters deletedAt: null, so a deleted row's id comes
    // back as "not found" from the database's own perspective, not a
    // client-side check after the fact.
    stub(announcementDelegate, "findFirst", async (args) => {
        assert.equal(args.where.deletedAt, null);
        return null;
    });
    await assert.rejects(
        () => announcementService.getById("row-1", null),
        (err: unknown) => err instanceof AppError && err.statusCode === 404,
    );
});

test("getById: a live announcement is still returned normally", async () => {
    stub(announcementDelegate, "findFirst", async () => ({
        ...makeRow(),
        createdBy: { name: "Admin" },
    }));
    const result = await announcementService.getById("row-1", null);
    assert.equal(result.id, "row-1");
});

// --- listForAdmin ----------------------------------------------------------

test("listForAdmin: excludes deleted rows while still returning other announcements", async () => {
    let capturedWhere: any;
    stub(announcementDelegate, "count", async (args) => {
        capturedWhere = args.where;
        return 2;
    });
    stub(announcementDelegate, "findMany", async () => [
        makeRow({ id: "a", title: "Important Announcement" }),
        makeRow({ id: "b", title: "adadasdad" }),
    ]);
    const result = await announcementService.listForAdmin({});
    assert.equal(capturedWhere.deletedAt, null);
    assert.equal(result.announcements.length, 2);
    assert.deepEqual(
        result.announcements.map((a) => a.id),
        ["a", "b"],
    );
});

// --- remove ----------------------------------------------------------------

function stubLogAdminActionDeps() {
    stub(userDelegate, "findUnique", async () => ({ name: "Admin One" }));
    stub(auditLogDelegate, "create", async () => ({}));
}

test("remove: soft-deletes (update), not a real delete -- the row must still exist for getActive to see it was this one", async () => {
    stubLogAdminActionDeps();
    stub(announcementDelegate, "findUnique", async () => makeRow());
    let capturedUpdateArgs: any;
    stub(announcementDelegate, "update", async (args) => {
        capturedUpdateArgs = args;
        return makeRow({ deletedAt: new Date() });
    });

    await announcementService.remove("row-1", "admin-1");

    assert.equal(calls.update, 1);
    assert.equal(capturedUpdateArgs.where.id, "row-1");
    assert.ok(capturedUpdateArgs.data.deletedAt instanceof Date);
});

test("remove: a nonexistent id is a real 404", async () => {
    stub(announcementDelegate, "findUnique", async () => null);
    await assert.rejects(
        () => announcementService.remove("missing-id", "admin-1"),
        (err: unknown) => err instanceof AppError && err.statusCode === 404,
    );
});

test("remove: repeated deletion of the same (already-deleted) row is a safe no-op, not a second write or a 404", async () => {
    stubLogAdminActionDeps();
    stub(announcementDelegate, "findUnique", async () => makeRow({ deletedAt: new Date("2026-10-13T12:05:00Z") }));
    stub(announcementDelegate, "update", async () => {
        throw new Error("must not be called for an already-deleted row");
    });

    await announcementService.remove("row-1", "admin-1");

    assert.equal(calls.update ?? 0, 0, "no second write for an already-deleted row");
});

test("remove: deleting one announcement does not touch any other record's id", async () => {
    stubLogAdminActionDeps();
    stub(announcementDelegate, "findUnique", async () => makeRow({ id: "row-1" }));
    let capturedUpdateArgs: any;
    stub(announcementDelegate, "update", async (args) => {
        capturedUpdateArgs = args;
        return makeRow({ id: "row-1", deletedAt: new Date() });
    });

    await announcementService.remove("row-1", "admin-1");

    assert.deepEqual(capturedUpdateArgs.where, { id: "row-1" });
});
