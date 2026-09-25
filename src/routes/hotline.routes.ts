import { Router } from "express";
import { hotlineController } from "@/controllers/hotline.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { requireAdmin } from "@/middlewares/requireAdmin.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { updateHotlineSchema } from "@/validations/hotline.validation";

const router = Router();

router.get("/hotlines", authenticate, hotlineController.list);
router.patch(
    "/admin/hotlines/:id",
    authenticate,
    requireAdmin,
    validate(updateHotlineSchema),
    hotlineController.update
);

export default router;
