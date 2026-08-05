import bcrypt from "bcrypt";
import { prisma } from "../src/lib/prisma";

async function main() {
  const email = process.env.ADMIN_SEED_EMAIL || "admin@cordova-riskq.local";
  const password = process.env.ADMIN_SEED_PASSWORD;
  if (!password) {
    throw new Error("ADMIN_SEED_PASSWORD is required — refusing to seed a default admin password.");
  }
  const name = process.env.ADMIN_SEED_NAME || "System Administrator";

  const hashedPassword = await bcrypt.hash(password, 10);

  const admin = await prisma.admin.upsert({
    where: { email },
    update: {},
    create: { email, password: hashedPassword, name, role: "super_admin" },
  });

  console.log(`Seeded admin: ${admin.email} (${admin.role})`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
