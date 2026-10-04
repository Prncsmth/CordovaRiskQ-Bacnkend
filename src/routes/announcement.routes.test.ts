// Route-level check against the real Express app. Only token-less requests
// are sent, so authenticate rejects them before any database work.
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

test("the responder announcement endpoint requires a login, so Responders Only stays private", async () => {
    const response = await fetch(`${baseUrl}/api/announcements/active/responder`);
    // 401 from authenticate -- also proves the route isn't swallowed by the
    // public /announcements/:id route, which takes no token.
    assert.equal(response.status, 401);
});

test("a malformed token on the responder endpoint is rejected before any database work", async () => {
    const response = await fetch(`${baseUrl}/api/announcements/active/responder`, {
        headers: { Authorization: "Bearer not-a-real-token" },
    });
    assert.equal(response.status, 401);
});
