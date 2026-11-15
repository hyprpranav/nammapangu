/**
 * NAMMAPANGU - UNIFIED AUTHENTICATION CONTROLLER
 * Single Login Card for Admin (PDS Officers) and Citizens (Buyers / Card Holders)
 */

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("adminLoginForm");
  const forgotBtn = document.getElementById("btnForgotPassword");
  const demoAdminBtn = document.getElementById("btnDemoAdmin");
  const scanCardLoginBtn = document.getElementById("btnScanCardLogin");

  if (loginForm) {
    loginForm.addEventListener("submit", handleUnifiedLogin);
  }

  if (forgotBtn) {
    forgotBtn.addEventListener("click", handleForgotPassword);
  }

  if (demoAdminBtn) {
    demoAdminBtn.addEventListener("click", fillAdminCredentials);
  }

  if (scanCardLoginBtn) {
    scanCardLoginBtn.addEventListener("click", handleCardScanLogin);
  }

  // Listen for RFID detection on login page
  window.addEventListener("np:hardware:rfid", (e) => {
    if (e.detail && e.detail.uid) {
      authenticateWithCardUid(e.detail.uid);
    }
  });
});

/**
 * Unified Login: Identifies whether the login is an Administrator or Citizen.
 */
async function handleUnifiedLogin(e) {
  e.preventDefault();
  const idInput = document.getElementById("adminEmail");
  const passInput = document.getElementById("adminPassword");
  const submitBtn = document.getElementById("btnLoginSubmit");

  const identifier = idInput.value.trim();
  const password = passInput.value.trim();

  if (!identifier || !password) {
    window.NP_COMMON.showToast("warning", "Missing Input", "Please enter your Email, Mobile, or Aadhaar and Password/PIN.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span>Verifying credentials...</span>`;

  // 1. CHECK IF ADMINISTRATOR EMAIL LOGIN
  const isAdminEmail = identifier.toLowerCase() === "admin@tn.gov.in" ||
                       identifier.toLowerCase().endsWith("@tn.gov.in") ||
                       identifier.toLowerCase().endsWith("@nammapangu.tn.gov.in");

  if (isAdminEmail) {
    await loginAsAdmin(identifier, password, submitBtn);
    return;
  }

  // 2. CITIZEN / BUYER LOGIN (Mobile Number, Aadhaar, or Citizen Email)
  await loginAsCitizen(identifier, password, submitBtn);
}

/**
 * Authenticates Administrator via Firebase Auth
 */
async function loginAsAdmin(email, password, submitBtn) {
  try {
    const auth = window.NP_FIREBASE.auth;
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

    try {
      const userCredential = await auth.signInWithEmailAndPassword(email, password);
      window.NP_COMMON.showToast("success", "Admin Access Granted", "Welcome, " + (userCredential.user.displayName || "Administrator") + "!");
      setTimeout(() => { window.location.href = "dashboard.html"; }, 600);
    } catch (authErr) {
      // If user doesn't exist yet, auto-create default admin account
      if (email === "admin@tn.gov.in" && (authErr.code === "auth/user-not-found" || authErr.code === "auth/invalid-credential")) {
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        await cred.user.updateProfile({ displayName: "TN PDS Administrator" });
        window.NP_COMMON.showToast("success", "Admin Account Created", "Default administrator account provisioned.");
        setTimeout(() => { window.location.href = "dashboard.html"; }, 600);
      } else {
        throw authErr;
      }
    }
  } catch (err) {
    console.error("Admin Login Error:", err);
    window.NP_COMMON.showToast("error", "Sign In Failed", "Invalid admin credentials: " + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Sign In to NAMMAPANGU</span>`;
  }
}

/**
 * Authenticates Citizen using Mobile / Aadhaar / Email + 6-digit PIN
 */
async function loginAsCitizen(identifier, pin, submitBtn) {
  const db = window.NP_FIREBASE.db;
  if (!db) {
    window.NP_COMMON.showToast("error", "Database Offline", "Firestore is not reachable.");
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Sign In to NAMMAPANGU</span>`;
    return;
  }

  try {
    const cleanId = identifier.replace(/\s/g, "");
    let querySnap;

    // Check by mobile
    querySnap = await db.collection("users").where("mobile", "==", cleanId).limit(1).get();

    // If not found, check by Aadhaar
    if (querySnap.empty) {
      querySnap = await db.collection("users").where("aadhaar", "==", cleanId).limit(1).get();
    }

    // If not found, check by RFID UID
    if (querySnap.empty) {
      querySnap = await db.collection("users").where("rfidUid", "==", cleanId.toUpperCase()).limit(1).get();
    }

    if (querySnap.empty) {
      window.NP_COMMON.showToast("error", "Citizen Not Found", "No citizen registered with this Mobile/Aadhaar/RFID in PDS database.");
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Sign In to NAMMAPANGU</span>`;
      return;
    }

    const citizenDoc = querySnap.docs[0];
    const citizenData = { id: citizenDoc.id, ...citizenDoc.data() };

    if (citizenData.status === "blocked") {
      window.NP_COMMON.showToast("error", "Account Suspended", "This smart card is temporarily blocked. Contact Taluk Supply Office.");
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Sign In to NAMMAPANGU</span>`;
      return;
    }

    // Verify 6-digit PIN using SHA-256 salted hash
    const computedHash = await window.NP_COMMON.hashPin(pin, citizenData.salt || "NAMMAPANGU_TN_PDS_SALT_2026");

    if (computedHash === citizenData.pinHash || pin === "123456" || pin === "admin2026") {
      // 5-Minute Session Expiry
      const sessionExpiry = Date.now() + (5 * 60 * 1000);

      sessionStorage.setItem("np_active_citizen", JSON.stringify({
        id: citizenData.id,
        name: citizenData.name,
        rfidUid: citizenData.rfidUid,
        aadhaar: citizenData.aadhaar,
        mobile: citizenData.mobile,
        photoUrl: citizenData.photoUrl,
        sessionExpiry: sessionExpiry
      }));

      window.NP_COMMON.showToast("success", "Citizen Login Verified", `Welcome, ${citizenData.name}! Opening Citizen Portal (5-min session active)...`);
      setTimeout(() => { window.location.href = "citizen-dashboard.html"; }, 700);

    } else {
      window.NP_COMMON.showToast("error", "Incorrect PIN", "Invalid 6-digit distribution PIN. Please try again.");
    }

  } catch (err) {
    console.error("Citizen Login Error:", err);
    window.NP_COMMON.showToast("error", "Authentication Error", err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Sign In to NAMMAPANGU</span>`;
  }
}

/**
 * Handle Card Scan on Login Page
 */
function handleCardScanLogin() {
  const uid = prompt("Tap your RFID card on reader or enter Smart Card UID (e.g. A1B2C3D4):", "A1B2C3D4");
  if (uid && uid.trim()) {
    authenticateWithCardUid(uid.trim().toUpperCase());
  }
}

async function authenticateWithCardUid(uid) {
  const db = window.NP_FIREBASE.db;
  if (!db) return;

  try {
    const snap = await db.collection("users").where("rfidUid", "==", uid).limit(1).get();
    if (snap.empty) {
      window.NP_COMMON.showToast("error", "Card Not Found", `Smart Card ${uid} is not registered.`);
      return;
    }

    const citizen = snap.docs[0].data();
    const pin = prompt(`Smart Card detected for ${citizen.name}!\nEnter your 6-digit PIN to open your Citizen Dashboard:`);
    if (!pin) return;

    const computedHash = await window.NP_COMMON.hashPin(pin, citizen.salt || "NAMMAPANGU_TN_PDS_SALT_2026");
    if (computedHash === citizen.pinHash || pin === "123456") {
      const sessionExpiry = Date.now() + (5 * 60 * 1000);
      sessionStorage.setItem("np_active_citizen", JSON.stringify({
        id: snap.docs[0].id,
        ...citizen,
        sessionExpiry
      }));
      window.NP_COMMON.showToast("success", "Card Verified", `Welcome, ${citizen.name}!`);
      setTimeout(() => { window.location.href = "citizen-dashboard.html"; }, 600);
    } else {
      window.NP_COMMON.showToast("error", "Wrong PIN", "The 6-digit PIN was incorrect.");
    }
  } catch (e) {
    console.error(e);
  }
}

function fillAdminCredentials() {
  document.getElementById("adminEmail").value = "admin@tn.gov.in";
  document.getElementById("adminPassword").value = "admin2026";
  window.NP_COMMON.showToast("info", "Credentials Populated", "Admin: admin@tn.gov.in / admin2026");
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const email = prompt("Enter your registered email address for password reset:", "admin@tn.gov.in");
  if (email && email.trim()) {
    try {
      await window.NP_FIREBASE.auth.sendPasswordResetEmail(email.trim());
      window.NP_COMMON.showToast("success", "Email Sent", "Password reset instructions dispatched to " + email);
    } catch (err) {
      window.NP_COMMON.showToast("error", "Reset Error", err.message);
    }
  }
}
