import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import app from "@/app";

// The real app, so this covers the actual route table: the old debug
// GET /test is gone, while the health check (used to see the service is up)
// stays reachable under both the /api prefix and the root.
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

test("the debug /test route is no longer served", async () => {
    assert.equal((await fetch(`${baseUrl}/test`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/test`)).status, 404);
});

test("the health check still answers", async () => {
    for (const path of ["/health", "/api/health"]) {
        const res = await fetch(`${baseUrl}${path}`);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { status: "ok" });
    }
});
