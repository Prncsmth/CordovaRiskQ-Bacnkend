import { z } from "zod";

// Shared by registration (request-otp) and change-password so the two rules
// never drift: 8-64 characters, at least one uppercase letter, one
// lowercase letter, one number, and one symbol. Does not apply to login
// (an existing account may predate this policy) or to the old-password
// field on change-password (that's just "prove you know it today").
// 64 follows NIST SP 800-63B (allow at least 64) and stays under bcrypt's
// 72-byte input limit, past which bcrypt silently ignores the rest.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;
// bcrypt only reads the first 72 BYTES. 64 characters can be far more than
// that once emoji or other multi-byte characters are involved (64 emoji are
// ~250 bytes), and anything past byte 72 would be silently ignored -- two
// different long passwords sharing their first 72 bytes would both work.
export const PASSWORD_MAX_BYTES = 72;

export const passwordField = z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`)
    .refine((value) => Buffer.byteLength(value, "utf8") <= PASSWORD_MAX_BYTES, {
        message: "Password is too long -- use fewer emoji or special characters",
    })
    .regex(/[A-Z]/, "Password must include an uppercase letter")
    .regex(/[a-z]/, "Password must include a lowercase letter")
    .regex(/\d/, "Password must include a number")
    .regex(/[^A-Za-z0-9]/, "Password must include a symbol");
