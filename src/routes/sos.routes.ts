import { Router } from "express";
import { sosController } from "@/controllers/sos.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { triggerSosSchema } from "@/validations/sos.validation";

const router = Router();

router.post(
    "/sos",
    authenticate,
    validate(triggerSosSchema),
    sosController.trigger
);

export default router;
