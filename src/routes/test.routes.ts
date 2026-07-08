import { Router } from "express";
import { testController } from "@/controllers/test.controller";

const router = Router();

router.get("/test", testController.getStatus);

export default router;
