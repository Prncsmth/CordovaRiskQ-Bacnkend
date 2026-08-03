import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";

export const userService = {
    async getById(userId: string) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new AppError("User not found", 404);

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            mobile: user.mobile,
        };
    },
};
