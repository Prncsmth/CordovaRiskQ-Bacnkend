import express, { Application, Request, Response } from "express";
import cors from "cors";

const app: Application = express();

// Middlewares
app.use(cors());
app.use(express.json());


// Test Endpoint
app.get("/api/test", (req: Request, res: Response) => {
    res.status(200).json({
        success: true,
        message: "Express TypeScript backend is working!",
        timestamp: new Date().toISOString()
    });
});

export default app;