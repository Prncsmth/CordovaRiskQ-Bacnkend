// src/constants/barangayCenters.ts
// Center point of each Cordova barangay. Mirrors CORDOVA_BARANGAYS in the
// mobile repo's constants/cordovaBarangays.ts (same PhilAtlas coordinates),
// so the server places an incident in the same barangay the responder app
// does. Kept in sync manually, like CORDOVA_BARANGAY_NAMES.
export const BARANGAY_CENTERS: { name: string; latitude: number; longitude: number }[] = [
    { name: "Alegria", latitude: 10.2572, longitude: 123.9612 },
    { name: "Bangbang", latitude: 10.2588, longitude: 123.9445 },
    { name: "Buagsong", latitude: 10.2507, longitude: 123.9403 },
    { name: "Catarman", latitude: 10.2485, longitude: 123.9483 },
    { name: "Cogon", latitude: 10.2647, longitude: 123.9518 },
    { name: "Dapitan", latitude: 10.2663, longitude: 123.949 },
    { name: "Day-as", latitude: 10.2554, longitude: 123.9355 },
    { name: "Gabi", latitude: 10.2626, longitude: 123.9606 },
    { name: "Gilutongan", latitude: 10.2036, longitude: 123.9886 },
    { name: "Ibabao", latitude: 10.2707, longitude: 123.9473 },
    { name: "Pilipog", latitude: 10.2666, longitude: 123.9428 },
    { name: "Poblacion", latitude: 10.2525, longitude: 123.9502 },
    { name: "San Miguel", latitude: 10.2623, longitude: 123.9453 },
];
