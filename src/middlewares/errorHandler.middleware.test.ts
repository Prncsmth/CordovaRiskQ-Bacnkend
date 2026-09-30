import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { NextFunction, Request, Response } from "express";

import { errorHandler } from "@/middlewares/errorHandler.middleware";
import { AppError } from "@/utils/AppError";

function run(err: unknown) {
    const captured: { status?: number; body?: unknown } = {};
    const res = {
        status(code: number) {
            captured.status = code;
            return this;
        },
        json(body: unknown) {
            captured.body = body;
            return this;
        },
    } as unknown as Response;
    errorHandler(err as Error, {} as Request, res, (() => {}) as NextFunction);
    return captured;
}

// Shaped like the error express.json() (body-parser) raises for a malformed
// body -- e.g. the '{\' a mis-quoted curl in PowerShell sends.
function bodyParserError(type: string, status: number, body = '{\\') {
    return Object.assign(new SyntaxError("Expected property name or '}' in JSON at position 1"), {
        type,
        status,
        statusCode: status,
        expose: true,
        body,
    });
}

function silenceConsole(t: TestContext) {
    return t.mock.method(console, "error", () => {});
}

test("malformed JSON in the request body is a 400, not a 500", (t) => {
    const log = silenceConsole(t);

    const { status, body } = run(bodyParserError("entity.parse.failed", 400));

    assert.equal(status, 400);
    assert.deepEqual(body, { success: false, message: "Invalid JSON in request body" });
    assert.equal(log.mock.callCount(), 0, "a client mistake is not an unexpected server error");
});

test("the raw request body is never echoed back", (t) => {
    silenceConsole(t);
    const { body } = run(bodyParserError("entity.parse.failed", 400, '{"password":"hunter2'));
    assert.ok(!JSON.stringify(body).includes("hunter2"));
});

test("an oversized request body is a 413", (t) => {
    silenceConsole(t);
    const { status, body } = run(bodyParserError("entity.too.large", 413, ""));
    assert.equal(status, 413);
    assert.deepEqual(body, { success: false, message: "Request body is too large" });
});

test("AppError keeps its status and message", (t) => {
    const log = silenceConsole(t);
    const { status, body } = run(new AppError("Invalid email or password", 401));
    assert.equal(status, 401);
    assert.deepEqual(body, { success: false, message: "Invalid email or password" });
    assert.equal(log.mock.callCount(), 0);
});

test("unexpected errors stay a logged 500 with a generic message", (t) => {
    const log = silenceConsole(t);
    const { status, body } = run(new Error("database exploded"));
    assert.equal(status, 500);
    assert.deepEqual(body, { success: false, message: "Internal server error" });
    assert.equal(log.mock.callCount(), 1);
});

test("a non-exposed error that merely carries a 4xx status is still treated as a 500", (t) => {
    // Only errors explicitly marked safe to expose (http-errors' expose flag)
    // are passed through as client errors.
    silenceConsole(t);
    const sneaky = Object.assign(new Error("internal detail"), { status: 400, expose: false });
    const { status, body } = run(sneaky);
    assert.equal(status, 500);
    assert.deepEqual(body, { success: false, message: "Internal server error" });
});
