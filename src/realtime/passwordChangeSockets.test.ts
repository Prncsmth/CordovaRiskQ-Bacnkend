// A password change/reset drops that user's open sockets, and only theirs.
// Runs the real reset/change-password flows with the real
// disconnectUserSockets against a small in-memory stand-in for the Socket.IO
// server: it tracks which rooms each socket is in (every socket joins
// user:<id> on connect, as realtime/socket.ts does) and implements the one
// call disconnectUserSockets makes, io.in(room).disconnectSockets().
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Server } from "socket.io";

import { disconnectUserSockets, setIo } from "@/realtime/emit";
import { changePassword, type ChangePasswordDeps } from "@/services/changePasswordFlow";
import { DEFAULT_OTP_CONFIG } from "@/services/pendingRegistrationFlow";
import {
    requestPasswordReset,
    resetPassword,
    type PasswordResetDeps,
    type PasswordResetRow,
} from "@/services/passwordResetFlow";

type FakeSocket = { id: string; rooms: Set<string>; connected: boolean };

function createFakeIo() {
    const sockets: FakeSocket[] = [];
    const connect = (id: string, userId: string, extraRooms: string[] = []) => {
        const socket = { id, rooms: new Set([`user:${userId}`, ...extraRooms]), connected: true };
        sockets.push(socket);
        return socket;
    };
    const io = {
        in(room: string) {
            return {
                disconnectSockets(_close?: boolean) {
                    for (const s of sockets) {
                        if (s.connected && s.rooms.has(room)) s.connected = false;
                    }
                },
            };
        },
    };
    setIo(io as unknown as Server);
    return { connect };
}

type User = { id: string; email: string; password: string | null; tokenVersion: number };

function createUsers() {
    return new Map<string, User>([
        ["u-juana", { id: "u-juana", email: "juana@example.com", password: "hashed:OldPass1!", tokenVersion: 0 }],
        ["u-pedro", { id: "u-pedro", email: "pedro@example.com", password: "hashed:Pedro1!x", tokenVersion: 0 }],
    ]);
}

const hash = async (value: string) => `hashed:${value}`;
const compareHash = async (value: string, stored: string) => `hashed:${value}` === stored;

function resetDeps(users: Map<string, User>, sentCodes: string[]): PasswordResetDeps {
    const rows = new Map<string, PasswordResetRow>();
    return {
        resetStore: {
            findByEmail: async (email) => rows.get(email) ?? null,
            upsert: async (row) => {
                rows.set(row.email, { ...row });
            },
            incrementAttempts: async (email) => {
                const row = rows.get(email);
                if (row) row.attempts += 1;
            },
            consume: async (email) => rows.delete(email),
        },
        userStore: {
            findByEmail: async (email) => {
                const user = [...users.values()].find((u) => u.email === email);
                return user ? { id: user.id, hasPassword: user.password !== null } : null;
            },
            updatePassword: async (userId, passwordHash) => {
                const user = users.get(userId)!;
                user.password = passwordHash;
                user.tokenVersion += 1;
            },
        },
        hash,
        compareHash,
        sendResetEmail: async (_to, code) => {
            sentCodes.push(code);
        },
        onPasswordChanged: disconnectUserSockets, // the production wiring
        now: () => new Date("2026-10-04T03:00:00.000Z"),
        config: DEFAULT_OTP_CONFIG,
    };
}

function changePasswordDeps(users: Map<string, User>): ChangePasswordDeps {
    return {
        findUser: async (id) => users.get(id) ?? null,
        compareHash,
        hash,
        savePasswordAndRevokeSessions: async (id, passwordHash) => {
            const user = users.get(id)!;
            user.password = passwordHash;
            user.tokenVersion += 1;
            return { id, tokenVersion: user.tokenVersion };
        },
        issueToken: (user) => `token-for-${user.id}-v${user.tokenVersion}`,
        onPasswordChanged: disconnectUserSockets, // the production wiring
    };
}

function captureConsoleError(t: TestContext) {
    const lines: string[] = [];
    t.mock.method(console, "error", (...args: unknown[]) => {
        lines.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
    });
    return lines;
}

test("a password reset disconnects every existing socket of that user", async () => {
    const { connect } = createFakeIo();
    const phone = connect("juana-phone", "u-juana");
    const tablet = connect("juana-tablet", "u-juana", ["incident:i-1"]);
    const users = createUsers();
    const codes: string[] = [];
    const deps = resetDeps(users, codes);

    await requestPasswordReset({ email: "juana@example.com" }, deps);
    assert.equal(phone.connected && tablet.connected, true, "requesting a code alone disconnects nothing");

    await resetPassword({ email: "juana@example.com", code: codes[0], newPassword: "NewPass1!" }, deps);

    assert.equal(phone.connected, false);
    assert.equal(tablet.connected, false, "also dropped from rooms it joined, e.g. an incident");
    assert.equal(users.get("u-juana")!.tokenVersion, 1, "tokenVersion revocation still happens");
});

test("a change password disconnects that user's sockets, and returns this device's fresh token", async () => {
    const { connect } = createFakeIo();
    const otherDevice = connect("juana-old-phone", "u-juana");
    const thisDevice = connect("juana-this-phone", "u-juana");
    const users = createUsers();

    const { token } = await changePassword(
        "u-juana",
        { oldPassword: "OldPass1!", newPassword: "NewPass1!" },
        changePasswordDeps(users)
    );

    assert.equal(otherDevice.connected, false);
    assert.equal(thisDevice.connected, false, "this device's old socket too -- it reconnects with the new token");
    assert.equal(token, "token-for-u-juana-v1", "the fresh token carries the bumped version");
});

test("another user's sockets stay connected, even in a room they share", async () => {
    const { connect } = createFakeIo();
    const juana = connect("juana-phone", "u-juana", ["incident:i-1"]);
    const pedroOnSameIncident = connect("pedro-phone", "u-pedro", ["incident:i-1"]);
    const pedroAdminTab = connect("pedro-admin", "u-pedro", ["admin"]);
    const users = createUsers();
    const codes: string[] = [];
    const deps = resetDeps(users, codes);

    await requestPasswordReset({ email: "juana@example.com" }, deps);
    await resetPassword({ email: "juana@example.com", code: codes[0], newPassword: "NewPass1!" }, deps);
    await changePassword("u-juana", { oldPassword: "NewPass1!", newPassword: "Newer1!xy" }, changePasswordDeps(users));

    assert.equal(juana.connected, false);
    assert.equal(pedroOnSameIncident.connected, true);
    assert.equal(pedroAdminTab.connected, true);
    assert.equal(users.get("u-pedro")!.tokenVersion, 0, "and their sessions aren't revoked either");
});

test("a failed reset or change password disconnects nobody", async () => {
    const { connect } = createFakeIo();
    const juana = connect("juana-phone", "u-juana");
    const users = createUsers();
    const codes: string[] = [];
    const deps = resetDeps(users, codes);

    await requestPasswordReset({ email: "juana@example.com" }, deps);
    const wrongCode = codes[0] === "000000" ? "111111" : "000000";
    await assert.rejects(resetPassword({ email: "juana@example.com", code: wrongCode, newPassword: "NewPass1!" }, deps));
    await assert.rejects(
        changePassword("u-juana", { oldPassword: "WrongPass1!", newPassword: "NewPass1!" }, changePasswordDeps(users))
    );

    assert.equal(juana.connected, true);
    assert.equal(users.get("u-juana")!.tokenVersion, 0);
});

test("with no Socket.IO server running, password operations still succeed", async () => {
    setIo(null);
    const users = createUsers();
    const codes: string[] = [];
    const deps = resetDeps(users, codes);

    assert.doesNotThrow(() => disconnectUserSockets("u-juana"));

    await requestPasswordReset({ email: "juana@example.com" }, deps);
    await resetPassword({ email: "juana@example.com", code: codes[0], newPassword: "NewPass1!" }, deps);
    const { token } = await changePassword(
        "u-juana",
        { oldPassword: "NewPass1!", newPassword: "Newer1!xy" },
        changePasswordDeps(users)
    );

    assert.equal(users.get("u-juana")!.tokenVersion, 2);
    assert.equal(token, "token-for-u-juana-v2");
});

test("a Socket.IO failure is logged without the user id and never fails the password change", async (t) => {
    const lines = captureConsoleError(t);
    setIo({
        in() {
            throw new Error("adapter unavailable");
        },
    } as unknown as Server);
    const users = createUsers();

    const { token } = await changePassword(
        "u-juana",
        { oldPassword: "OldPass1!", newPassword: "NewPass1!" },
        changePasswordDeps(users)
    );

    assert.equal(token, "token-for-u-juana-v1");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /Failed to disconnect sockets after a password change/);
    assert.ok(!lines[0].includes("u-juana"), "the log line never names the user");
    setIo(null);
});
