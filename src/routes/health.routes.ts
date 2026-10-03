import { Router } from "express";

const router = Router();

// Render's health check -- deliberately has no DB/external dependency, so
// it reflects whether the HTTP server itself is up, not whether Prisma or
// email happen to be reachable at this instant.
router.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
});

export default router;
