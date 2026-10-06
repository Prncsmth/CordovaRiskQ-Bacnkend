import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Router } from "express";

import {
    LOGIN_EMAIL_LIMIT,
    loginEmailKey,
    loginEmailLimiter,
    loginLimiter,
} from "@/middlewares/rateLimit.middleware";
import authRoutes from "@/routes/auth.routes";

// A login endpoint wired exactly like the real one (IP limiter, then the
// per-email limiter), with a stand-in handler: "Right-Passw0rd!" logs in,
// anything else gets the real generic 401 -- for a registered email or not.
const REGISTERED = new Set(["victim@example.com", "owner@example.com"]);
const GENERIC_401 = { success: false, message: "Invalid email or password" };

let server: http.Server;
let baseUrl = "";
let ipCounter = 0;
// A fresh client IP per request unless one is given, so the 5/minute IP
// limiter only comes into play in the test that's about it.
const nextIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;

before(async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.post("/login", loginLimiter, loginEmailLimiter, (req, res) => {
        const email = String(req.body.email ?? "").trim().toLowerCase();
        if (REGISTERED.has(email) && req.body.password === "Right-Passw0rd!") {
            res.status(200).json({ success: true, token: "t" });
            return;
        }
        res.status(401).json(GENERIC_401);
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

function login(email: unknown, password: string, ip: string = nextIp()) {
    return fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ email, password }),
    });
}

async function failNTimes(email: string, n: number) {
    for (let i = 0; i < n; i++) {
        assert.equal((await login(email, "wrong")).status, 401);
    }
}

test("the per-email limit is 10 failed attempts per 15 minutes", () => {
    assert.deepEqual(LOGIN_EMAIL_LIMIT, { windowMs: 15 * 60 * 1000, max: 10 });
});

test("the same email is blocked after 10 failures even when every guess comes from a different IP", async () => {
    await failNTimes("victim@example.com", LOGIN_EMAIL_LIMIT.max);
    const blocked = await login("victim@example.com", "wrong");
    assert.equal(blocked.status, 429);
    const body = (await blocked.json()) as { success: boolean; message: string };
    assert.equal(body.success, false);
    assert.match(body.message, /Too many failed login attempts/);
});

test("the email is normalized, so case and spaces don't open a new bucket", async () => {
    assert.equal((await login("  VICTIM@Example.com ", "wrong")).status, 429);
});

test("a different email has its own bucket", async () => {
    assert.equal((await login("someone-else@example.com", "wrong")).status, 401);
});

test("successful logins are not counted toward the per-email limit", async () => {
    for (let i = 0; i < LOGIN_EMAIL_LIMIT.max + 3; i++) {
        assert.equal((await login("owner@example.com", "Right-Passw0rd!")).status, 200);
    }
});

test("a locked-out registered email and a locked-out unknown email get the identical response", async () => {
    await failNTimes("nobody@example.com", LOGIN_EMAIL_LIMIT.max);
    const unknown = await login("nobody@example.com", "wrong");
    const registered = await login("victim@example.com", "wrong");
    assert.equal(unknown.status, 429);
    assert.equal(registered.status, 429);
    assert.deepEqual(await unknown.json(), await registered.json());
});

test("before the limit, a registered and an unknown email both get the same generic 401", async () => {
    const registered = await login("owner@example.com", "wrong");
    const unknown = await login("ghost@example.com", "wrong");
    assert.equal(registered.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(await registered.json(), GENERIC_401);
    assert.deepEqual(await unknown.json(), GENERIC_401);
});

test("the existing IP limit still applies: 5 per minute from one IP, across different emails", async () => {
    const ip = "198.51.100.7";
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
        statuses.push((await login(`spray${i}@example.com`, "wrong", ip)).status);
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
});

test("the limiter key is a hash -- the raw email never reaches limiter state", () => {
    const key = loginEmailKey({ body: { email: " Victim@Example.com " }, ip: "1.2.3.4" } as never);
    assert.match(key, /^email:[0-9a-f]{64}$/);
    assert.ok(!key.toLowerCase().includes("victim"));
    assert.equal(key, loginEmailKey({ body: { email: "victim@example.com" }, ip: "5.6.7.8" } as never));
});

test("a missing or non-string email falls back to the IP, not one shared bucket", () => {
    assert.match(loginEmailKey({ body: {}, ip: "1.2.3.4" } as never), /^ip:/);
    assert.match(loginEmailKey({ body: { email: 42 }, ip: "1.2.3.4" } as never), /^ip:/);
});

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] } };
function handlersOf(router: Router, method: string, path: string): unknown[] {
    const layer = (router.stack as unknown as Layer[]).find(
        (l) => l.route?.path === path && l.route.methods[method]
    );
    assert.ok(layer?.route, `${method.toUpperCase()} ${path} exists`);
    return layer.route.stack.map((s) => s.handle);
}

test("POST /auth/login runs the IP limiter, then the per-email limiter", () => {
    const handlers = handlersOf(authRoutes, "post", "/auth/login");
    assert.equal(handlers[0], loginLimiter);
    assert.equal(handlers[1], loginEmailLimiter);
});

test("Google sign-in keeps the IP limiter only (its body has no email)", () => {
    const handlers = handlersOf(authRoutes, "post", "/auth/google");
    assert.equal(handlers[0], loginLimiter);
    assert.ok(!handlers.includes(loginEmailLimiter));
});
