import { Router } from "express";
import { announcementController } from "@/controllers/announcement.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { requireAdmin } from "@/middlewares/requireAdmin.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { createAnnouncementSchema } from "@/validations/announcement.validation";

const router = Router();

// Public safety content -- no authenticate middleware. /active is registered
// first so it isn't shadowed by the /:id route below.
router.get("/announcements/active", announcementController.getActive);
router.get("/announcements/:id", announcementController.getById);

router.get("/admin/announcements", authenticate, requireAdmin, announcementController.listForAdmin);
router.post(
    "/admin/announcements",
    authenticate,
    requireAdmin,
    validate(createAnnouncementSchema),
    announcementController.create
);
router.delete("/admin/announcements/:id", authenticate, requireAdmin, announcementController.remove);

export default router;
