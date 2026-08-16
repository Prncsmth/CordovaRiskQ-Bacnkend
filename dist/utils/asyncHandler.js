// Wrap async controller functions so thrown errors / rejected promises
// are forwarded to next(err) automatically instead of crashing the process.
// Usage: router.get("/", asyncHandler(myController));
export function asyncHandler(fn) {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}
//# sourceMappingURL=asyncHandler.js.map