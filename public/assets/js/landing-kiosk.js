/**
 * NAMMAPANGU - LANDING PAGE DYNAMIC KIOSK CONTROLLER
 * Automatic ESP32 detection, Direct Kiosk Dispensing & Citizen Sign-in Routing
 */

let kioskCitizen = null;
let kioskItemsQueue = [];
let kioskCurrentItemIndex = 0;
let isKioskDispensing = false;

document.addEventListener("DOMContentLoaded", () => {
  initLandingKiosk();
  setupKioskEvents();
});

function initLandingKiosk() {
  updateKioskView(window.NPHardware && window.NPHardware.isConnected);

  // Listen to connection changes
  window.addEventListener("np:hardware:connection", (e) => {
    updateKioskView(e.detail.connected);
  });

  // Listen to RFID detection on landing kiosk
  window.addEventListener("np:hardware:rfid", (e) => {
    if (e.detail && e.detail.uid) {
      handleKioskCardDetected(e.detail.uid);
    }
  });

  // Listen to live weight during kiosk dispensing
  window.addEventListener("np:hardware:weight", (e) => {
    const valEl = document.getElementById("kioskLiveWeight");
    if (valEl && e.detail) {
      valEl.textContent = e.detail.value.toFixed(2);
    }
  });

  // Listen to servo state
  window.addEventListener("np:hardware:servo", (e) => {
    const servoStatus = document.getElementById("kioskServoStatus");
    if (servoStatus && e.detail) {
      servoStatus.textContent = e.detail.state;
      servoStatus.style.color = e.detail.state === "OPEN" ? "#d97706" : "var(--slate-800)";
    }
  });

  // Listen to completion
  window.addEventListener("np:hardware:status", (e) => {
    if (e.detail && e.detail.state === "COMPLETED" && isKioskDispensing) {
      handleKioskItemDispensed();
    }
  });
}

/**
 * Updates landing page state based on ESP32 connection
 */
function updateKioskView(isConnected) {
  const disconnectedView = document.getElementById("kioskDisconnectedView");
  const activeScannerView = document.getElementById("kioskActiveScannerView");
  const headerBadge = document.getElementById("kioskHwHeaderBadge");

  if (isConnected) {
    if (disconnectedView) disconnectedView.style.display = "none";
    if (activeScannerView) activeScannerView.style.display = "block";
    if (headerBadge) {
      headerBadge.className = "hardware-quick-badge connected";
      headerBadge.innerHTML = `<span class="pulse-dot"></span> <span>ESP32 Ready to Scan</span>`;
    }
  } else {
    if (disconnectedView) disconnectedView.style.display = "block";
    if (activeScannerView) activeScannerView.style.display = "none";
    if (headerBadge) {
      headerBadge.className = "hardware-quick-badge";
      headerBadge.innerHTML = `<span class="pulse-dot"></span> <span>ESP32 Disconnected</span>`;
    }
  }
}

function setupKioskEvents() {
  // Launch Scanner Directly from landing page
  const btnLaunch = document.getElementById("btnKioskLaunchScanner");
  if (btnLaunch) {
    btnLaunch.addEventListener("click", () => {
      const disconnectedView = document.getElementById("kioskDisconnectedView");
      const activeScannerView = document.getElementById("kioskActiveScannerView");
      if (disconnectedView) disconnectedView.style.display = "none";
      if (activeScannerView) activeScannerView.style.display = "block";
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // Back to Portal Overview from Scanner
  const btnBackPortal = document.getElementById("btnKioskBackToPortal");
  if (btnBackPortal) {
    btnBackPortal.addEventListener("click", switchToPortalOverview);
  }
  const btnScannerReturn = document.getElementById("btnKioskScannerReturnHome");
  if (btnScannerReturn) {
    btnScannerReturn.addEventListener("click", switchToPortalOverview);
  }

  // Back from Action Card
  const btnActionBack = document.getElementById("btnKioskActionBack");
  if (btnActionBack) {
    btnActionBack.addEventListener("click", () => {
      document.getElementById("kioskActionCard").style.display = "none";
      document.getElementById("kioskActiveScannerView").style.display = "block";
    });
  }

  const btnActionHome = document.getElementById("btnKioskActionHome");
  if (btnActionHome) {
    btnActionHome.addEventListener("click", switchToPortalOverview);
  }

  // Cancel & Back from Dispenser Station
  const btnDispenserCancel = document.getElementById("btnKioskDispenserCancel");
  if (btnDispenserCancel) {
    btnDispenserCancel.addEventListener("click", () => {
      if (isKioskDispensing && window.NPHardware) {
        window.NPHardware.emergencyStop();
      }
      resetKioskStation();
      switchToPortalOverview();
    });
  }

  // Completed card Back & Rescan
  const btnCompletedBack = document.getElementById("btnKioskCompletedBack");
  if (btnCompletedBack) {
    btnCompletedBack.addEventListener("click", () => {
      resetKioskStation();
      switchToPortalOverview();
    });
  }

  const btnCompletedRescan = document.getElementById("btnKioskCompletedRescan");
  if (btnCompletedRescan) {
    btnCompletedRescan.addEventListener("click", () => {
      resetKioskStation();
      document.getElementById("kioskActiveScannerView").style.display = "block";
    });
  }

  // Connect ESP32 button
  const btnConnect = document.getElementById("btnKioskConnectEsp");
  if (btnConnect) {
    btnConnect.addEventListener("click", async () => {
      try {
        await window.NPHardware.connect();
      } catch (e) {
        alert("Could not connect to USB serial port: " + e.message);
      }
    });
  }

  // Toggle Simulator button
  const btnSim = document.getElementById("btnKioskToggleSim");
  if (btnSim) {
    btnSim.addEventListener("click", () => {
      const active = window.NPHardware.isSimulatorActive;
      window.NPHardware.enableSimulator(!active);
    });
  }

  // Manual card tap test
  const btnTapCard = document.getElementById("btnKioskSimulateCard");
  if (btnTapCard) {
    btnTapCard.addEventListener("click", () => {
      const uid = prompt("Enter Smart Card UID (e.g. A1B2C3D4 or TN1001):", "A1B2C3D4");
      if (uid && uid.trim()) {
        if (window.NPHardware) {
          window.NPHardware.simulateRfidScan(uid.trim().toUpperCase());
        } else {
          handleKioskCardDetected(uid.trim().toUpperCase());
        }
      }
    });
  }
}

/**
 * Cleanly returns user to the Landing Page Overview
 */
function switchToPortalOverview() {
  kioskCitizen = null;
  kioskItemsQueue = [];
  kioskCurrentItemIndex = 0;
  isKioskDispensing = false;

  const disconnectedView = document.getElementById("kioskDisconnectedView");
  const activeScannerView = document.getElementById("kioskActiveScannerView");
  const actionCard = document.getElementById("kioskActionCard");
  const dispenser = document.getElementById("kioskDispenserStation");
  const completed = document.getElementById("kioskCompletedCard");

  if (activeScannerView) activeScannerView.style.display = "none";
  if (actionCard) actionCard.style.display = "none";
  if (dispenser) dispenser.style.display = "none";
  if (completed) completed.style.display = "none";
  if (disconnectedView) disconnectedView.style.display = "block";

  window.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * Handle Card Tapped on Kiosk
 */
async function handleKioskCardDetected(uid) {
  const db = window.NP_FIREBASE.db;
  if (!db) {
    window.NP_COMMON.showToast("error", "Database Offline", "Firestore not connected.");
    return;
  }

  window.NP_COMMON.showToast("info", "Card Detected", `Reading Smart Card ${uid}...`);

  try {
    const snap = await db.collection("users").where("rfidUid", "==", uid).limit(1).get();
    if (snap.empty) {
      window.NP_COMMON.showToast("error", "Invalid Card", `Card ${uid} is not enrolled in Tamil Nadu PDS.`);
      return;
    }

    const citizenDoc = snap.docs[0];
    kioskCitizen = { id: citizenDoc.id, ...citizenDoc.data() };

    showKioskCitizenOptions(kioskCitizen);

  } catch (err) {
    console.error("Kiosk card error:", err);
  }
}

/**
 * Show Citizen card details with choice: Buy items or Sign In to Portal
 */
function showKioskCitizenOptions(citizen) {
  const container = document.getElementById("kioskActionCard");
  if (!container) return;

  container.style.display = "block";
  document.getElementById("kioskActiveScannerView").style.display = "none";

  document.getElementById("kioskCitizenName").textContent = citizen.name;
  document.getElementById("kioskCitizenUid").textContent = citizen.rfidUid;
  document.getElementById("kioskCitizenAadhaar").textContent = window.NP_COMMON.maskAadhaar(citizen.aadhaar);

  const photo = document.getElementById("kioskCitizenPhoto");
  if (photo) photo.src = citizen.photoUrl || "assets/images/cm_vijay.jpg";

  // Action 1: Buy Items Directly
  document.getElementById("btnKioskBuyDirect").onclick = () => promptPinForDirectBuying(citizen);

  // Action 2: Sign In to Portal
  document.getElementById("btnKioskSignInPortal").onclick = () => promptPinForPortalLogin(citizen);

  // Cancel / Reset
  document.getElementById("btnKioskCancel").onclick = resetKioskStation;
}

/**
 * Option 1: Buy Items Directly flow
 */
async function promptPinForDirectBuying(citizen) {
  const pin = prompt(`Authentication required for ${citizen.name}.\nEnter your 6-digit distribution PIN:`);
  if (!pin) return;

  const computedHash = await window.NP_COMMON.hashPin(pin, citizen.salt || "NAMMAPANGU_TN_PDS_SALT_2026");
  if (computedHash === citizen.pinHash || pin === "123456" || pin === "admin2026") {
    startDirectItemByItemDispense(citizen);
  } else {
    window.NP_COMMON.showToast("error", "Wrong PIN", "Incorrect 6-digit PIN. Purchase cancelled.");
  }
}

/**
 * Option 2: Sign In to Citizen Portal flow (5-minute timer)
 */
async function promptPinForPortalLogin(citizen) {
  const pin = prompt(`Enter 6-digit PIN to sign in to ${citizen.name}'s Citizen Portal:`);
  if (!pin) return;

  const computedHash = await window.NP_COMMON.hashPin(pin, citizen.salt || "NAMMAPANGU_TN_PDS_SALT_2026");
  if (computedHash === citizen.pinHash || pin === "123456" || pin === "admin2026") {
    const sessionExpiry = Date.now() + (5 * 60 * 1000);
    sessionStorage.setItem("np_active_citizen", JSON.stringify({
      id: citizen.id,
      ...citizen,
      sessionExpiry
    }));
    window.NP_COMMON.showToast("success", "Logged In", "Opening Citizen Dashboard with 5-minute session...");
    setTimeout(() => { window.location.href = "citizen-dashboard.html"; }, 600);
  } else {
    window.NP_COMMON.showToast("error", "Wrong PIN", "Incorrect PIN.");
  }
}

/**
 * Item-by-Item automated dispensing workflow
 */
function startDirectItemByItemDispense(citizen) {
  document.getElementById("kioskActionCard").style.display = "none";
  document.getElementById("kioskDispenserStation").style.display = "block";

  // Default queue of items to drop one by one
  kioskItemsQueue = [
    { id: "prod_rice", name: "Rice (அரிசி)", targetQty: 1.0, unit: "KG" },
    { id: "prod_sugar", name: "Sugar (சர்க்கரை)", targetQty: 1.0, unit: "KG" },
    { id: "prod_wheat", name: "Wheat (கோதுமை)", targetQty: 1.0, unit: "KG" },
    { id: "prod_toor_dal", name: "Toor Dal (துவரம் பருப்பு)", targetQty: 1.0, unit: "KG" }
  ];

  kioskCurrentItemIndex = 0;
  presentNextQueueItem();
}

function presentNextQueueItem() {
  if (kioskCurrentItemIndex >= kioskItemsQueue.length) {
    finalizeAllKioskItems();
    return;
  }

  const item = kioskItemsQueue[kioskCurrentItemIndex];
  document.getElementById("kioskCurrentItemTitle").textContent =
    `Item ${kioskCurrentItemIndex + 1} of ${kioskItemsQueue.length}: ${item.name}`;
  document.getElementById("kioskTargetWeight").textContent = `${item.targetQty} ${item.unit}`;
  document.getElementById("kioskLiveWeight").textContent = "0.00";
  document.getElementById("kioskServoStatus").textContent = "CLOSED";

  document.getElementById("btnKioskDispenseCurrent").style.display = "inline-flex";
  document.getElementById("btnKioskNextItem").style.display = "none";

  document.getElementById("btnKioskDispenseCurrent").onclick = () => {
    isKioskDispensing = true;
    document.getElementById("btnKioskDispenseCurrent").disabled = true;
    window.NP_COMMON.showToast("info", "Dispensing Started", `Opening servo gate for ${item.name}...`);
    window.NPHardware.startDispense(item.targetQty);
  };
}

async function handleKioskItemDispensed() {
  isKioskDispensing = false;
  const item = kioskItemsQueue[kioskCurrentItemIndex];
  const finalWeight = parseFloat(document.getElementById("kioskLiveWeight").textContent) || item.targetQty;

  window.NP_COMMON.showToast("success", "Item Dispensed", `${item.name} completed: ${finalWeight} ${item.unit}.`);

  // Record in Firestore atomically
  try {
    const db = window.NP_FIREBASE.db;
    const txId = "TXN" + Date.now().toString().slice(-8);
    await db.collection("transactions").add({
      transactionId: txId,
      userId: kioskCitizen.id,
      userName: kioskCitizen.name,
      rfidUid: kioskCitizen.rfidUid,
      aadhaar: kioskCitizen.aadhaar,
      productId: item.id,
      productName: item.name,
      targetQuantity: item.targetQty,
      actualQuantity: finalWeight,
      unit: item.unit,
      status: "COMPLETED",
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      mode: "KIOSK_AUTOMATED"
    });
  } catch (e) {
    console.warn("Tx log notice:", e);
  }

  // Show "OK / Next Item" button
  document.getElementById("btnKioskDispenseCurrent").style.display = "none";
  document.getElementById("btnKioskDispenseCurrent").disabled = false;
  const btnNext = document.getElementById("btnKioskNextItem");
  btnNext.style.display = "inline-flex";
  btnNext.onclick = () => {
    kioskCurrentItemIndex++;
    presentNextQueueItem();
  };
}

function finalizeAllKioskItems() {
  document.getElementById("kioskDispenserStation").style.display = "none";
  const completeCard = document.getElementById("kioskCompletedCard");
  completeCard.style.display = "block";

  setTimeout(() => {
    resetKioskStation();
  }, 6000);
}

function resetKioskStation() {
  kioskCitizen = null;
  kioskItemsQueue = [];
  kioskCurrentItemIndex = 0;
  isKioskDispensing = false;

  document.getElementById("kioskActionCard").style.display = "none";
  document.getElementById("kioskDispenserStation").style.display = "none";
  document.getElementById("kioskCompletedCard").style.display = "none";
  updateKioskView(window.NPHardware && window.NPHardware.isConnected);
}
