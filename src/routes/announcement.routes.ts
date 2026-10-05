import { Router } from "express";
import { announcementController } from "@/controllers/announcement.controller";
import { authenticate, optionalAuthenticate } from "@/middlewares/authenticate.middleware";
import { requireAdmin } from "@/middlewares/requireAdmin.middleware";
import { requireResponder } from "@/middlewares/requireResponder.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { createAnnouncementSchema, updateAnnouncementSchema } from "@/validations/announcement.validation";

const router = Router();

// Public safety content -- no authenticate middleware. /active is registered
// first so it isn't shadowed by the /:id route below.
router.get("/announcements/active", announcementController.getActive);
// Includes "Responders Only" announcements, so unlike /active it requires a
// logged-in responder.
router.get(
    "/announcements/active/responder",
    authenticate,
    requireResponder,
    announcementController.getActiveForResponder
);
// Public for every audience except Responders Only, which needs a signed-in
// responder -- optionalAuthenticate identifies one without rejecting
// anonymous callers.
router.get("/announcements/:id", optionalAuthenticate, announcementController.getById);

router.get("/admin/announcements", authenticate, requireAdmin, announcementController.listForAdmin);
router.post(
    "/admin/announcements",
    authenticate,
    requireAdmin,
    validate(createAnnouncementSchema),
    announcementController.create
);
router.patch(
    "/admin/announcements/:id",
    authenticate,
    requireAdmin,
    validate(updateAnnouncementSchema),
    announcementController.update
);
router.delete("/admin/announcements/:id", authenticate, requireAdmin, announcementController.remove);

export default router;
