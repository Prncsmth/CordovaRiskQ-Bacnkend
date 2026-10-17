import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import app from "@/app";

// The real app and route table. Every request here is answered before the
// database is touched (validation errors, the honeypot, missing auth), so no
// database is needed. Kept to 3 POSTs: the public review limiter allows 3/hour.
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

const post = (body: unknown) =>
    fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

test("a rating outside 1-5 is rejected", async () => {
    const res = await post({ rating: 6, comment: "Very helpful app" });
    assert.equal(res.status, 400);
});

test("an empty comment is rejected", async () => {
    const res = await post({ rating: 5, comment: "  " });
    assert.equal(res.status, 400);
});

test("a bot that fills the hidden field gets a normal success and nothing is stored", async () => {
    const res = await post({ rating: 5, comment: "Great app!", website: "http://spam.example" });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { success?: boolean; review?: unknown };
    assert.equal(body.success, true);
    assert.equal(body.review, undefined);
});

test("the admin review list needs a signed-in admin", async () => {
    assert.equal((await fetch(`${baseUrl}/api/admin/reviews`)).status, 401);
    const patch = await fetch(`${baseUrl}/api/admin/reviews/x/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
    });
    assert.equal(patch.status, 401);
});
