import { z } from "zod";

export const updateProfileSchema = z.object({
    name: z.string().optional(),
    email: z.string().email("Invalid email address"),
    mobile: z.string().optional(),
});

export const changePasswordSchema = z.object({
    oldPassword: z.string().min(1, "Old password is required"),
    newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

export const updatePushTokenSchema = z.object({
    token: z.string().min(1, "Push token is required"),
});

export const updateDutyStatusSchema = z.object({
    isOnDuty: z.boolean(),
});
