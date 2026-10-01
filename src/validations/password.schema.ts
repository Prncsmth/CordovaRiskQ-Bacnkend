import { z } from "zod";

// Shared by registration (request-otp) and change-password so the two rules
// never drift: 8-12 characters, at least one uppercase letter, one
// lowercase letter, one number, and one symbol. Does not apply to login
// (an existing account may predate this policy) or to the old-password
// field on change-password (that's just "prove you know it today").
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 12;

export const passwordField = z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`)
    .regex(/[A-Z]/, "Password must include an uppercase letter")
    .regex(/[a-z]/, "Password must include a lowercase letter")
    .regex(/\d/, "Password must include a number")
    .regex(/[^A-Za-z0-9]/, "Password must include a symbol");
