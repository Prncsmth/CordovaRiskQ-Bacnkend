import assert from "node:assert/strict";
import { test } from "node:test";

import {
    classifyCloudinaryError,
    cloudinaryPublicId,
    isAllowedIncidentPhotoType,
    isOwnCloudinaryUrl,
} from "@/services/incidentPhoto";
import { createIncidentSchema } from "@/validations/incident.validation";

const FOLDER = "cordova-riskq/incidents";
const own = (path: string) => `https://res.cloudinary.com/riskq/image/upload/${path}`;

test("accepts this app's own uploaded incident photos", () => {
    assert.equal(isOwnCloudinaryUrl(own(`v1712345678/${FOLDER}/abc123.jpg`), "riskq", FOLDER), true);
    assert.equal(isOwnCloudinaryUrl(own(`${FOLDER}/abc123.jpg`), "riskq", FOLDER), true);
});

test("rejects links from anywhere else", () => {
    assert.equal(isOwnCloudinaryUrl("https://evil.example/x.jpg", "riskq", FOLDER), false);
    assert.equal(isOwnCloudinaryUrl("http://res.cloudinary.com/riskq/image/upload/" + FOLDER + "/a.jpg", "riskq", FOLDER), false);
    assert.equal(isOwnCloudinaryUrl(`https://res.cloudinary.com/someone-else/image/upload/${FOLDER}/a.jpg`, "riskq", FOLDER), false);
    assert.equal(isOwnCloudinaryUrl(own("v1/other-folder/a.jpg"), "riskq", FOLDER), false);
    assert.equal(isOwnCloudinaryUrl(own(`${FOLDER}/a.jpg?x=1`), "riskq", FOLDER), false);
    assert.equal(isOwnCloudinaryUrl("not a url", "riskq", FOLDER), false);
});

test("only image types are accepted for upload", () => {
    assert.equal(isAllowedIncidentPhotoType("image/jpeg"), true);
    assert.equal(isAllowedIncidentPhotoType("IMAGE/PNG"), true);
    assert.equal(isAllowedIncidentPhotoType("application/pdf"), false);
    assert.equal(isAllowedIncidentPhotoType("image/svg+xml"), false);
});

test("an untyped upload counts as a photo only by its image file extension", () => {
    assert.equal(isAllowedIncidentPhotoType("application/octet-stream", "abc.jpg"), true);
    assert.equal(isAllowedIncidentPhotoType("", "abc.HEIC"), true);
    assert.equal(isAllowedIncidentPhotoType("application/octet-stream", "evil.exe"), false);
    assert.equal(isAllowedIncidentPhotoType("application/octet-stream", "jpg"), false);
    // A declared non-image type is never rescued by its name.
    assert.equal(isAllowedIncidentPhotoType("text/html", "page.jpg"), false);
});

test("a report may carry an optional photoUrl", () => {
    const base = {
        category: "fire",
        locationLabel: "Buagsong",
        latitude: 10.25,
        longitude: 123.95,
        reporterLatitude: 10.25,
        reporterLongitude: 123.95,
    };
    assert.equal(createIncidentSchema.safeParse(base).success, true);
    assert.equal(createIncidentSchema.safeParse({ ...base, photoUrl: own(`${FOLDER}/a.jpg`) }).success, true);
    assert.equal(createIncidentSchema.safeParse({ ...base, photoUrl: "x".repeat(600) }).success, false);
});

test("finds the public id of one of our photos, for deleting it", () => {
    const avatar = "https://res.cloudinary.com/riskq/image/upload/v1712345678/cordova-riskq/avatars/abc123.jpg";
    assert.equal(cloudinaryPublicId(avatar, "riskq"), "cordova-riskq/avatars/abc123");
    assert.equal(cloudinaryPublicId(avatar, "someone-else"), null);
    assert.equal(cloudinaryPublicId("https://evil.example/riskq/image/upload/a.jpg", "riskq"), null);
    assert.equal(cloudinaryPublicId("nope", "riskq"), null);
});

test("a Cloudinary refusal becomes a clear answer instead of a 500", () => {
    assert.deepEqual(classifyCloudinaryError({ http_code: 400, message: "Invalid image file" }), {
        status: 400,
        message: "That file isn't a photo we can use",
    });
    // e.g. "Invalid Signature" from a wrong API secret.
    assert.equal(classifyCloudinaryError({ http_code: 401, message: "Invalid Signature" })?.status, 503);
    assert.equal(classifyCloudinaryError({ http_code: 403 })?.status, 503);
    assert.equal(classifyCloudinaryError({ http_code: 500 }), null);
    assert.equal(classifyCloudinaryError(new Error("socket hang up")), null);
    assert.equal(classifyCloudinaryError(null), null);
});
