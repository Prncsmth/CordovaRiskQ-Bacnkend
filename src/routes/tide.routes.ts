// src/routes/tide.routes.ts
import { Router } from "express";
import { tideController } from "@/controllers/tide.controller";

const router = Router();

// Public safety data -- no authenticate middleware.
router.get("/tide", tideController.getStatus);

export default router;
