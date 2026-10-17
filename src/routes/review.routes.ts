import { Router } from "express";
import { reviewController } from "@/controllers/review.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { requireAdmin } from "@/middlewares/requireAdmin.middleware";
import { reviewLimiter } from "@/middlewares/rateLimit.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { createReviewSchema, updateReviewStatusSchema } from "@/validations/review.validation";

const router = Router();

// Public: the website's Reviews section. No account needed to rate or comment.
router.post("/reviews", reviewLimiter, validate(createReviewSchema), reviewController.create);
router.get("/reviews", reviewController.listPublic);

router.get("/admin/reviews", authenticate, requireAdmin, reviewController.listForAdmin);
router.patch(
    "/admin/reviews/:id/status",
    authenticate,
    requireAdmin,
    validate(updateReviewStatusSchema),
    reviewController.updateStatus
);

export default router;
