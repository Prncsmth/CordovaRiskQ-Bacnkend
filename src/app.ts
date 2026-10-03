import express, { Application } from "express";
import cors from "cors";
import routes from "@/routes/index";
import { notFoundHandler } from "@/middlewares/notFound.middleware";
import { errorHandler } from "@/middlewares/errorHandler.middleware";

const app: Application = express();

// Render sits as exactly one reverse proxy in front of this service -- without
// this, Express ignores the X-Forwarded-For header it sets, so express-rate-limit
// can't tell real clients apart by IP (every request looks like it came from
// Render's proxy instead of the actual caller).
app.set("trust proxy", 1);

// Middlewares
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("/*splat", cors());
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
