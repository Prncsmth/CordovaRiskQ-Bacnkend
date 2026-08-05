import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { signToken } from "@/utils/jwt";

function toPublicAdmin(admin: {
    id: string;
    email: string;
    name: string;
    role: string;
}) {
    return { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
}

export const adminAuthService = {
    async login(email: string, password: string) {
        const admin = await prisma.admin.findUnique({ where: { email } });
        if (!admin) throw new AppError("Invalid email or password", 401);

        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) throw new AppError("Invalid email or password", 401);

        const token = signToken({ adminId: admin.id, role: admin.role });
        return { user: toPublicAdmin(admin), token };
    },
};
