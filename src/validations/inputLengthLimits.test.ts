import assert from "node:assert/strict";
import { test } from "node:test";

import { createAnnouncementSchema, updateAnnouncementSchema } from "@/validations/announcement.validation";
import { createIncidentSchema } from "@/validations/incident.validation";
import { triggerSosSchema } from "@/validations/sos.validation";
import { updateProfileSchema } from "@/validations/user.validation";

const chars = (n: number) => "a".repeat(n);

const CORDOVA = { latitude: 10.2515, longitude: 123.9499 };
const validReport = {
    category: "flood" as const,
    details: "Flooding on the road near the barangay hall, water is rising fast.",
    locationLabel: "Barangay Poblacion, Cordova, Cebu",
    ...CORDOVA,
    reporterLatitude: CORDOVA.latitude,
    reporterLongitude: CORDOVA.longitude,
};

const validAnnouncement = {
    title: "Typhoon Signal No. 2 raised over Cordova",
    content: "Residents of coastal barangays are advised to prepare for possible evacuation.",
    priority: "Urgent" as const,
    audience: "All Users" as const,
};

// ---- Incident reports -----------------------------------------------------

test("a normal incident report is still accepted, with and without details", () => {
    assert.ok(createIncidentSchema.safeParse(validReport).success);
    const { details: _details, ...noDetails } = validReport;
    assert.ok(createIncidentSchema.safeParse(noDetails).success);
});

test("report details up to 1000 characters are accepted, longer is rejected", () => {
    assert.ok(createIncidentSchema.safeParse({ ...validReport, details: chars(1000) }).success);
    const tooLong = createIncidentSchema.safeParse({ ...validReport, details: chars(1001) });
    assert.equal(tooLong.success, false);
});

test("the mobile app's own 500-character details limit stays well inside the server limit", () => {
    assert.ok(createIncidentSchema.safeParse({ ...validReport, details: chars(500) }).success);
});

test("report locationLabel up to 300 characters is accepted, longer is rejected, empty still rejected", () => {
    assert.ok(createIncidentSchema.safeParse({ ...validReport, locationLabel: chars(300) }).success);
    assert.equal(createIncidentSchema.safeParse({ ...validReport, locationLabel: chars(301) }).success, false);
    assert.equal(createIncidentSchema.safeParse({ ...validReport, locationLabel: "" }).success, false);
});

// ---- SOS ------------------------------------------------------------------

test("an SOS is still accepted with or without a locationLabel", () => {
    assert.ok(triggerSosSchema.safeParse(CORDOVA).success);
    assert.ok(triggerSosSchema.safeParse({ ...CORDOVA, locationLabel: "Barangay Gabi, Cordova" }).success);
});

test("SOS locationLabel up to 300 characters is accepted, longer is rejected", () => {
    assert.ok(triggerSosSchema.safeParse({ ...CORDOVA, locationLabel: chars(300) }).success);
    assert.equal(triggerSosSchema.safeParse({ ...CORDOVA, locationLabel: chars(301) }).success, false);
});

// ---- Profile --------------------------------------------------------------

test("a normal profile update is still accepted (name and mobile, or either alone)", () => {
    assert.ok(updateProfileSchema.safeParse({ name: "Juan Dela Cruz", mobile: "09171234567" }).success);
    assert.ok(updateProfileSchema.safeParse({ name: "Juan Dela Cruz" }).success);
    assert.ok(updateProfileSchema.safeParse({ mobile: "+63 917 123 4567" }).success);
});

test("profile name up to 100 characters is accepted (same as registration), longer is rejected", () => {
    assert.ok(updateProfileSchema.safeParse({ name: chars(100) }).success);
    assert.equal(updateProfileSchema.safeParse({ name: chars(101) }).success, false);
});

// ---- Announcements --------------------------------------------------------

test("a normal announcement is still accepted on create and update", () => {
    assert.ok(createAnnouncementSchema.safeParse(validAnnouncement).success);
    assert.ok(updateAnnouncementSchema.safeParse(validAnnouncement).success);
});

test("announcement title up to 150 characters is accepted, longer is rejected", () => {
    assert.ok(createAnnouncementSchema.safeParse({ ...validAnnouncement, title: chars(150) }).success);
    assert.equal(createAnnouncementSchema.safeParse({ ...validAnnouncement, title: chars(151) }).success, false);
    assert.equal(updateAnnouncementSchema.safeParse({ ...validAnnouncement, title: chars(151) }).success, false);
});

test("announcement content up to 5000 characters is accepted, longer is rejected", () => {
    assert.ok(createAnnouncementSchema.safeParse({ ...validAnnouncement, content: chars(5000) }).success);
    assert.equal(createAnnouncementSchema.safeParse({ ...validAnnouncement, content: chars(5001) }).success, false);
});

test("the existing announcement rules still apply (barangay required only for Specific Barangay)", () => {
    assert.equal(
        createAnnouncementSchema.safeParse({ ...validAnnouncement, audience: "Specific Barangay" }).success,
        false,
    );
    assert.ok(
        createAnnouncementSchema.safeParse({
            ...validAnnouncement,
            audience: "Specific Barangay",
            barangayName: "Poblacion",
        }).success,
    );
});
