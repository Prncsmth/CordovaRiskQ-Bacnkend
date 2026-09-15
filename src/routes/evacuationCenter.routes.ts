import { Router } from "express";
import { evacuationCenterController } from "@/controllers/evacuationCenter.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { requireAdmin } from "@/middlewares/requireAdmin.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { updateEvacuationCenterSchema } from "@/validations/evacuationCenter.validation";

const router = Router();

router.get("/evacuation-centers", authenticate, evacuationCenterController.list);
router.patch(
    "/admin/evacuation-centers/:id",
    authenticate,
    requireAdmin,
    validate(updateEvacuationCenterSchema),
    evacuationCenterController.update
);

export default router;
