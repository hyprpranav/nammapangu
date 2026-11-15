/**
 * NAMMAPANGU - FIREBASE & CLOUDINARY CONFIGURATION
 * Cloud Firestore, Auth & Cloudinary Image Storage
 */

// Production Firebase Configuration
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyB0Ix-P9CKPDiHy4KZX8LctzmI1lNfKBBU",
  authDomain: "nammapangu-53462.firebaseapp.com",
  projectId: "nammapangu-53462",
  storageBucket: "nammapangu-53462.firebasestorage.app",
  messagingSenderId: "429172434913",
  appId: "1:429172434913:web:55c8f189521b9b799dd4a0"
};

// Cloudinary Configuration for FREE Image Storage (pexlucgy / nammapangu_preset)
const CLOUDINARY_CONFIG = {
  cloudName: "pexlucgy",
  uploadPreset: "nammapangu_preset"
};

// Check custom configuration from localStorage
function getFirebaseConfig() {
  try {
    const saved = localStorage.getItem("nammapangu_firebase_config");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.projectId && parsed.apiKey) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Could not read custom Firebase config from localStorage", e);
  }
  return DEFAULT_FIREBASE_CONFIG;
}

function getCloudinaryConfig() {
  try {
    const saved = localStorage.getItem("nammapangu_cloudinary_config");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.cloudName) return parsed;
    }
  } catch (e) {}
  return CLOUDINARY_CONFIG;
}

const activeFirebaseConfig = getFirebaseConfig();

// Initialize Firebase SDK
let firebaseApp = null;
let auth = null;
let db = null;
let storage = null;
let isFirebaseOnline = false;

try {
  if (typeof firebase !== 'undefined') {
    firebaseApp = firebase.initializeApp(activeFirebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    try { storage = firebase.storage(); } catch (se) {}

    // Enable offline persistence
    db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
      console.warn("Firestore persistence notice:", err.code);
    });

    isFirebaseOnline = true;
    console.log("NAMMAPANGU: Connected to Firebase project:", activeFirebaseConfig.projectId);
  } else {
    console.error("NAMMAPANGU: Firebase SDK libraries not loaded!");
  }
} catch (error) {
  console.error("NAMMAPANGU: Error initializing Firebase:", error);
}

/**
 * Uploads an image to Cloudinary (Free tier)
 * Falls back to base64 data-URL if Cloudinary upload preset is not yet set up.
 */
async function uploadImageToCloudinary(file) {
  const cfg = getCloudinaryConfig();

  // Direct unsigned upload to Cloudinary API
  if (cfg.cloudName && cfg.uploadPreset) {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", cfg.uploadPreset);

      const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`, {
        method: "POST",
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        console.log("NAMMAPANGU: Image uploaded to Cloudinary successfully:", data.secure_url);
        return data.secure_url;
      } else {
        const errData = await res.json();
        console.warn("Cloudinary upload response error:", errData);
      }
    } catch (err) {
      console.warn("Cloudinary upload network error, falling back to data URL:", err);
    }
  }

  // Graceful fallback: Convert to optimized data URL so citizen photos always work without setup
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Initial Sample Items
const INITIAL_DEMO_PRODUCTS = [
  { id: "prod_rice", name: "Rice", nameTa: "அரிசி", unit: "KG", availableStock: 450.0, maxCapacity: 1000.0, defaultEntitlement: 10.0, active: true, isAvailableToday: true },
  { id: "prod_sugar", name: "Sugar", nameTa: "சர்க்கரை", unit: "KG", availableStock: 120.0, maxCapacity: 300.0, defaultEntitlement: 1.0, active: true, isAvailableToday: true },
  { id: "prod_wheat", name: "Wheat", nameTa: "கோதுமை", unit: "KG", availableStock: 180.0, maxCapacity: 500.0, defaultEntitlement: 5.0, active: true, isAvailableToday: true },
  { id: "prod_toor_dal", name: "Toor Dal", nameTa: "துவரம் பருப்பு", unit: "KG", availableStock: 95.0, maxCapacity: 250.0, defaultEntitlement: 1.0, active: true, isAvailableToday: true },
  { id: "prod_urad_dal", name: "Urad Dal", nameTa: "உளுத்தம் பருப்பு", unit: "KG", availableStock: 80.0, maxCapacity: 200.0, defaultEntitlement: 1.0, active: true, isAvailableToday: false },
  { id: "prod_palm_oil", name: "Palm Oil", nameTa: "பாமாயில்", unit: "Litre", availableStock: 110.0, maxCapacity: 300.0, defaultEntitlement: 1.0, active: true, isAvailableToday: false },
  { id: "prod_other_dal", name: "Other Dal (Moong)", nameTa: "பாசிப் பருப்பு", unit: "KG", availableStock: 60.0, maxCapacity: 150.0, defaultEntitlement: 1.0, active: true, isAvailableToday: false },
  { id: "prod_salt", name: "Salt (Fortified)", nameTa: "அயோடைஸ் உப்பு", unit: "KG", availableStock: 140.0, maxCapacity: 200.0, defaultEntitlement: 1.0, active: true, isAvailableToday: false },
  { id: "prod_essential", name: "Essential Items Kit", nameTa: "அத்தியாவசியப் பொருட்கள்", unit: "Kit", availableStock: 50.0, maxCapacity: 100.0, defaultEntitlement: 1.0, active: true, isAvailableToday: false },
  { id: "prod_custom", name: "Special Festival Item", nameTa: "சிறப்பு பொங்கல் தொகுப்பு", unit: "Pack", availableStock: 40.0, maxCapacity: 100.0, defaultEntitlement: 1.0, active: true, isAvailableToday: false }
];

async function ensureInitialProducts() {
  if (!db) return;
  try {
    const snap = await db.collection("products").limit(1).get();
    if (snap.empty) {
      console.log("NAMMAPANGU: Seeding default demonstration commodities to Firestore...");
      const batch = db.batch();
      INITIAL_DEMO_PRODUCTS.forEach(p => {
        const ref = db.collection("products").doc(p.id);
        batch.set(ref, {
          ...p,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
    }
  } catch (e) {
    console.warn("NAMMAPANGU: Auto-seeding notice:", e.message);
  }
}

// Automatically ensure default admin account exists in Firebase Auth
async function ensureDefaultAdminAccount() {
  if (!auth) return;
  const adminEmail = "admin@tn.gov.in";
  const adminPass = "admin2026";

  // Check if we are already logged in
  if (auth.currentUser && auth.currentUser.email === adminEmail) return;

  try {
    await auth.signInWithEmailAndPassword(adminEmail, adminPass);
  } catch (e) {
    if (e.code === "auth/user-not-found" || e.code === "auth/invalid-credential") {
      try {
        const cred = await auth.createUserWithEmailAndPassword(adminEmail, adminPass);
        await cred.user.updateProfile({ displayName: "TN PDS Administrator" });
        console.log("NAMMAPANGU: Default administrator account initialized:", adminEmail);
      } catch (ce) {
        // User may already be created in console
      }
    }
  }
}

window.NP_FIREBASE = {
  app: firebaseApp,
  auth: auth,
  db: db,
  storage: storage,
  isOnline: () => isFirebaseOnline,
  getConfig: getFirebaseConfig,
  getCloudinaryConfig: getCloudinaryConfig,
  uploadImageToCloudinary: uploadImageToCloudinary,
  ensureInitialProducts: ensureInitialProducts,
  ensureDefaultAdminAccount: ensureDefaultAdminAccount
};
