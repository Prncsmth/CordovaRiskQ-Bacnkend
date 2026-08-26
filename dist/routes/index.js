import { Router } from "express";
import testRoutes from "@/routes/test.routes";
import authRoutes from "@/routes/auth.routes";
import userRoutes from "@/routes/user.routes";
// Central router — mount all feature route files here.
// As you add new resources, do: router.use(entityRoutes) below.
const router = Router();
router.use(testRoutes);
router.use(authRoutes);
router.use(userRoutes);
export default router;
//# sourceMappingURL=index.js.map