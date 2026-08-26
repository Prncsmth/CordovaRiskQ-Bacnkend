import { AppError } from "@/utils/AppError";
export function validate(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            const message = result.error.issues.map((i) => i.message).join(", ");
            return next(new AppError(message, 400));
        }
        req.body = result.data;
        next();
    };
}
//# sourceMappingURL=validate.middleware.js.map