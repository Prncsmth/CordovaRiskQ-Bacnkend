import { Router } from "express";
import { hotlineController } from "@/controllers/hotline.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";

const router = Router();

router.get("/hotlines", authenticate, hotlineController.list);

export default router;
