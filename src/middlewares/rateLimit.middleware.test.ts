// Report rate limiting: 5 per 10 minutes, counted per signed-in account.
// Runs the real limiters in a tiny Express app whose stand-in for
// authenticate sets req.userId from a test header -- no database or JWT
// needed. Also checks the real routes are wired as intended.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express, { type NextFunction, type Response, type Router } from "express";

import type { AuthenticatedRequest } from "@/middlewares/authenticate.middleware";
import {
    loginLimiter,
    REPORT_LIMIT,
    reportLimiter,
    requestOtpLimiter,
    verifyOtpLimiter,
} from "@/middlewares/rateLimit.middleware";
import authRoutes from "@/routes/auth.routes";
import incidentRoutes from "@/routes/incident.routes";
import sosRoutes from "@/routes/sos.routes";
import { authenticate } from "@/middlewares/authenticate.middleware";

let server: http.Server;
let baseUrl = "";

before(async () => {
    const app = express();
    const fakeAuthenticate = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
        req.userId = req.header("x-test-user") ?? undefined;
        next();
    };
    app.post("/report", fakeAuthenticate, reportLimiter, (_req, res) => {
        res.status(201).json({ success: true });
    });
    app.post("/login", loginLimiter, (_req, res) => {
        res.status(200).json({ success: true });
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

const report = (userId: string) =>
    fetch(`${baseUrl}/report`, { method: "POST", headers: { "x-test-user": userId } });

test("the report limit is 5 per 10 minutes", () => {
    assert.deepEqual(REPORT_LIMIT, { windowMs: 10 * 60 * 1000, max: 5 });
});

test("reports below the limit succeed, and the 6th within the window is refused", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await report("u-juana")).status);
    assert.deepEqual(statuses, [201, 201, 201, 201, 201]);

    const sixth = await report("u-juana");
    assert.equal(sixth.status, 429);
    const body = (await sixth.json()) as { success: boolean; message: string };
    assert.equal(body.success, false);
    assert.match(body.message, /wait a few minutes/);
});

test("another user is not affected by the first user's limit, even from the same IP", async () => {
    // u-juana is already over her limit (previous test); every request here
    // comes from the same 127.0.0.1.
    assert.equal((await report("u-juana")).status, 429);
    assert.equal((await report("u-pedro")).status, 201);
});

test("the existing login limit is unchanged: 5 per minute per IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
        statuses.push((await fetch(`${baseUrl}/login`, { method: "POST" })).status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
});

// --- wiring of the real routes --------------------------------------------

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] } };

function handlersOf(router: Router, method: string, path: string): unknown[] {
    const layer = (router.stack as unknown as Layer[]).find(
        (l) => l.route?.path === path && l.route.methods[method]
    );
    assert.ok(layer?.route, `${method.toUpperCase()} ${path} exists`);
    return layer.route.stack.map((s) => s.handle);
}

test("POST /incidents runs the report limiter right after authenticate", () => {
    const handlers = handlersOf(incidentRoutes, "post", "/incidents");
    assert.equal(handlers[0], authenticate);
    assert.equal(handlers[1], reportLimiter);
});

test("SOS is never rate limited -- it stays deduplicated instead", () => {
    assert.ok(!handlersOf(sosRoutes, "post", "/sos").includes(reportLimiter));
});

test("login and OTP routes keep their existing limiters", () => {
    assert.equal(handlersOf(authRoutes, "post", "/auth/login")[0], loginLimiter);
    assert.equal(handlersOf(authRoutes, "post", "/auth/google")[0], loginLimiter);
    assert.equal(handlersOf(authRoutes, "post", "/auth/register/request-otp")[0], requestOtpLimiter);
    assert.equal(handlersOf(authRoutes, "post", "/auth/forgot-password")[0], requestOtpLimiter);
    assert.equal(handlersOf(authRoutes, "post", "/auth/register/verify-otp")[0], verifyOtpLimiter);
    assert.equal(handlersOf(authRoutes, "post", "/auth/reset-password")[0], verifyOtpLimiter);
});
