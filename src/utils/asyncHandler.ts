import { NextFunction, Request, Response } from "express";

type AsyncRouteHandler = (
    req: Request,
    res: Response,
    next: NextFunction
) => Promise<unknown>;

// Wrap async controller functions so thrown errors / rejected promises
// are forwarded to next(err) automatically instead of crashing the process.
// Usage: router.get("/", asyncHandler(myController));
export function asyncHandler(fn: AsyncRouteHandler) {
    return (req: Request, res: Response, next: NextFunction) => {
        fn(req, res, next).catch(next);
    };
}
