// Services hold business logic and talk to Prisma/DB.
// Controllers should stay thin and just call into services like this one.
export const testService = {
    getStatus() {
        return {
            success: true,
            message: "Express TypeScript backend is working!",
            timestamp: new Date().toISOString(),
        };
    },
};
