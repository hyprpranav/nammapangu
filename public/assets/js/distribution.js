/**
 * NAMMAPANGU - LOAD CELL & AUTOMATED RATION DISTRIBUTION MODULE
 * Hardware Dispensing Control, HX711 Weight Tracking, Atomic Firestore Updates
 */

let activeUser = null;
let currentEntitlements = {};
let selectedProductId = null;
let targetWeightKg = 1.00;
let liveMeasuredWeight = 0.00;
let isDispensing = false;
let isTareComplete = false;
let isWeightStable = true;

document.addEventListener("DOMContentLoaded", () => {
  initDistributionPage();
  setupDistributionEvents();
});

async function initDistributionPage() {
  // Load active user from URL or session
  const urlParams = new URLSearchParams(window.location.search);
  const userId = urlParams.get("userId");

  if (!userId) {
    const cached = sessionStorage.getItem("np_active_distribution_user");
    if (cached) {
      activeUser = JSON.parse(cached);
      renderActiveUserHeader(activeUser);
      loadUserCycle(activeUser.id);
    } else {
      window.NP_COMMON.showToast("warning", "No Active User", "Please scan an RFID Smart Card first.");
      setTimeout(() => { window.location.href = "scanner.html"; }, 1000);
      return;
    }
  } else {
    await fetchUserById(userId);
  }

  // Listen to incoming hardware events
  window.addEventListener("np:hardware:weight", (e) => {
    if (e.detail) {
      handleLiveWeightUpdate(e.detail.value, e.detail.unit, e.detail.stable);
    }
  });

  window.addEventListener("np:hardware:servo", (e) => {
    if (e.detail && e.detail.state) {
      updateServoUI(e.detail.state);
    }
  });

  window.addEventListener("np:hardware:status", (e) => {
    if (e.detail && e.detail.state === "COMPLETED" && isDispensing) {
      finalizeDispensingProcess();
    }
  });
}

async function fetchUserById(userId) {
  try {
    const db = window.NP_FIREBASE.db;
    const doc = await db.collection("users").doc(userId).get();
    if (doc.exists) {
      activeUser = { id: doc.id, ...doc.data() };
      renderActiveUserHeader(activeUser);
      loadUserCycle(activeUser.id);
    } else {
      window.NP_COMMON.showToast("error", "User Not Found", "Citizen profile missing.");
    }
  } catch (err) {
    console.error("Error fetching user:", err);
  }
}

function renderActiveUserHeader(user) {
  const nameEl = document.getElementById("distribUserName");
  const aadhaarEl = document.getElementById("distribUserAadhaar");
  const rfidEl = document.getElementById("distribUserRfid");
  const photoEl = document.getElementById("distribUserPhoto");

  if (nameEl) nameEl.textContent = user.name;
  if (aadhaarEl) aadhaarEl.textContent = window.NP_COMMON.maskAadhaar(user.aadhaar);
  if (rfidEl) rfidEl.textContent = window.NP_COMMON.maskRfid(user.rfidUid);
  if (photoEl) photoEl.src = user.photoUrl || "assets/images/cm_vijay.jpg";
}

/**
 * Loads the user's monthly entitlement cycle.
 */
async function loadUserCycle(userId) {
  const container = document.getElementById("productSelectionList");
  if (!container) return;

  const db = window.NP_FIREBASE.db;
  const now = new Date();
  const cycleId = `${userId}_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    let cycleDoc = await db.collection("distribution_cycles").doc(cycleId).get();

    // If new month cycle not yet created, create default
    if (!cycleDoc.exists) {
      const defaultCycle = {
        userId,
        monthYear: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
        entitlements: {
          prod_rice: { productName: "Rice", unit: "KG", allocated: 10, distributed: 0, status: "pending" },
          prod_sugar: { productName: "Sugar", unit: "KG", allocated: 1, distributed: 0, status: "pending" },
          prod_wheat: { productName: "Wheat", unit: "KG", allocated: 5, distributed: 0, status: "pending" },
          prod_toor_dal: { productName: "Toor Dal", unit: "KG", allocated: 1, distributed: 0, status: "pending" },
          prod_palm_oil: { productName: "Palm Oil", unit: "Litre", allocated: 1, distributed: 0, status: "pending" }
        },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await db.collection("distribution_cycles").doc(cycleId).set(defaultCycle);
      currentEntitlements = defaultCycle.entitlements;
    } else {
      currentEntitlements = cycleDoc.data().entitlements || {};
    }

    renderCommodityEntitlementCards();
    checkAllEntitlementsCompleted();

  } catch (err) {
    console.error("Error loading monthly cycle:", err);
    window.NP_COMMON.showToast("error", "Entitlement Error", err.message);
  }
}

/**
 * Renders selectable commodity cards based on user's remaining monthly quota.
 */
function renderCommodityEntitlementCards() {
  const container = document.getElementById("productSelectionList");
  if (!container) return;

  const keys = Object.keys(currentEntitlements);
  if (keys.length === 0) {
    container.innerHTML = `<p class="text-muted">No monthly quotas configured for this smart card.</p>`;
    return;
  }

  container.innerHTML = keys.map(prodId => {
    const item = currentEntitlements[prodId];
    const remaining = Math.max(0, item.allocated - item.distributed);
    const isCompleted = remaining <= 0;
    const isSelected = prodId === selectedProductId;

    return `
      <div class="card commodity-quota-card ${isSelected ? 'border-primary' : ''} ${isCompleted ? 'quota-completed' : ''}"
           style="cursor:${isCompleted ? 'not-allowed' : 'pointer'}; padding:16px; margin-bottom:12px; border:2px solid ${isSelected ? 'var(--tn-green-700)' : 'var(--slate-200)'}; background:${isSelected ? 'var(--tn-green-50)' : 'var(--white)'};"
           onclick="${isCompleted ? '' : `selectCommodityForDispense('${prodId}')`}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:700; font-size:1rem; color:var(--slate-900);">${window.NP_COMMON.escapeHtml(item.productName)}</div>
            <div style="font-size:0.75rem; color:var(--slate-500);">Allocated: ${item.allocated} ${item.unit} | Distributed: ${item.distributed} ${item.unit}</div>
          </div>
          <div style="text-align:right;">
            <span class="badge ${isCompleted ? 'badge-danger' : 'badge-success'}" style="font-size:0.8rem; padding:4px 10px;">
              ${isCompleted ? 'COMPLETED' : `${remaining} ${item.unit} REMAINING`}
            </span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

/**
 * Select a commodity to dispense.
 */
function selectCommodityForDispense(prodId) {
  if (isDispensing) {
    window.NP_COMMON.showToast("warning", "Dispensing Active", "Cannot switch commodity while dispensing is in progress.");
    return;
  }

  selectedProductId = prodId;
  const item = currentEntitlements[prodId];
  const remaining = Math.max(0, item.allocated - item.distributed);

  targetWeightKg = Math.min(1.00, remaining); // Default to 1 KG or remaining

  document.getElementById("dispenseItemName").textContent = item.productName;
  document.getElementById("dispenseItemUnit").textContent = item.unit;
  document.getElementById("targetWeightInput").value = targetWeightKg;
  document.getElementById("targetWeightMaxLabel").textContent = `Max allowed: ${remaining} ${item.unit}`;

  renderCommodityEntitlementCards();
  document.getElementById("dispenseControlsSection").style.display = "block";
}

function setupDistributionEvents() {
  // Tare Button
  const btnTare = document.getElementById("btnTareLoadCell");
  if (btnTare) {
    btnTare.addEventListener("click", handleTareCommand);
  }

  // Start Dispensing Button
  const btnStart = document.getElementById("btnStartDispensing");
  if (btnStart) {
    btnStart.addEventListener("click", handleStartDispensing);
  }

  // Emergency Stop Button
  const btnStop = document.getElementById("btnEmergencyStop");
  if (btnStop) {
    btnStop.addEventListener("click", handleEmergencyStop);
  }

  // Target weight input change
  const targetInput = document.getElementById("targetWeightInput");
  if (targetInput) {
    targetInput.addEventListener("change", (e) => {
      const val = parseFloat(e.target.value);
      if (selectedProductId && currentEntitlements[selectedProductId]) {
        const remaining = currentEntitlements[selectedProductId].allocated - currentEntitlements[selectedProductId].distributed;
        if (val > remaining) {
          window.NP_COMMON.showToast("warning", "Exceeds Quota", `Cannot dispense more than remaining ${remaining} ${currentEntitlements[selectedProductId].unit}`);
          e.target.value = remaining;
          targetWeightKg = remaining;
        } else if (val <= 0) {
          e.target.value = 0.5;
          targetWeightKg = 0.5;
        } else {
          targetWeightKg = val;
        }
      }
    });
  }
}

/**
 * Tare command to zero out load cell weight.
 */
async function handleTareCommand() {
  try {
    if (window.NPHardware) {
      await window.NPHardware.tareWeight();
    }
    isTareComplete = true;
    liveMeasuredWeight = 0.00;
    updateWeightDisplay(0.00, "KG", true);
    window.NP_COMMON.showToast("success", "Tare Complete", "Scale zeroed. Ready for container.");
  } catch (err) {
    window.NP_COMMON.showToast("error", "Tare Failed", err.message);
  }
}

/**
 * Start Dispensing Sequence.
 */
async function handleStartDispensing() {
  if (!selectedProductId) {
    window.NP_COMMON.showToast("warning", "Select Item", "Please select a commodity first.");
    return;
  }

  const targetInput = document.getElementById("targetWeightInput");
  const targetVal = parseFloat(targetInput.value);

  if (isNaN(targetVal) || targetVal <= 0) {
    window.NP_COMMON.showToast("warning", "Invalid Target", "Please enter a valid target weight.");
    return;
  }

  targetWeightKg = targetVal;

  // Check inventory stock availability in Firestore
  const db = window.NP_FIREBASE.db;
  const prodDoc = await db.collection("products").doc(selectedProductId).get();
  if (prodDoc.exists) {
    const stock = prodDoc.data().availableStock || 0;
    if (stock < targetWeightKg) {
      window.NP_COMMON.showToast("error", "Insufficient Stock",
        `Only ${stock} ${prodDoc.data().unit} available in shop inventory.`);
      return;
    }
  }

  isDispensing = true;
  document.getElementById("btnStartDispensing").disabled = true;
  document.getElementById("btnEmergencyStop").style.display = "inline-flex";

  try {
    window.NP_COMMON.showToast("info", "Dispensing Started", `Gate opening for target: ${targetWeightKg} KG`);
    if (window.NPHardware) {
      await window.NPHardware.startDispense(targetWeightKg);
    }
  } catch (err) {
    isDispensing = false;
    document.getElementById("btnStartDispensing").disabled = false;
    document.getElementById("btnEmergencyStop").style.display = "none";
    window.NP_COMMON.showToast("error", "Hardware Error", err.message);
  }
}

/**
 * Emergency stop trigger.
 */
async function handleEmergencyStop() {
  try {
    if (window.NPHardware) {
      await window.NPHardware.emergencyStop();
    }
    isDispensing = false;
    updateServoUI("CLOSED");
    document.getElementById("btnStartDispensing").disabled = false;
    document.getElementById("btnEmergencyStop").style.display = "none";
    window.NP_COMMON.showToast("warning", "Emergency Stop", "Dispensing interrupted. Servo gate closed immediately.");
  } catch (err) {
    console.error("Stop error:", err);
  }
}

/**
 * Handles live weight updates from HX711 via ESP32.
 */
function handleLiveWeightUpdate(value, unit, stable) {
  liveMeasuredWeight = value;
  isWeightStable = stable;
  updateWeightDisplay(value, unit, stable);
}

function updateWeightDisplay(val, unit = "kg", stable = true) {
  const lcdValEl = document.getElementById("lcdLiveWeightValue");
  const lcdUnitEl = document.getElementById("lcdLiveWeightUnit");
  const stabilityEl = document.getElementById("lcdStabilityStatus");

  if (lcdValEl) lcdValEl.textContent = val.toFixed(2);
  if (lcdUnitEl) lcdUnitEl.textContent = unit.toUpperCase();
  if (stabilityEl) {
    stabilityEl.textContent = stable ? "STABLE" : "WEIGHING...";
    stabilityEl.className = `stability-pill ${stable ? 'stable' : ''}`;
  }
}

function updateServoUI(state) {
  const wrapper = document.getElementById("servoIconWrapper");
  const statusEl = document.getElementById("servoStateStatus");
  const angleEl = document.getElementById("servoAngleLabel");

  if (state === "OPEN") {
    if (wrapper) wrapper.className = "servo-icon-wrapper open";
    if (statusEl) statusEl.textContent = "GATE OPEN";
    if (angleEl) angleEl.textContent = "Servo Position: 90° (Dispensing)";
  } else {
    if (wrapper) wrapper.className = "servo-icon-wrapper closed";
    if (statusEl) statusEl.textContent = "GATE CLOSED";
    if (angleEl) angleEl.textContent = "Servo Position: 0° (Locked)";
  }
}

/**
 * Finalize dispensing after servo closes and stable weight is confirmed.
 * Implements requirement: NEVER deduct stock using requested quantity alone; USE VALIDATED ACTUAL MEASURED WEIGHT.
 */
async function finalizeDispensingProcess() {
  if (!isDispensing) return;
  isDispensing = false;

  document.getElementById("btnStartDispensing").disabled = false;
  document.getElementById("btnEmergencyStop").style.display = "none";

  const actualWeight = liveMeasuredWeight > 0 ? liveMeasuredWeight : targetWeightKg;
  const item = currentEntitlements[selectedProductId];
  const prodName = item.productName;
  const unit = item.unit;

  window.NP_COMMON.showToast("info", "Processing Record", `Final measured weight: ${actualWeight} ${unit}. Updating cloud ledger...`);

  const db = window.NP_FIREBASE.db;
  const now = new Date();
  const cycleId = `${activeUser.id}_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    // ATOMIC TRANSACTION: Stock deduction + Entitlement Update + Transaction Document
    await db.runTransaction(async (transaction) => {
      const prodRef = db.collection("products").doc(selectedProductId);
      const cycleRef = db.collection("distribution_cycles").doc(cycleId);
      const txRef = db.collection("transactions").doc();

      const prodDoc = await transaction.get(prodRef);
      if (!prodDoc.exists) throw new Error("Product record does not exist!");

      const currentStock = prodDoc.data().availableStock || 0;
      if (currentStock < actualWeight) {
        throw new Error(`Insufficient inventory: ${currentStock} ${unit} remaining.`);
      }

      // 1. Deduct actual measured quantity from inventory
      const newStock = Math.max(0, Math.round((currentStock - actualWeight) * 100) / 100);
      transaction.update(prodRef, {
        availableStock: newStock,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // 2. Update monthly entitlement
      const cycleDoc = await transaction.get(cycleRef);
      const ents = cycleDoc.exists ? (cycleDoc.data().entitlements || {}) : {};
      const currentEnt = ents[selectedProductId] || { allocated: targetWeightKg, distributed: 0 };
      const newDistributed = Math.round((currentEnt.distributed + actualWeight) * 100) / 100;

      ents[selectedProductId] = {
        ...currentEnt,
        distributed: newDistributed,
        status: newDistributed >= currentEnt.allocated ? "completed" : "pending"
      };

      transaction.set(cycleRef, {
        userId: activeUser.id,
        monthYear: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
        entitlements: ents,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // 3. Create permanent transaction record
      transaction.set(txRef, {
        transactionId: "TXN" + Date.now().toString().slice(-8),
        userId: activeUser.id,
        userName: activeUser.name,
        rfidUid: activeUser.rfidUid,
        aadhaar: activeUser.aadhaar,
        productId: selectedProductId,
        productName: prodName,
        targetQuantity: targetWeightKg,
        actualQuantity: actualWeight,
        unit: unit,
        status: "COMPLETED",
        adminEmail: window.NP_FIREBASE.auth.currentUser ? window.NP_FIREBASE.auth.currentUser.email : "PDS Official",
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        hardwareConfirmed: true
      });
    });

    window.NP_COMMON.showToast("success", "Distribution Successful",
      `Dispensed ${actualWeight} ${unit} of ${prodName}. Ledger updated.`);

    // Refresh quota view
    await loadUserCycle(activeUser.id);

    // Show printable receipt modal
    showReceiptModal({
      userName: activeUser.name,
      aadhaar: activeUser.aadhaar,
      rfidUid: activeUser.rfidUid,
      productName: prodName,
      quantity: actualWeight,
      unit: unit,
      date: new Date().toLocaleString("en-IN")
    });

  } catch (err) {
    console.error("Distribution transaction error:", err);
    window.NP_COMMON.showToast("error", "Ledger Error", err.message);
  }
}

/**
 * Checks if all monthly products have been collected.
 */
function checkAllEntitlementsCompleted() {
  const keys = Object.keys(currentEntitlements);
  if (keys.length === 0) return;

  const allDone = keys.every(k => {
    const item = currentEntitlements[k];
    return item.distributed >= item.allocated;
  });

  const completionBanner = document.getElementById("monthlyCompleteBanner");
  if (allDone) {
    if (completionBanner) {
      completionBanner.style.display = "block";
      completionBanner.innerHTML = `
        <div style="background:var(--tn-green-50); border:2px solid var(--tn-green-600); border-radius:12px; padding:20px; text-align:center;">
          <h3 style="color:var(--tn-green-900); font-weight:800; margin-bottom:4px;">THANK YOU FOR COLLECTING YOUR RATION!</h3>
          <p style="color:var(--tn-green-700); font-family:var(--font-tamil); font-weight:700;">உங்கள் மாதாந்திர பங்கீடு முழுமையாக வழங்கப்பட்டுவிட்டது.</p>
          <p style="font-size:0.85rem; color:var(--slate-600); margin-top:8px;">YOUR MONTHLY DISTRIBUTION IS COMPLETE. No further quota remains for this cycle.</p>
        </div>
      `;
    }
  } else {
    if (completionBanner) completionBanner.style.display = "none";
  }
}

function showReceiptModal(data) {
  document.getElementById("rcptUserName").textContent = data.userName;
  document.getElementById("rcptAadhaar").textContent = window.NP_COMMON.maskAadhaar(data.aadhaar);
  document.getElementById("rcptRfid").textContent = window.NP_COMMON.maskRfid(data.rfidUid);
  document.getElementById("rcptItem").textContent = data.productName;
  document.getElementById("rcptQty").textContent = `${data.quantity} ${data.unit}`;
  document.getElementById("rcptDate").textContent = data.date;

  window.NP_COMMON.openModal("modalReceipt");
}

window.selectCommodityForDispense = selectCommodityForDispense;
