/**
 * NAMMAPANGU - SMART CARD SCANNING & KIOSK MODULE (ATM CONTINUOUS MODE)
 * Continuous RFID Scanner, One-Card One-Session, PIN Authentication, Today's Items Dispenser
 */

let isScannerArmed = false;
let isSessionActive = false;
let activeScannedUser = null;
let enteredPinDigits = [];
let failedPinAttempts = 0;
const MAX_PIN_ATTEMPTS = 3;
let isCardLockedOut = false;

// Dispenser State
let todayProductsQueue = [];
let currentQueueIndex = 0;
let isDispensingItem = false;
let dispensedItemsSummary = [];

document.addEventListener("DOMContentLoaded", () => {
  initScannerKiosk();
  setupScannerEventListeners();
});

/**
 * Initializes the Scanner Page.
 */
function initScannerKiosk() {
  updateScannerUIState("STANDBY", "READY TO SCAN", "Click START SCANNING to activate the RFID Smart Card reader.");

  // Hardware connection listener
  if (window.NPHardware) {
    updateHwStatus(window.NPHardware.isConnected);
    window.addEventListener("np:hardware:connection", (e) => {
      updateHwStatus(e.detail.connected);
    });
  }

  // Listen to live RFID events from ESP32 Web Serial or Simulator
  window.addEventListener("np:hardware:rfid", (e) => {
    if (e.detail && e.detail.uid) {
      handleIncomingRfidCard(e.detail.uid);
    }
  });

  // Listen to Load Cell live weight events
  window.addEventListener("np:hardware:weight", (e) => {
    if (e.detail && isDispensingItem) {
      handleLiveWeightReadout(e.detail.value, e.detail.unit, e.detail.stable);
    }
  });

  // Listen to Servo Gate events
  window.addEventListener("np:hardware:servo", (e) => {
    if (e.detail && e.detail.state) {
      const servoEl = document.getElementById("kioskServoStatus");
      if (servoEl) {
        servoEl.textContent = e.detail.state;
        servoEl.style.color = e.detail.state === "OPEN" ? "#10b981" : "#f59e0b";
      }
    }
  });

  // Listen to Status completion from ESP32
  window.addEventListener("np:hardware:status", (e) => {
    if (e.detail && e.detail.state === "COMPLETED" && isDispensingItem) {
      finishCurrentItemDispense();
    }
  });
}

function updateHwStatus(connected) {
  const badge = document.getElementById("kioskHwHeaderBadge");
  if (badge) {
    if (connected) {
      badge.classList.add("connected");
      badge.innerHTML = `<span class="pulse-dot"></span> <span>ESP32 Online</span>`;
    } else {
      badge.classList.remove("connected");
      badge.innerHTML = `<span class="pulse-dot"></span> <span>ESP32 Ready</span>`;
    }
  }
}

/**
 * Setup UI Event Listeners
 */
function setupScannerEventListeners() {
  // START SCANNING Button
  const btnStart = document.getElementById("btnStartScanning");
  if (btnStart) {
    btnStart.addEventListener("click", () => {
      armContinuousScanner();
    });
  }

  // Pause Scanner Button
  const btnPause = document.getElementById("btnPauseScanning");
  if (btnPause) {
    btnPause.addEventListener("click", () => {
      disarmScanner();
    });
  }

  // Connect ESP32 Button
  const btnConnect = document.getElementById("btnConnectEspScanner");
  if (btnConnect) {
    btnConnect.addEventListener("click", async () => {
      if (window.NPHardware) {
        try {
          await window.NPHardware.connect();
          window.NP_COMMON.showToast("success", "ESP32 Connected", "Hardware linked at 115200 baud.");
        } catch (err) {
          window.NP_COMMON.showToast("warning", "Web Serial", err.message || "Could not connect to ESP32.");
        }
      }
    });
  }

  // Simulate Card Tap Trigger
  const btnSim = document.getElementById("btnSimulateScanModal");
  if (btnSim) {
    btnSim.addEventListener("click", () => {
      if (!isScannerArmed) {
        armContinuousScanner();
      }
      const demoUid = prompt("Enter RFID Card UID to tap (e.g., A1B2C3D4 or TN987654):", "A1B2C3D4");
      if (demoUid && demoUid.trim()) {
        if (window.NPHardware) {
          window.NPHardware.simulateRfidScan(demoUid.trim().toUpperCase());
        } else {
          handleIncomingRfidCard(demoUid.trim().toUpperCase());
        }
      }
    });
  }

  // PIN Keypad Buttons
  document.querySelectorAll(".pin-key[data-key]").forEach(keyBtn => {
    keyBtn.addEventListener("click", () => {
      handlePinInput(keyBtn.getAttribute("data-key"));
    });
  });

  // Physical Keyboard for PIN entry
  document.addEventListener("keydown", (e) => {
    const pinSection = document.getElementById("pinEntrySection");
    if (pinSection && pinSection.style.display !== "none" && isSessionActive) {
      if (/^[0-9]$/.test(e.key)) {
        handlePinInput(e.key);
      } else if (e.key === "Backspace") {
        handlePinInput("backspace");
      } else if (e.key === "Escape") {
        handlePinInput("clear");
      }
    }
  });

  // Choice 1: GET RATION
  const btnGetRation = document.getElementById("btnChoiceGetRation");
  const cardGetRation = document.getElementById("cardChoiceGetRation");
  if (btnGetRation) btnGetRation.addEventListener("click", startRationDispensingFlow);
  if (cardGetRation) cardGetRation.addEventListener("click", startRationDispensingFlow);

  // Choice 2: SIGN IN
  const btnSignIn = document.getElementById("btnChoiceSignIn");
  const cardSignIn = document.getElementById("cardChoiceSignIn");
  if (btnSignIn) btnSignIn.addEventListener("click", openCitizenDashboardSession);
  if (cardSignIn) cardSignIn.addEventListener("click", openCitizenDashboardSession);

  // Sign Out / Close Buttons (Reset session & re-arm scanner)
  document.querySelectorAll("#btnSignOutCloseTop, #btnSignOutCloseBottom, #btnSignOutCloseCompleted, #btnNoItemsClose, #btnAbortDispense").forEach(btn => {
    btn.addEventListener("click", () => {
      resetSessionAndArmScanner();
    });
  });

  // Unregistered Card Dismiss
  const btnDismissUnreg = document.getElementById("btnDismissUnregistered");
  if (btnDismissUnreg) {
    btnDismissUnreg.addEventListener("click", () => {
      resetSessionAndArmScanner();
    });
  }

  // Open Registration Modal with captured hardware UID
  const btnOpenReg = document.getElementById("btnOpenRegisterModal");
  if (btnOpenReg) {
    btnOpenReg.addEventListener("click", () => {
      const uid = document.getElementById("unregisteredUidDisplay").textContent.trim();
      const regInput = document.getElementById("kioskRegUid");
      if (regInput) regInput.value = uid;
      if (window.NPHardware) {
        window.NPHardware.notifyRegistering(); // GREEN LED ON while registering
      }
      window.NP_COMMON.openModal("modalRegisterUser");
    });
  }

  // Kiosk User Registration Form Submit
  const regForm = document.getElementById("kioskNewUserForm");
  if (regForm) {
    regForm.addEventListener("submit", handleKioskUserRegistration);
  }

  // Dispenser Buttons
  const btnDispenseCurrent = document.getElementById("btnDispenseCurrentItem");
  if (btnDispenseCurrent) {
    btnDispenseCurrent.addEventListener("click", triggerItemDispense);
  }

  const btnNextItem = document.getElementById("btnNextDispenseItem");
  if (btnNextItem) {
    btnNextItem.addEventListener("click", advanceToNextItem);
  }
}

/**
 * Arms the RFID scanner in continuous ATM mode.
 */
function armContinuousScanner() {
  isScannerArmed = true;
  isSessionActive = false;

  const standbyDiv = document.getElementById("scannerStandbyActions");
  const activeDiv = document.getElementById("scannerActiveActions");
  const pill = document.getElementById("scannerAtmPill");
  const pillText = document.getElementById("scannerAtmPillText");
  const lastUidEl = document.getElementById("lastScannedUidDisplay");

  if (standbyDiv) standbyDiv.style.display = "none";
  if (activeDiv) activeDiv.style.display = "flex";
  if (pill) pill.classList.add("active");
  if (pillText) pillText.textContent = "ATM SCANNER ACTIVE";
  if (lastUidEl) lastUidEl.textContent = "WAITING FOR CARD...";

  updateScannerUIState("ACTIVE", "READY TO SCAN", "Continuous RFID scanner active. Waiting for smart card tap...");

  // Send request to hardware if connected
  if (window.NPHardware && window.NPHardware.isConnected) {
    window.NPHardware.requestScan().catch(e => console.warn(e));
  }
}

/**
 * Disarms the scanner to Standby.
 */
function disarmScanner() {
  isScannerArmed = false;

  const standbyDiv = document.getElementById("scannerStandbyActions");
  const activeDiv = document.getElementById("scannerActiveActions");
  const pill = document.getElementById("scannerAtmPill");
  const pillText = document.getElementById("scannerAtmPillText");

  if (standbyDiv) standbyDiv.style.display = "flex";
  if (activeDiv) activeDiv.style.display = "none";
  if (pill) pill.classList.remove("active");
  if (pillText) pillText.textContent = "STANDBY – PRESS START";

  updateScannerUIState("STANDBY", "READY TO SCAN", "Click START SCANNING to activate the RFID Smart Card reader.");
}

/**
 * Core One-Card, One-Session RFID Handler.
 */
async function handleIncomingRfidCard(rawUid) {
  // If scanner is not armed or an active session/dispensing is in progress, ignore!
  if (!isScannerArmed || isSessionActive) {
    console.log("Card tap ignored: Session active or scanner disarmed.");
    return;
  }

  if (isCardLockedOut) {
    window.NP_COMMON.showToast("error", "Card Locked Out", "Too many failed PIN attempts. Please wait 5 minutes.");
    return;
  }

  const cleanUid = rawUid.trim().toUpperCase();
  console.log("Processing Smart Card UID:", cleanUid);

  // IMMEDIATELY LOCK SESSION & STOP FURTHER SCANS
  isSessionActive = true;
  isScannerArmed = false;

  const lastUidEl = document.getElementById("lastScannedUidDisplay");
  if (lastUidEl) lastUidEl.textContent = cleanUid;

  updateScannerUIState("PROCESSING", "CARD IDENTIFYING...", `Querying Tamil Nadu PDS database for UID: ${cleanUid}...`);

  const db = window.NP_FIREBASE.db;
  if (!db) {
    window.NP_COMMON.showToast("error", "Database Offline", "Cloud Firestore connection is not available.");
    resetSessionAndArmScanner();
    return;
  }

  try {
    const snap = await db.collection("users")
      .where("rfidUid", "==", cleanUid)
      .limit(1)
      .get();

    if (snap.empty) {
      // Unregistered Card
      displayUnregisteredCard(cleanUid);
      return;
    }

    const doc = snap.docs[0];
    const user = { id: doc.id, ...doc.data() };

    if (user.status === "blocked") {
      window.NP_COMMON.showToast("error", "Card Suspended", "This smart card is temporarily blocked by the Taluk Supply Office.");
      setTimeout(() => resetSessionAndArmScanner(), 3000);
      return;
    }

    // Valid Registered User Found!
    displayRegisteredUser(user);

  } catch (err) {
    console.error("Firestore lookup failed:", err);
    window.NP_COMMON.showToast("error", "Lookup Error", err.message);
    resetSessionAndArmScanner();
  }
}

/**
 * Displays Unregistered Card Panel.
 */
function displayUnregisteredCard(uid) {
  const heroPanel = document.getElementById("scannerHeroPanel");
  const unregPanel = document.getElementById("unregisteredCardPanel");
  const regPanel = document.getElementById("registeredUserPanel");
  const unregUidEl = document.getElementById("unregisteredUidDisplay");

  if (heroPanel) heroPanel.style.display = "none";
  if (regPanel) regPanel.style.display = "none";
  if (unregPanel) unregPanel.style.display = "block";
  if (unregUidEl) unregUidEl.textContent = uid;

  // Signal hardware: RED LED ON (Unregistered / Invalid card) + Warning Alert Beep
  if (window.NPHardware) {
    window.NPHardware.notifyUserInvalid();
  }

  window.NP_COMMON.showToast("warning", "Unregistered Card", `Smart Card UID ${uid} is not yet enrolled.`);
}

/**
 * Displays Registered Citizen Details & prompts for PIN.
 */
async function displayRegisteredUser(user) {
  activeScannedUser = user;
  enteredPinDigits = [];
  failedPinAttempts = 0;

  // Signal hardware: GREEN LED ON (User registered / valid) + 2 Confirmation Beeps
  if (window.NPHardware) {
    window.NPHardware.notifyUserValid();
  }

  // Switch panels
  document.getElementById("scannerHeroPanel").style.display = "none";
  document.getElementById("unregisteredCardPanel").style.display = "none";
  document.getElementById("registeredUserPanel").style.display = "block";

  // Stage 3A: PIN Entry is shown, Choice is hidden
  document.getElementById("pinEntrySection").style.display = "block";
  document.getElementById("actionChoiceSection").style.display = "none";

  // Fill Citizen Profile Information
  document.getElementById("citizenFullName").textContent = user.name || "N/A";
  document.getElementById("citizenAadhaarDisplay").textContent = window.NP_COMMON.maskAadhaar(user.aadhaar);
  document.getElementById("citizenMobileDisplay").textContent = user.mobile ? `+91 ${user.mobile}` : "N/A";
  document.getElementById("citizenUidDisplay").textContent = window.NP_COMMON.maskRfid(user.rfidUid);

  const photoEl = document.getElementById("citizenAvatarImg");
  if (photoEl) {
    photoEl.src = user.photoUrl || "assets/images/cm_vijay.jpg";
  }

  // Load remaining monthly quota badges
  await loadCitizenQuotaBadges(user.id);
  renderPinBoxes();
}

/**
 * Loads monthly entitlement badges for user.
 */
async function loadCitizenQuotaBadges(userId) {
  const container = document.getElementById("citizenQuotaBadges");
  if (!container) return;

  container.innerHTML = `<span class="text-muted" style="font-size:0.75rem;">Loading monthly quotas...</span>`;

  try {
    const db = window.NP_FIREBASE.db;
    const now = new Date();
    const cycleId = `${userId}_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
    const doc = await db.collection("distribution_cycles").doc(cycleId).get();

    let html = "";
    if (doc.exists && doc.data().entitlements) {
      const entitlements = doc.data().entitlements;
      for (const [key, ent] of Object.entries(entitlements)) {
        const remaining = Math.max(0, (parseFloat(ent.allocated) || 0) - (parseFloat(ent.distributed) || 0));
        html += `<span class="badge ${remaining > 0 ? 'badge-success' : 'badge-info'}" style="font-size:0.75rem;">${ent.productName}: ${remaining} ${ent.unit}</span>`;
      }
    } else {
      // Default initial allocations
      html = `
        <span class="badge badge-success" style="font-size:0.75rem;">Rice: 10 KG</span>
        <span class="badge badge-success" style="font-size:0.75rem;">Sugar: 1 KG</span>
        <span class="badge badge-success" style="font-size:0.75rem;">Wheat: 5 KG</span>
        <span class="badge badge-success" style="font-size:0.75rem;">Toor Dal: 1 KG</span>
      `;
    }
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<span class="badge badge-info" style="font-size:0.75rem;">Standard PDS Quota</span>`;
  }
}

/**
 * Handles PIN entry.
 */
async function handlePinInput(val) {
  if (!activeScannedUser || isCardLockedOut) return;

  if (val === "clear") {
    enteredPinDigits = [];
    renderPinBoxes();
    return;
  }

  if (val === "backspace") {
    if (enteredPinDigits.length > 0) {
      enteredPinDigits.pop();
      renderPinBoxes();
    }
    return;
  }

  if (enteredPinDigits.length < 6) {
    enteredPinDigits.push(val);
    renderPinBoxes();

    if (enteredPinDigits.length === 6) {
      await verifyEnteredPinHash();
    }
  }
}

function renderPinBoxes() {
  const boxes = document.querySelectorAll(".pin-box");
  boxes.forEach((box, i) => {
    if (i < enteredPinDigits.length) {
      box.textContent = "•";
      box.classList.add("filled");
    } else {
      box.textContent = "";
      box.classList.remove("filled");
    }
  });
}

/**
 * Verifies entered 6-digit PIN against user's salted hash.
 */
async function verifyEnteredPinHash() {
  const pinCode = enteredPinDigits.join("");
  const statusMsg = document.getElementById("pinStatusMsg");

  if (statusMsg) {
    statusMsg.textContent = "Verifying cryptographic PIN hash...";
    statusMsg.style.color = "var(--info)";
  }

  try {
    const computedHash = await window.NP_COMMON.hashPin(pinCode, activeScannedUser.salt || "NAMMAPANGU_TN_PDS_SALT_2026");

    if (computedHash === activeScannedUser.pinHash) {
      // PIN MATCHED!
      if (statusMsg) {
        statusMsg.textContent = "PIN Verified! Access granted.";
        statusMsg.style.color = "var(--success)";
      }
      window.NP_COMMON.showToast("success", "PIN Verified", "Please choose your desired action.");

      // UNLOCK ONLY THE TWO REQUIRED OPTIONS: GET RATION vs SIGN IN
      setTimeout(() => {
        document.getElementById("pinEntrySection").style.display = "none";
        document.getElementById("actionChoiceSection").style.display = "block";
      }, 400);

    } else {
      // INCORRECT PIN
      failedPinAttempts++;
      const left = MAX_PIN_ATTEMPTS - failedPinAttempts;
      enteredPinDigits = [];
      renderPinBoxes();

      if (left > 0) {
        if (statusMsg) {
          statusMsg.textContent = `INCORRECT PIN – TRY AGAIN (${left} attempts remaining)`;
          statusMsg.style.color = "var(--danger)";
        }
        window.NP_COMMON.showToast("error", "Incorrect PIN", `${left} attempt(s) remaining.`);
      } else {
        // 5-min lockout
        isCardLockedOut = true;
        if (statusMsg) {
          statusMsg.textContent = "CARD LOCKED OUT FOR 5 MINUTES (Too many failed attempts)";
          statusMsg.style.color = "var(--danger)";
        }
        window.NP_COMMON.showToast("error", "Account Locked", "Card locked for 5 minutes.");
        setTimeout(() => {
          isCardLockedOut = false;
          failedPinAttempts = 0;
          resetSessionAndArmScanner();
        }, 5 * 60 * 1000);
      }
    }
  } catch (err) {
    console.error("PIN verification error:", err);
    window.NP_COMMON.showToast("error", "Verification Error", err.message);
  }
}

/**
 * OPTION 2: SIGN IN TO CITIZEN DASHBOARD
 */
function openCitizenDashboardSession() {
  if (!activeScannedUser) return;

  const sessionObj = {
    id: activeScannedUser.id,
    name: activeScannedUser.name,
    rfidUid: activeScannedUser.rfidUid,
    aadhaar: activeScannedUser.aadhaar,
    mobile: activeScannedUser.mobile,
    photoUrl: activeScannedUser.photoUrl,
    sessionExpiry: Date.now() + (5 * 60 * 1000) // 5 minutes
  };

  sessionStorage.setItem("np_active_citizen", JSON.stringify(sessionObj));
  window.NP_COMMON.showToast("success", "Citizen Authenticated", "Opening citizen self-service portal (5-min session)...");

  setTimeout(() => {
    window.location.href = "citizen-dashboard.html";
  }, 400);
}

/**
 * OPTION 1: GET RATION (AUTOMATED TODAY'S ITEMS DISPENSER)
 */
async function startRationDispensingFlow() {
  if (!activeScannedUser) return;

  // Switch from profile panel to Dispenser Station
  document.getElementById("registeredUserPanel").style.display = "none";
  document.getElementById("dispenserStationPanel").style.display = "block";
  document.getElementById("dispenserCompletedPanel").style.display = "none";

  const noItemsAlert = document.getElementById("noTodayItemsAlert");
  const activeFlow = document.getElementById("activeDispenserFlow");

  // Query Firestore for TODAY'S ITEMS ONLY (`isAvailableToday == true`)
  const db = window.NP_FIREBASE.db;
  if (!db) {
    window.NP_COMMON.showToast("error", "Database Offline", "Firestore not connected.");
    return;
  }

  try {
    const snap = await db.collection("products")
      .where("isAvailableToday", "==", true)
      .get();

    todayProductsQueue = [];
    snap.forEach(doc => {
      const prod = { id: doc.id, ...doc.data() };
      if (prod.availableStock > 0) {
        todayProductsQueue.push(prod);
      }
    });

    // Check if Today's items list is empty
    if (todayProductsQueue.length === 0) {
      if (noItemsAlert) noItemsAlert.style.display = "block";
      if (activeFlow) activeFlow.style.display = "none";
      window.NP_COMMON.showToast("warning", "No Items Today", "NO ITEMS AVAILABLE TODAY. Please contact system administrator.");
      return;
    }

    // Items exist! Start dispensing queue
    if (noItemsAlert) noItemsAlert.style.display = "none";
    if (activeFlow) activeFlow.style.display = "block";

    currentQueueIndex = 0;
    dispensedItemsSummary = [];
    setupCurrentDispenseItemUI();

  } catch (err) {
    console.error("Error loading today's distribution items:", err);
    window.NP_COMMON.showToast("error", "Sync Error", err.message);
  }
}

/**
 * Sets up UI for the current item in the today's distribution queue.
 */
function setupCurrentDispenseItemUI() {
  if (currentQueueIndex >= todayProductsQueue.length) {
    showDispensingCompletionReceipt();
    return;
  }

  const currentProd = todayProductsQueue[currentQueueIndex];
  const targetWeight = parseFloat(currentProd.defaultEntitlement) || 1.00;

  document.getElementById("kioskCurrentItemTitle").textContent =
    `Item ${currentQueueIndex + 1} of ${todayProductsQueue.length}: ${currentProd.name} (${currentProd.nameTa || ""})`;
  document.getElementById("kioskQueueCounter").textContent =
    `Queue: ${currentQueueIndex + 1} / ${todayProductsQueue.length}`;
  document.getElementById("kioskTargetWeight").textContent =
    `${targetWeight.toFixed(2)} ${currentProd.unit}`;
  document.getElementById("kioskLiveWeight").textContent = "0.00";
  document.getElementById("kioskWeightUnit").textContent = currentProd.unit;
  document.getElementById("kioskServoStatus").textContent = "CLOSED";
  document.getElementById("kioskServoStatus").style.color = "#f59e0b";

  document.getElementById("btnDispenseCurrentItem").style.display = "inline-flex";
  document.getElementById("btnNextDispenseItem").style.display = "none";

  isDispensingItem = false;
}

/**
 * Triggers electronic dispensing for current item.
 */
async function triggerItemDispense() {
  const currentProd = todayProductsQueue[currentQueueIndex];
  const targetWeight = parseFloat(currentProd.defaultEntitlement) || 1.00;

  isDispensingItem = true;
  document.getElementById("btnDispenseCurrentItem").disabled = true;

  window.NP_COMMON.showToast("info", "Dispensing Started", `Dispensing ${targetWeight} ${currentProd.unit} of ${currentProd.name}...`);

  if (window.NPHardware) {
    try {
      await window.NPHardware.startDispense(targetWeight);
    } catch (e) {
      console.warn("Direct hardware command failed, triggering simulator fallback:", e);
      window.NPHardware.enableSimulator(true);
      window.NPHardware.startDispense(targetWeight);
    }
  }
}

/**
 * Live load cell readout listener.
 */
function handleLiveWeightReadout(val, unit, stable) {
  const liveEl = document.getElementById("kioskLiveWeight");
  const stabBadge = document.getElementById("kioskStabilityBadge");

  if (liveEl) liveEl.textContent = parseFloat(val).toFixed(2);
  if (stabBadge) {
    if (stable) {
      stabBadge.className = "stability-pill stable";
      stabBadge.textContent = "WEIGHT STABLE";
    } else {
      stabBadge.className = "stability-pill unstable";
      stabBadge.textContent = "WEIGHING...";
    }
  }
}

/**
 * Called when ESP32 or simulator finishes weighing current item.
 */
async function finishCurrentItemDispense() {
  isDispensingItem = false;
  const currentProd = todayProductsQueue[currentQueueIndex];
  const targetWeight = parseFloat(currentProd.defaultEntitlement) || 1.00;
  const finalWeight = parseFloat(document.getElementById("kioskLiveWeight").textContent) || targetWeight;

  // Deduct stock in Cloud Firestore atomically & log transaction
  try {
    const db = window.NP_FIREBASE.db;
    if (db) {
      const prodRef = db.collection("products").doc(currentProd.id);
      await db.runTransaction(async (transaction) => {
        const prodDoc = await transaction.get(prodRef);
        if (prodDoc.exists) {
          const currentStock = parseFloat(prodDoc.data().availableStock) || 0;
          const newStock = Math.max(0, currentStock - finalWeight);
          transaction.update(prodRef, {
            availableStock: Math.round(newStock * 100) / 100,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      });

      // Record transaction
      await db.collection("transactions").add({
        userId: activeScannedUser.id,
        userName: activeScannedUser.name,
        aadhaar: activeScannedUser.aadhaar,
        rfidUid: activeScannedUser.rfidUid,
        productId: currentProd.id,
        productName: currentProd.name,
        quantity: finalWeight,
        unit: currentProd.unit,
        type: "DISTRIBUTION",
        status: "SUCCESS",
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    dispensedItemsSummary.push({
      name: currentProd.name,
      nameTa: currentProd.nameTa,
      quantity: finalWeight,
      unit: currentProd.unit,
      time: new Date().toLocaleTimeString("en-IN")
    });

    window.NP_COMMON.showToast("success", "Item Dispensed", `Successfully dispensed ${finalWeight} ${currentProd.unit} of ${currentProd.name}.`);

  } catch (err) {
    console.error("Firestore dispense update error:", err);
  }

  // Show "Next Item" button
  document.getElementById("btnDispenseCurrentItem").style.display = "none";
  document.getElementById("btnDispenseCurrentItem").disabled = false;
  const btnNext = document.getElementById("btnNextDispenseItem");
  if (btnNext) {
    if (currentQueueIndex + 1 < todayProductsQueue.length) {
      btnNext.innerHTML = `<span>Item Dispensed! Proceed to Item ${currentQueueIndex + 2} &rarr;</span>`;
    } else {
      btnNext.innerHTML = `<span>All Items Dispensed! View Receipt &rarr;</span>`;
    }
    btnNext.style.display = "inline-flex";
  }
}

/**
 * Moves to next today's item or finishes.
 */
function advanceToNextItem() {
  currentQueueIndex++;
  setupCurrentDispenseItemUI();
}

/**
 * Displays completion receipt with dispensed items.
 */
function showDispensingCompletionReceipt() {
  document.getElementById("dispenserStationPanel").style.display = "none";
  document.getElementById("dispenserCompletedPanel").style.display = "block";

  const summaryDiv = document.getElementById("dispensedReceiptSummary");
  if (summaryDiv) {
    summaryDiv.innerHTML = `
      <div style="font-weight: 800; color: var(--tn-green-900); margin-bottom: 10px; border-bottom: 1px solid var(--tn-green-200); padding-bottom: 6px;">
        Dispensation Receipt &bull; தமிழ்நாடு பொது விநியோகம்
      </div>
      <div style="font-size: 0.85rem; color: var(--slate-700); margin-bottom: 8px;">
        Beneficiary: <strong>${activeScannedUser.name}</strong> (Smart UID: <code>${window.NP_COMMON.maskRfid(activeScannedUser.rfidUid)}</code>)
      </div>
      <table style="width: 100%; font-size: 0.85rem; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid var(--slate-200); text-align: left;">
            <th style="padding: 4px;">Commodity</th>
            <th style="padding: 4px;">Dispensed</th>
            <th style="padding: 4px;">Time</th>
          </tr>
        </thead>
        <tbody>
          ${dispensedItemsSummary.map(item => `
            <tr style="border-bottom: 1px dashed var(--slate-200);">
              <td style="padding: 6px 4px;"><strong>${item.name}</strong> (${item.nameTa || ""})</td>
              <td style="padding: 6px 4px; color: var(--tn-green-800); font-weight: 700;">${item.quantity} ${item.unit}</td>
              <td style="padding: 6px 4px; color: var(--slate-500);">${item.time}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }
}

/**
 * Resets Session and Re-arms Scanner in ATM Mode.
 * "After the user completes the process and presses SIGN OUT / CLOSE,
 * reset the session and show READY FOR NEXT SCAN. Only then enable RFID scanning again."
 */
function resetSessionAndArmScanner() {
  isSessionActive = false;
  activeScannedUser = null;
  enteredPinDigits = [];
  failedPinAttempts = 0;
  isDispensingItem = false;
  todayProductsQueue = [];
  currentQueueIndex = 0;
  dispensedItemsSummary = [];

  // Hide sub-panels
  document.getElementById("unregisteredCardPanel").style.display = "none";
  document.getElementById("registeredUserPanel").style.display = "none";
  document.getElementById("dispenserStationPanel").style.display = "none";
  document.getElementById("dispenserCompletedPanel").style.display = "none";

  // Show hero scanner panel
  const heroPanel = document.getElementById("scannerHeroPanel");
  if (heroPanel) heroPanel.style.display = "block";

  // Re-arm scanner in continuous ATM mode
  isScannerArmed = true;

  const standbyDiv = document.getElementById("scannerStandbyActions");
  const activeDiv = document.getElementById("scannerActiveActions");
  const pill = document.getElementById("scannerAtmPill");
  const pillText = document.getElementById("scannerAtmPillText");
  const lastUidEl = document.getElementById("lastScannedUidDisplay");

  if (standbyDiv) standbyDiv.style.display = "none";
  if (activeDiv) activeDiv.style.display = "flex";
  if (pill) pill.classList.add("active");
  if (pillText) pillText.textContent = "ATM SCANNER ACTIVE";
  if (lastUidEl) lastUidEl.textContent = "READY FOR NEXT SCAN";

  updateScannerUIState("READY", "READY FOR NEXT SCAN", "Continuous RFID scanner active. Waiting for next smart card tap...");

  // Signal hardware: BLUE LED ON (Scanner active / waiting for next card)
  if (window.NPHardware) {
    window.NPHardware.requestScan();
  }

  window.NP_COMMON.showToast("info", "Session Closed", "Ready for next smart card scan.");
}

/**
 * Handles Kiosk Citizen Registration when an unregistered card is tapped.
 */
async function handleKioskUserRegistration(e) {
  e.preventDefault();
  const submitBtn = document.getElementById("btnSubmitKioskUser");
  const rfidUid = document.getElementById("kioskRegUid").value.trim().toUpperCase();
  const name = document.getElementById("kioskRegName").value.trim();
  const aadhaar = document.getElementById("kioskRegAadhaar").value.trim().replace(/\s/g, "");
  const mobile = document.getElementById("kioskRegMobile").value.trim();
  const pin = document.getElementById("kioskRegPin").value.trim();
  const photoFile = document.getElementById("kioskRegPhoto").files[0];

  if (!rfidUid) {
    window.NP_COMMON.showToast("warning", "Missing RFID", "RFID UID is missing.");
    return;
  }
  if (!name || name.length < 3) {
    window.NP_COMMON.showToast("warning", "Invalid Name", "Please enter citizen full name.");
    return;
  }
  if (!/^\d{12}$/.test(aadhaar)) {
    window.NP_COMMON.showToast("warning", "Invalid Aadhaar", "Aadhaar must be exactly 12 digits.");
    return;
  }
  if (!/^\d{10}$/.test(mobile)) {
    window.NP_COMMON.showToast("warning", "Invalid Mobile", "Mobile must be a 10-digit number.");
    return;
  }
  if (!/^\d{6}$/.test(pin)) {
    window.NP_COMMON.showToast("warning", "Invalid PIN", "PIN must be exactly 6 digits.");
    return;
  }

  const db = window.NP_FIREBASE.db;
  if (!db) {
    window.NP_COMMON.showToast("error", "Database Offline", "Firestore not connected.");
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Enrolling Smart Card...";

    // Generate cryptographic salt and salted hash safely
    const salt = (window.NP_COMMON && typeof window.NP_COMMON.generateSalt === "function")
      ? window.NP_COMMON.generateSalt(16)
      : ("TN_PDS_" + Math.random().toString(36).substring(2, 10));
    const pinHash = await window.NP_COMMON.hashPin(pin, salt);

    // Optional photo upload to Cloudinary
    let photoUrl = "assets/images/cm_vijay.jpg";
    if (photoFile) {
      submitBtn.textContent = "Uploading Photograph...";
      try {
        photoUrl = await window.NP_FIREBASE.uploadImageToCloudinary(photoFile);
      } catch (pe) {
        console.warn("Photo upload notice:", pe);
      }
    }

    // Save to Firestore users collection
    submitBtn.textContent = "Saving to Cloud Firestore...";
    const newUserDoc = {
      name,
      aadhaar,
      mobile,
      rfidUid,
      pinHash,
      salt,
      photoUrl,
      status: "active",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await db.collection("users").add(newUserDoc);
    const createdUser = { id: docRef.id, ...newUserDoc };

    // Initialize current month's distribution cycle
    const now = new Date();
    const cycleId = `${docRef.id}_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
    try {
      await db.collection("distribution_cycles").doc(cycleId).set({
        userId: docRef.id,
        monthYear: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
        entitlements: {
          prod_rice: { productName: "Rice", unit: "KG", allocated: 10, distributed: 0, status: "pending" },
          prod_sugar: { productName: "Sugar", unit: "KG", allocated: 1, distributed: 0, status: "pending" },
          prod_wheat: { productName: "Wheat", unit: "KG", allocated: 5, distributed: 0, status: "pending" },
          prod_toor_dal: { productName: "Toor Dal", unit: "KG", allocated: 1, distributed: 0, status: "pending" },
          prod_palm_oil: { productName: "Palm Oil", unit: "Litre", allocated: 1, distributed: 0, status: "pending" }
        },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (ce) {
      console.warn("Cycle init notice:", ce);
    }

    window.NP_COMMON.closeModal("modalRegisterUser");
    window.NP_COMMON.showToast("success", "Citizen Enrolled", `Smart Card ${rfidUid} registered successfully!`);

    // Reset registration form
    document.getElementById("kioskNewUserForm").reset();

    // Immediately display identified user flow!
    displayRegisteredUser(createdUser);

  } catch (err) {
    console.error("Kiosk registration error:", err);
    window.NP_COMMON.showToast("error", "Enrollment Failed", err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save & Enroll Smart Card";
  }
}

/**
 * Updates UI status strings on the scanner hero.
 */
function updateScannerUIState(state, title, subtitle) {
  const titleEl = document.getElementById("scannerStatusTitle");
  const subEl = document.getElementById("scannerStatusSub");
  const badgeEl = document.getElementById("scannerStateBadge");

  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = subtitle;
  if (badgeEl) {
    badgeEl.textContent = state;
    badgeEl.className = "badge";
    if (state === "STANDBY") badgeEl.classList.add("badge-info");
    else if (state === "ACTIVE") badgeEl.classList.add("badge-success");
    else if (state === "PROCESSING") badgeEl.classList.add("badge-warning");
    else badgeEl.classList.add("badge-info");
  }
}
