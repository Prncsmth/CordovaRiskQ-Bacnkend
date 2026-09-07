import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "@/utils/AppError";

test("AppError defaults to a 500 status code", () => {
    const err = new AppError("boom");
    assert.equal(err.statusCode, 500);
    assert.equal(err.isOperational, true);
    assert.equal(err.message, "boom");
});

test("AppError accepts an explicit status code", () => {
    const err = new AppError("not found", 404);
    assert.equal(err.statusCode, 404);
});
