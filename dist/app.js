import express from "express";
import cors from "cors";
import routes from "@/routes/index";
import { notFoundHandler } from "@/middlewares/notFound.middleware";
import { errorHandler } from "@/middlewares/errorHandler.middleware";
const app = express();
// Middlewares
app.use(cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.options("*", cors());
app.use(express.json());
// Routes - support both /api/* and root-level endpoints to keep mobile clients
// and web clients working regardless of which base URL they use.
app.use("/api", routes);
app.use(routes);
// 404 handler — must come after all routes
app.use(notFoundHandler);
// Global error handler — must be registered last
app.use(errorHandler);
export default app;
//# sourceMappingURL=app.js.map