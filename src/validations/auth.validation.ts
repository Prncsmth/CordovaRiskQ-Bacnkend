import { z } from "zod";
import { passwordField } from "./password.schema";

const emailField = z
    .string()
    .trim()
    .email("Invalid email address")
    .transform((value) => value.toLowerCase());

export const loginSchema = z.object({
    email: emailField,
    password: z.string().min(1, "Password is required"),
});

export const googleAuthSchema = z.object({
    idToken: z.string().min(1, "Google ID token is required"),
});

// Registration always goes through the 6-digit email code. Any email
// provider is accepted (no Gmail-only restriction).
export const requestRegistrationOtpSchema = z.object({
    name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
    email: emailField,
    password: passwordField,
});

// Only the email: the password was already hashed and stored by request-otp.
export const resendRegistrationOtpSchema = z.object({
    email: emailField,
});

const otpCodeField = z
    .string()
    .length(6, "Code must be 6 digits")
    .regex(/^\d{6}$/, "Code must be 6 digits");

export const verifyRegistrationOtpSchema = z.object({
    email: emailField,
    code: otpCodeField,
});

export const forgotPasswordSchema = z.object({
    email: emailField,
});

// newPassword follows the same shared policy as registration.
export const resetPasswordSchema = z.object({
    email: emailField,
    code: otpCodeField,
    newPassword: passwordField,
});
