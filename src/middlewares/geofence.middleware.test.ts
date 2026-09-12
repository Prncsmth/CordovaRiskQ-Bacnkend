import assert from "node:assert/strict";
import { test } from "node:test";

import { requireIncidentInsideCordova, requireSosInsideCordova } from "@/middlewares/geofence.middleware";
import { AppError } from "@/utils/AppError";

const INSIDE = { latitude: 10.2515, longitude: 123.9499 }; // Cordova center
const OUTSIDE = { latitude: 10.3103, longitude: 123.9494 }; // Lapu-Lapu City center

function makeNextSpy() {
    const calls: unknown[] = [];
    const next = (arg?: unknown) => calls.push(arg);
    return { next, calls };
}

test("requireIncidentInsideCordova calls next() with no error when both points are inside Cordova", () => {
    const { next, calls } = makeNextSpy();
    const req: any = {
        body: {
            latitude: INSIDE.latitude,
            longitude: INSIDE.longitude,
            reporterLatitude: INSIDE.latitude,
            reporterLongitude: INSIDE.longitude,
        },
    };
    requireIncidentInsideCordova(req, {} as any, next);
    assert.deepEqual(calls, [undefined]);
});

test("requireIncidentInsideCordova blocks when the pin is outside Cordova", () => {
    const { next, calls } = makeNextSpy();
    const req: any = {
        body: {
            latitude: OUTSIDE.latitude,
            longitude: OUTSIDE.longitude,
            reporterLatitude: INSIDE.latitude,
            reporterLongitude: INSIDE.longitude,
        },
    };
    requireIncidentInsideCordova(req, {} as any, next);
    assert.equal(calls.length, 1);
    const err = calls[0] as AppError;
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 403);
    assert.equal(err.message, "Incident reports are only allowed within the Municipality of Cordova, Cebu.");
});

test("requireIncidentInsideCordova blocks when the reporter's GPS is outside Cordova", () => {
    const { next, calls } = makeNextSpy();
    const req: any = {
        body: {
            latitude: INSIDE.latitude,
            longitude: INSIDE.longitude,
            reporterLatitude: OUTSIDE.latitude,
            reporterLongitude: OUTSIDE.longitude,
        },
    };
    requireIncidentInsideCordova(req, {} as any, next);
    const err = calls[0] as AppError;
    assert.equal(err.statusCode, 403);
});

test("requireSosInsideCordova calls next() with no error when inside Cordova", () => {
    const { next, calls } = makeNextSpy();
    const req: any = { body: { latitude: INSIDE.latitude, longitude: INSIDE.longitude } };
    requireSosInsideCordova(req, {} as any, next);
    assert.deepEqual(calls, [undefined]);
});

test("requireSosInsideCordova blocks when outside Cordova", () => {
    const { next, calls } = makeNextSpy();
    const req: any = { body: { latitude: OUTSIDE.latitude, longitude: OUTSIDE.longitude } };
    requireSosInsideCordova(req, {} as any, next);
    assert.equal(calls.length, 1);
    const err = calls[0] as AppError;
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 403);
    assert.equal(err.message, "SOS is only available within the Municipality of Cordova, Cebu.");
});
