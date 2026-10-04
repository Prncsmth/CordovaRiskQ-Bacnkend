import { z } from "zod";
import { passwordField } from "./password.schema";

// Accepts "09171234567" or "+639171234567", with or without spaces/dashes
// (e.g. the "+63 912 345 6789" format app/phone-number.tsx saves) -- spaces
// and dashes are stripped before matching.
const PH_MOBILE_REGEX = /^(\+639\d{9}|09\d{9})$/;

export const updateProfileSchema = z.object({
    name: z.string().optional(),
    // Optional and never written: the email can't be changed (see
    // services/accountEmail.ts). Older app versions still send the current
    // one, which the service accepts; a different one is rejected there.
    email: z.string().trim().optional(),
    // Optional: some accounts (e.g. admin-provisioned responders) never go
    // through the mobile-number onboarding gate. When a value IS given, it
    // must be a real PH mobile number -- not just any string.
    mobile: z
        .string()
        .optional()
        .refine(
            (value) => !value || PH_MOBILE_REGEX.test(value.replace(/[\s-]/g, "")),
            { message: "Enter a valid PH mobile number (e.g. 09171234567)" },
        ),
});

export const changePasswordSchema = z.object({
    oldPassword: z.string().min(1, "Old password is required"),
    newPassword: passwordField,
});

export const updatePushTokenSchema = z.object({
    // null clears the stored token (push-notifications opt-out) -- a plain
    // string still must be non-empty when actually registering one.
    token: z.string().min(1, "Push token is required").nullable(),
});

export const updateDutyStatusSchema = z.object({
    isOnDuty: z.boolean(),
});
