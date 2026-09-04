// src/routes/notification.routes.ts
import { Router } from "express";
import { notificationController } from "@/controllers/notification.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";

const router = Router();

router.get("/notifications", authenticate, notificationController.list);
router.patch("/notifications/:id/read", authenticate, notificationController.markRead);
router.patch("/notifications/read-all", authenticate, notificationController.markAllRead);

export default router;
