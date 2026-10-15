import { Router } from "express";
import { authController } from "@/controllers/auth.controller";
import { validate } from "@/middlewares/validate.middleware";
import {
    loginEmailLimiter,
    loginLimiter,
    requestOtpLimiter,
    verifyOtpLimiter,
} from "@/middlewares/rateLimit.middleware";
import {
    loginSchema,
    googleAuthSchema,
    requestRegistrationOtpSchema,
    resendRegistrationOtpSchema,
    verifyRegistrationOtpSchema,
    forgotPasswordSchema,
    verifyResetCodeSchema,
    resetPasswordSchema,
} from "@/validations/auth.validation";

const router = Router();

// Registration requires the emailed 6-digit code -- there is no route that
// creates an account without it.
router.post(
    "/auth/register/request-otp",
    requestOtpLimiter,
    validate(requestRegistrationOtpSchema),
    authController.requestRegistrationOtp
);
// Shares request-otp's limiter: both send an email.
router.post(
    "/auth/register/resend-otp",
    requestOtpLimiter,
    validate(resendRegistrationOtpSchema),
    authController.resendRegistrationOtp
);
router.post(
    "/auth/register/verify-otp",
    verifyOtpLimiter,
    validate(verifyRegistrationOtpSchema),
    authController.verifyRegistrationOtp
);
// Forgot password: emails a 6-digit code (same limiter as the other
// code-sending routes). verify-reset-code then checks the code on its own
// (the app's "Enter code" step), and reset-password checks it again and sets
// the new password. Both share verify-otp's limiter, capping code guessing
// per IP on top of the per-code attempt limit.
router.post(
    "/auth/forgot-password",
    requestOtpLimiter,
    validate(forgotPasswordSchema),
    authController.forgotPassword
);
router.post(
    "/auth/verify-reset-code",
    verifyOtpLimiter,
    validate(verifyResetCodeSchema),
    authController.verifyResetCode
);
router.post(
    "/auth/reset-password",
    verifyOtpLimiter,
    validate(resetPasswordSchema),
    authController.resetPassword
);
// IP limit first, then the per-email limit (failed attempts only) -- see
// rateLimit.middleware.ts. Google sign-in has no email in the body, so it
// keeps the IP limit alone.
router.post(
    "/auth/login",
    loginLimiter,
    loginEmailLimiter,
    validate(loginSchema),
    authController.login
);
router.post(
    "/auth/google",
    loginLimiter,
    validate(googleAuthSchema),
    authController.google
);

export default router;
