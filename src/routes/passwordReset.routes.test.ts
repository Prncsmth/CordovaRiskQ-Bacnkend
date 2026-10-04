// Route-level checks against the real Express app. Only invalid-email
// requests are sent, so validation rejects every one before any database or
// email work -- the rate limiter runs first and still counts them.
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

test("POST /api/auth/forgot-password and /api/auth/reset-password exist and validate input", async () => {
    const forgot = await post("/api/auth/forgot-password", { email: "not-an-email" });
    assert.equal(forgot.status, 400);

    const reset = await post("/api/auth/reset-password", { email: "not-an-email", code: "123456", newPassword: "NewPass1!" });
    assert.equal(reset.status, 400);
});

test("forgot-password is rate limited per IP (5 requests per 5 minutes)", async () => {
    // One request was already used by the previous test.
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
        statuses.push((await post("/api/auth/forgot-password", { email: "not-an-email" })).status);
    }
    assert.deepEqual(statuses.slice(0, 4), [400, 400, 400, 400]);
    assert.equal(statuses[4], 429, "the 6th request in the window is rejected");
});

test("reset-password is rate limited per IP (10 attempts per 5 minutes)", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
        statuses.push(
            (await post("/api/auth/reset-password", { email: "not-an-email", code: "123456", newPassword: "NewPass1!" })).status,
        );
    }
    // One reset request was already used by the first test.
    assert.ok(statuses.slice(0, 9).every((s) => s === 400));
    assert.equal(statuses[9], 429, "the 11th attempt in the window is rejected");
});
