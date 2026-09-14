import { Router } from "express";
import { historyController } from "@/controllers/history.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { requireAdmin } from "@/middlewares/requireAdmin.middleware";

const router = Router();

router.get("/admin/history", authenticate, requireAdmin, historyController.list);
router.get("/admin/history/:id", authenticate, requireAdmin, historyController.getById);

export default router;
