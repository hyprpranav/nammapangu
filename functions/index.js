/**
 * NAMMAPANGU - FIREBASE CLOUD FUNCTIONS
 * Secure Backend for PIN Verification, Atomic Dispensing & Quota Cycles
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { hashPin, generateSalt } = require("./helpers/pinSecurity");

admin.initializeApp();
const db = admin.firestore();

/**
 * Callable Function: verifyUserPin
 * Validates citizen 6-digit PIN against stored salted hash securely on backend.
 */
exports.verifyUserPin = functions.https.onCall(async (data, context) => {
  // Check caller authentication
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Admin authentication required.");
  }

  const { userId, pin } = data;
  if (!userId || !pin || pin.length !== 6) {
    throw new functions.https.HttpsError("invalid-argument", "Valid User ID and 6-digit PIN required.");
  }

  const userDoc = await db.collection("users").doc(userId).get();
  if (!userDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Citizen record not found.");
  }

  const userData = userDoc.data();
  if (userData.status === "blocked") {
    throw new functions.https.HttpsError("permission-denied", "Citizen account is suspended/blocked.");
  }

  const computedHash = hashPin(pin, userData.salt || "NAMMAPANGU_TN_PDS_SALT_2026");
  const isMatch = computedHash === userData.pinHash;

  if (!isMatch) {
    // Log failed attempt audit
    await db.collection("audit_logs").add({
      action: "PIN_VERIFICATION_FAILED",
      userId: userId,
      rfidUid: userData.rfidUid,
      adminEmail: context.auth.token.email || "Admin",
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    return { valid: false, message: "INCORRECT PIN – TRY AGAIN." };
  }

  return { valid: true, message: "PIN Verified Successfully." };
});

/**
 * Callable Function: executeDistribution
 * Atomic Firestore Transaction executing stock deduction and entitlement updates.
 */
exports.executeDistribution = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authorized administrator access required.");
  }

  const { userId, productId, actualQuantity, targetQuantity } = data;
  const actualQty = parseFloat(actualQuantity);

  if (!userId || !productId || isNaN(actualQty) || actualQty <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid distribution transaction parameters.");
  }

  const now = new Date();
  const cycleId = `${userId}_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`;

  try {
    const result = await db.runTransaction(async (transaction) => {
      const prodRef = db.collection("products").doc(productId);
      const userRef = db.collection("users").doc(userId);
      const cycleRef = db.collection("distribution_cycles").doc(cycleId);
      const txRef = db.collection("transactions").doc();

      const [prodDoc, userDoc, cycleDoc] = await Promise.all([
        transaction.get(prodRef),
        transaction.get(userRef),
        transaction.get(cycleRef)
      ]);

      if (!prodDoc.exists) throw new Error("Product not found in shop catalog.");
      if (!userDoc.exists) throw new Error("Citizen user not found.");

      const prodData = prodDoc.data();
      const userData = userDoc.data();
      const currentStock = parseFloat(prodData.availableStock) || 0;

      if (currentStock < actualQty) {
        throw new Error(`Insufficient stock: Only ${currentStock} ${prodData.unit} in warehouse.`);
      }

      // Check entitlement
      let ents = cycleDoc.exists ? (cycleDoc.data().entitlements || {}) : {};
      let userEnt = ents[productId] || {
        productName: prodData.name,
        unit: prodData.unit,
        allocated: targetQuantity || actualQty,
        distributed: 0
      };

      const newDistributed = Math.round((userEnt.distributed + actualQty) * 100) / 100;
      ents[productId] = {
        ...userEnt,
        distributed: newDistributed,
        status: newDistributed >= userEnt.allocated ? "completed" : "pending"
      };

      // 1. Deduct Stock
      const newStock = Math.max(0, Math.round((currentStock - actualQty) * 100) / 100);
      transaction.update(prodRef, {
        availableStock: newStock,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // 2. Update Monthly Entitlement
      transaction.set(cycleRef, {
        userId: userId,
        monthYear: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
        entitlements: ents,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // 3. Create Immutable Transaction Record
      const txId = "TXN" + Date.now().toString().slice(-8);
      transaction.set(txRef, {
        transactionId: txId,
        userId: userId,
        userName: userData.name,
        rfidUid: userData.rfidUid,
        aadhaar: userData.aadhaar,
        productId: productId,
        productName: prodData.name,
        targetQuantity: targetQuantity || actualQty,
        actualQuantity: actualQty,
        unit: prodData.unit,
        adminEmail: context.auth.token.email || "PDS Officer",
        status: "COMPLETED",
        hardwareConfirmed: true,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      return {
        transactionId: txId,
        productName: prodData.name,
        actualQuantity: actualQty,
        unit: prodData.unit,
        newStock: newStock
      };
    });

    return { success: true, transaction: result };
  } catch (error) {
    console.error("Distribution transaction failure:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

/**
 * Scheduled Cloud Function (Runs on 1st of every month at 00:00 UTC)
 * Automatically resets / pre-allocates monthly entitlement quotas.
 */
exports.resetMonthlyEntitlements = functions.pubsub.schedule("0 0 1 * *").onRun(async (context) => {
  console.log("NAMMAPANGU: Running monthly entitlement reset job...");
  const now = new Date();
  const currentMonthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const usersSnap = await db.collection("users").where("status", "==", "active").get();
  const prodsSnap = await db.collection("products").where("active", "==", true).get();

  const defaultEntitlements = {};
  prodsSnap.forEach(pDoc => {
    const p = pDoc.data();
    defaultEntitlements[pDoc.id] = {
      productName: p.name,
      unit: p.unit,
      allocated: p.defaultEntitlement || 1.0,
      distributed: 0,
      status: "pending"
    };
  });

  const batch = db.batch();
  usersSnap.forEach(uDoc => {
    const cycleRef = db.collection("distribution_cycles").doc(`${uDoc.id}_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`);
    batch.set(cycleRef, {
      userId: uDoc.id,
      monthYear: currentMonthYear,
      entitlements: defaultEntitlements,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

  await batch.commit();
  console.log(`NAMMAPANGU: Monthly cycle initialized for ${usersSnap.size} active citizens.`);
  return null;
});
