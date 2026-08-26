// Catches any request that didn't match a route.
// Must be registered AFTER all other routes in app.ts.
export function notFoundHandler(req, res) {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`,
    });
}
//# sourceMappingURL=notFound.middleware.js.map