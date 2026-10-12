import assert from "node:assert/strict";
import { test } from "node:test";

import { cloudinaryPublicId, isAllowedIncidentPhotoType, isOwnCloudinaryUrl } from "@/services/incidentPhoto";
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
