import { Request, Response } from "express";
import { authService } from "@/services/auth.service";
import { asyncHandler } from "@/utils/asyncHandler";

export const authController = {
    register: asyncHandler(async (req: Request, res: Response) => {
        const { email, password, name } = req.body;
        const result = await authService.register(email, password, name);
        res.status(201).json({ success: true, ...result });
    }),

    login: asyncHandler(async (req: Request, res: Response) => {
        const { email, password } = req.body;
        const result = await authService.login(email, password);
        res.status(200).json({ success: true, ...result });
    }),
};