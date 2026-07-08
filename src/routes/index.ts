import { Router } from "express";
import testRoutes from "@/routes/test.routes";

// Central router — mount all feature route files here.
// As you add new resources, do: router.use(entityRoutes) below.
const router = Router();

router.use(testRoutes);

export default router;
