import express, { Application } from "express";
import cors from "cors";
import routes from "@/routes/index";
import { notFoundHandler } from "@/middlewares/notFound.middleware";
import { errorHandler } from "@/middlewares/errorHandler.middleware";

const app: Application = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.use("/api", routes);

// 404 handler — must come after all routes
app.use(notFoundHandler);

// Global error handler — must be registered last
app.use(errorHandler);

export default app;
