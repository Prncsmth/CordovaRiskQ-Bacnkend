import bcrypt from "bcrypt";
import { prisma } from "../src/lib/prisma";

// Real, named Cordova, Cebu facilities with verified coordinates — copied
// from the mobile app's services/evacuation.service.ts, not invented here.
const EVACUATION_CENTERS = [
  { id: "cordova-central-elementary", name: "Cordova Central Elementary School", address: "Manuel L. Quezon National Highway, Poblacion, Cordova, Cebu", category: "school", facilities: ["Water", "Medical Aid", "Restrooms", "Power"], latitude: 10.2541979, longitude: 123.9500242 },
  { id: "cordova-national-high-school", name: "Cordova National High School", address: "Victorio Pacaldo Sr. Street, Day-as, Cordova, Cebu", category: "school", facilities: ["Water", "Medical Aid", "Restrooms", "Power"], latitude: 10.2552507, longitude: 123.9441963 },
  { id: "cordova-municipal-hall", name: "Cordova Municipal Hall", address: "Martin Francisco Street, Poblacion, Cordova, Cebu", category: "evacuation_center", facilities: ["Water", "Medical Aid", "Restrooms", "Power"], latitude: 10.2523257, longitude: 123.9497836 },
  { id: "cordova-sports-complex", name: "Cordova Sports Complex", address: "Martin Francisco Street, Poblacion, Cordova, Cebu", category: "evacuation_center", facilities: ["Water", "Medical Aid", "Restrooms", "Power"], latitude: 10.2506231, longitude: 123.9497523 },
  { id: "alegria-elementary", name: "Alegria Elementary School", address: "Victor Wahing Street, Alegria, Cordova, Cebu", category: "school", facilities: ["Water", "Restrooms"], latitude: 10.2569616, longitude: 123.9604580 },
  { id: "bangbang-elementary", name: "Bangbang Elementary School", address: "Valeriano Inoc Street, Bangbang, Cordova, Cebu", category: "school", facilities: ["Water", "Restrooms"], latitude: 10.2590618, longitude: 123.9444252 },
  { id: "buagsong-elementary", name: "Buagsong Elementary School", address: "Victorio Degamo Tirol Street, Buagsong, Cordova, Cebu", category: "school", facilities: ["Water", "Medical Aid", "Restrooms"], latitude: 10.2490338, longitude: 123.9396082 },
  { id: "catarman-elementary", name: "Catarman Elementary School", address: "Filimon Nuñez Street, Catarman, Cordova, Cebu", category: "school", facilities: ["Water", "Restrooms"], latitude: 10.2481715, longitude: 123.9460734 },
  { id: "cogon-elementary", name: "Cogon Elementary School", address: "Sergio Baguio Street, Cogon, Cordova, Cebu", category: "school", facilities: ["Water", "Restrooms"], latitude: 10.2654046, longitude: 123.9511837 },
  { id: "day-as-elementary", name: "Day-as Elementary School", address: "Victorio Pacaldo Sr. Street, Day-as, Cordova, Cebu", category: "school", facilities: ["Water", "Restrooms", "Power"], latitude: 10.2543706, longitude: 123.9441505 },
  { id: "dapitan-barangay-hall", name: "Dapitan Barangay Hall", address: "Lilivian Berind Drive, Dapitan, Cordova, Cebu", category: "evacuation_center", facilities: ["Water", "Restrooms"], latitude: 10.2662002, longitude: 123.9492707 },
  { id: "gabi-elementary", name: "Gabi Elementary School", address: "Dinagat Street, Gabi, Cordova, Cebu", category: "school", facilities: ["Water", "Restrooms"], latitude: 10.2625845, longitude: 123.9614178 },
  { id: "gilutongan-elementary", name: "Gilutongan Elementary School", address: "Brgy. Gilutongan, Cordova, Cebu (Gilutongan Island)", category: "school", facilities: ["Water", "Restrooms"], latitude: 10.2072150, longitude: 123.9883661 },
  { id: "ibabao-elementary", name: "Ibabao Elementary School", address: "Cordova Bypass Road, Ibabao, Cordova, Cebu", category: "school", facilities: ["Water", "Restrooms"], latitude: 10.2717843, longitude: 123.9555953 },
  { id: "pilipog-elementary", name: "Pilipog Elementary School", address: "Manuel L. Quezon National Highway, Pilipog, Cordova, Cebu", category: "school", facilities: ["Water", "Restrooms"], latitude: 10.2662362, longitude: 123.9461385 },
  { id: "san-miguel-elementary", name: "San Miguel Elementary School", address: "Brgy. San Miguel, Cordova, Cebu", category: "school", facilities: ["Water", "Restrooms"], latitude: 10.2626036, longitude: 123.9458152 },
];

async function seedAdmin() {
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

async function seedEvacuationCenters() {
  for (const center of EVACUATION_CENTERS) {
    await prisma.evacuationCenter.upsert({
      where: { id: center.id },
      update: {
        // status intentionally excluded -- it's admin-managed at runtime and
        // must survive reseeding, not get reset back to "open" every time.
        name: center.name,
        address: center.address,
        category: center.category,
        facilities: center.facilities,
        latitude: center.latitude,
        longitude: center.longitude,
      },
      create: { ...center, status: "open" },
    });
  }

  console.log(`Seeded ${EVACUATION_CENTERS.length} evacuation centers`);
}

async function main() {
  await seedAdmin();
  await seedEvacuationCenters();
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
