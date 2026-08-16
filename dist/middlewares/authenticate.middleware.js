import { AppError } from "@/utils/AppError";
import { verifyToken } from "@/utils/jwt";
export function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        return next(new AppError("Missing or invalid Authorization header", 401));
    }
    const token = header.slice("Bearer ".length);
    try {
        const payload = verifyToken(token);
        req.userId = payload.userId;
        next();
    }
    catch {
        next(new AppError("Invalid or expired token", 401));
    }
}
//# sourceMappingURL=authenticate.middleware.js.map