import { Request, Response } from "express";
import { authService } from "@/services/auth.service";
import { pendingRegistrationService } from "@/services/pendingRegistration.service";
import { asyncHandler } from "@/utils/asyncHandler";

export const authController = {
    register: asyncHandler(async (req: Request, res: Response) => {
        const { email, password, name } = req.body;
        const result = await authService.register(email, password, name);
        res.status(201).json({ success: true, ...result });
    }),

    requestRegistrationOtp: asyncHandler(async (req: Request, res: Response) => {
        const { name, email, password } = req.body;
        await pendingRegistrationService.requestOtp({ name, email, password });
        res.status(200).json({ success: true });
    }),

    verifyRegistrationOtp: asyncHandler(async (req: Request, res: Response) => {
        const { email, code } = req.body;
        const result = await pendingRegistrationService.verifyOtp({ email, code });
        res.status(200).json({ success: true, ...result });
    }),

    login: asyncHandler(async (req: Request, res: Response) => {
        const { email, password } = req.body;
        const result = await authService.login(email, password);
        res.status(200).json({ success: true, ...result });
    }),

    google: asyncHandler(async (req: Request, res: Response) => {
        const { idToken } = req.body;
        const result = await authService.loginWithGoogle(idToken);
        res.status(200).json({ success: true, ...result });
    }),
};
