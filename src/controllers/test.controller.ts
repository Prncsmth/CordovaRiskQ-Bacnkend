import { Request, Response } from "express";
import { testService } from "@/services/test.service";

// Controllers handle req/res only — no business logic here.
export const testController = {
    getStatus(req: Request, res: Response) {
        const result = testService.getStatus();
        res.status(200).json(result);
    },
};
