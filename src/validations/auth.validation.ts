import { z } from "zod";

export const registerSchema = z.object({
    email: z
        .string()
        .trim()
        .email("Invalid email address")
        .refine((value) => value.toLowerCase().endsWith("@gmail.com"), {
            message: "Only Gmail addresses (@gmail.com) are allowed",
        })
        .transform((value) => value.toLowerCase()),
    password: z.string().min(6, "Password must be at least 6 characters"),
    name: z.string().optional(),
});

export const loginSchema = z.object({
    email: z
        .string()
        .trim()
        .email("Invalid email address")
        .transform((value) => value.toLowerCase()),
    password: z.string().min(1, "Password is required"),
});

export const googleAuthSchema = z.object({
    idToken: z.string().min(1, "Google ID token is required"),
});
