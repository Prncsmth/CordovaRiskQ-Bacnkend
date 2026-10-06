// Route-level checks against the real Express app. Only invalid-email
// requests are sent, so validation rejects every one before any database
// work -- the rate limiter runs first and still counts them.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import app from "@/app";

let server: http.Server;
let baseUrl = "";

before(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

function post(path: string, body: unknown) {
    return fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

test("POST /api/admin/auth/login exists, is public, and validates input", async () => {
    const res = await post("/api/admin/auth/login", { email: "not-an-email", password: "x" });
    assert.equal(res.status, 400);
});

test("admin login is rate limited per IP (5 attempts per minute)", async () => {
    // One attempt was already used by the previous test.
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
        statuses.push((await post("/api/admin/auth/login", { email: "not-an-email", password: "x" })).status);
    }
    assert.deepEqual(statuses.slice(0, 4), [400, 400, 400, 400]);
    assert.equal(statuses[4], 429, "the 6th attempt in the window is rejected");
});
