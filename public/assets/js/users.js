/**
 * NAMMAPANGU - USER MANAGEMENT MODULE
 * Real-time Firestore Sync, RFID Enrollment, PIN Hashing, Photo Upload
 */

let allUsersCache = [];
let isRegistrationScanActive = false;

document.addEventListener("DOMContentLoaded", () => {
  initUsersPage();
  setupUserEventListeners();
});

function initUsersPage() {
  loadUsersRealtime();

  // Listen for RFID scan while in registration mode
  window.addEventListener("np:hardware:rfid", (e) => {
    if (isRegistrationScanActive && e.detail && e.detail.uid) {
      handleRegistrationCardDetected(e.detail.uid);
    }
  });
}

/**
 * Real-time subscription to Firestore `users` collection.
 */
function loadUsersRealtime() {
  const db = window.NP_FIREBASE.db;
  if (!db) {
    console.error("Firestore db not available");
    return;
  }

  const tableBody = document.getElementById("usersTableBody");
  if (!tableBody) return;

  db.collection("users")
    .orderBy("createdAt", "desc")
    .onSnapshot((snapshot) => {
      allUsersCache = [];
      snapshot.forEach((doc) => {
        allUsersCache.push({ id: doc.id, ...doc.data() });
      });

      renderUsersTable(allUsersCache);
      updateUserCounts();
    }, (error) => {
      console.error("Firestore user snapshot error:", error);
      window.NP_COMMON.showToast("error", "Sync Error", error.message);
    });
}

/**
 * Renders the users table with search and filtering.
 */
function renderUsersTable(users) {
  const tbody = document.getElementById("usersTableBody");
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">
          <div class="empty-title">No Users Found</div>
          <div class="empty-desc">Click 'SCAN FOR NEW USER' to register the first smart ration card holder.</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = users.map(user => {
    const regDate = user.createdAt && user.createdAt.toDate
      ? user.createdAt.toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : "Recent";
    const isBlocked = user.status === "blocked";
    const statusBadge = isBlocked
      ? `<span class="badge badge-danger">Blocked</span>`
      : `<span class="badge badge-success">Active</span>`;
    const photo = user.photoUrl || "assets/images/cm_vijay.jpg";

    return `
      <tr data-user-id="${user.id}">
        <td>
          <div class="user-cell">
            <img src="${photo}" alt="${window.NP_COMMON.escapeHtml(user.name)}" class="user-avatar-sm" onerror="this.src='assets/images/cm_vijay.jpg'">
            <div class="user-cell-meta">
              <span class="user-cell-name">${window.NP_COMMON.escapeHtml(user.name)}</span>
              <span class="user-cell-sub">ID: ${user.id.substring(0, 8)}...</span>
            </div>
          </div>
        </td>
        <td>
          <code>${window.NP_COMMON.maskRfid(user.rfidUid)}</code>
          <div style="font-size:0.65rem; color:#1d4ed8; font-weight:700;">PERMANENT ID</div>
        </td>
        <td>${window.NP_COMMON.maskAadhaar(user.aadhaar)}</td>
        <td>+91 ${window.NP_COMMON.escapeHtml(user.mobile || "N/A")}</td>
        <td>${regDate}</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="viewUserEntitlements('${user.id}')" title="View Monthly Entitlement">
            View Quota
          </button>
        </td>
        <td>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-secondary" onclick="editCitizen('${user.id}')" title="Edit citizen info (RFID is locked)">
              Edit
            </button>
            <button class="btn btn-sm ${isBlocked ? 'btn-primary' : 'btn-secondary'}" onclick="toggleUserStatus('${user.id}', '${user.status}')" title="${isBlocked ? 'Unblock' : 'Block'}">
              ${isBlocked ? 'Reactivate' : 'Block'}
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteCitizenPermanently('${user.id}', '${window.NP_COMMON.escapeHtml(user.name)}')" title="Delete citizen">
              Delete
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function setupUserEventListeners() {
  // Search input
  const searchInput = document.getElementById("searchUserInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = allUsersCache.filter(u =>
        (u.name && u.name.toLowerCase().includes(q)) ||
        (u.mobile && u.mobile.includes(q)) ||
        (u.rfidUid && u.rfidUid.toLowerCase().includes(q)) ||
        (u.aadhaar && u.aadhaar.includes(q))
      );
      renderUsersTable(filtered);
    });
  }

  // Filter dropdown
  const filterSelect = document.getElementById("filterUserStatus");
  if (filterSelect) {
    filterSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val === "all") {
        renderUsersTable(allUsersCache);
      } else {
        renderUsersTable(allUsersCache.filter(u => u.status === val));
      }
    });
  }

  // "SCAN FOR NEW USER" Button
  const btnScanNew = document.getElementById("btnScanForNewUser");
  if (btnScanNew) {
    btnScanNew.addEventListener("click", startNewUserRegistration);
  }

  // Registration Form Submit
  const regForm = document.getElementById("newUserForm");
  if (regForm) {
    regForm.addEventListener("submit", handleNewUserSubmit);
  }

  // Edit User Form Submit
  const editForm = document.getElementById("editUserForm");
  if (editForm) {
    editForm.addEventListener("submit", handleEditUserSubmit);
  }
}

/**
 * Step 1: Initiates RFID Registration Mode.
 */
function startNewUserRegistration() {
  isRegistrationScanActive = true;
  document.getElementById("regRfidUid").value = "";
  document.getElementById("regRfidStatus").innerHTML = `
    <span class="badge badge-warning" style="animation: pulseAnimation 1.5s infinite;">
      Please tap RFID Card on reader or enter UID...
    </span>
  `;

  // Request hardware to scan if connected
  if (window.NPHardware) {
    window.NPHardware.requestScan().catch(e => console.warn(e));
  }

  window.NP_COMMON.openModal("modalNewUser");
}

/**
 * Step 2: Handle incoming UID while in registration mode.
 */
function handleRegistrationCardDetected(uid) {
  if (!isRegistrationScanActive) return;
  const cleanUid = uid.trim().toUpperCase();
  const inputEl = document.getElementById("regRfidUid");
  const statusEl = document.getElementById("regRfidStatus");

  if (inputEl) inputEl.value = cleanUid;
  if (statusEl) {
    statusEl.innerHTML = `<span class="badge badge-success">Card Detected: ${cleanUid}</span>`;
  }
  window.NP_COMMON.showToast("success", "Card Detected", `Smart Card UID: ${cleanUid}`);
}

/**
 * Step 3: Handle Form Submission with validations and Firebase upload.
 */
async function handleNewUserSubmit(e) {
  e.preventDefault();
  const submitBtn = document.getElementById("btnSubmitNewUser");
  const rfidUid = document.getElementById("regRfidUid").value.trim().toUpperCase();
  const name = document.getElementById("regFullName").value.trim();
  const aadhaar = document.getElementById("regAadhaar").value.trim().replace(/\s/g, "");
  const mobile = document.getElementById("regMobile").value.trim();
  const pin = document.getElementById("regPin").value.trim();
  const photoFile = document.getElementById("regPhotoFile").files[0];

  // Validations
  if (!rfidUid) {
    window.NP_COMMON.showToast("warning", "Missing RFID", "Please scan or enter an RFID UID.");
    return;
  }
  if (!name || name.length < 3) {
    window.NP_COMMON.showToast("warning", "Invalid Name", "Full name must be at least 3 characters.");
    return;
  }
  if (!/^\d{12}$/.test(aadhaar)) {
    window.NP_COMMON.showToast("warning", "Invalid Aadhaar", "Aadhaar identifier must be exactly 12 digits.");
    return;
  }
  if (!/^\d{10}$/.test(mobile)) {
    window.NP_COMMON.showToast("warning", "Invalid Mobile", "Mobile number must be a 10-digit Indian number.");
    return;
  }
  if (!/^\d{6}$/.test(pin)) {
    window.NP_COMMON.showToast("warning", "Invalid PIN", "Distribution PIN must be exactly 6 digits.");
    return;
  }

  const db = window.NP_FIREBASE.db;
  const storage = window.NP_FIREBASE.storage;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Checking for duplicates...";

    // Check duplicate RFID
    const dupSnap = await db.collection("users").where("rfidUid", "==", rfidUid).limit(1).get();
    if (!dupSnap.empty) {
      window.NP_COMMON.showToast("error", "Duplicate Card", "This RFID UID is already registered to another citizen.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Save & Register User";
      return;
    }

    // Upload photograph to Cloudinary (FREE TIER - no Firebase billing needed)
    let photoUrl = "";
    if (photoFile) {
      submitBtn.textContent = "Uploading photograph to Cloudinary...";
      photoUrl = await window.NP_FIREBASE.uploadImageToCloudinary(photoFile);
    }

    // Hash the 6-digit PIN securely with salt
    submitBtn.textContent = "Securing PIN & creating records...";
    const salt = (window.NP_COMMON && typeof window.NP_COMMON.generateSalt === "function")
      ? window.NP_COMMON.generateSalt(16)
      : ("TN_PDS_" + Math.random().toString(36).substring(2, 10));
    const pinHash = await window.NP_COMMON.hashPin(pin, salt);

    // Save to Firestore
    const userDocRef = db.collection("users").doc();
    const newUserRecord = {
      name,
      rfidUid,
      aadhaar,
      mobile,
      photoUrl,
      pinHash,
      salt,
      status: "active",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await userDocRef.set(newUserRecord);

    // Initialize current month's distribution cycle
    const now = new Date();
    const cycleId = `${userDocRef.id}_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
    await db.collection("distribution_cycles").doc(cycleId).set({
      userId: userDocRef.id,
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

    window.NP_COMMON.showToast("success", "Citizen Registered", `${name} added to Tamil Nadu Smart Ration system.`);
    window.NP_COMMON.closeModal("modalNewUser");
    document.getElementById("newUserForm").reset();
    isRegistrationScanActive = false;

  } catch (err) {
    console.error("User registration error:", err);
    window.NP_COMMON.showToast("error", "Registration Failed", err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save & Register User";
  }
}

/**
 * Toggle Active / Blocked status of a user.
 */
async function toggleUserStatus(userId, currentStatus) {
  const newStatus = currentStatus === "blocked" ? "active" : "blocked";
  const actionName = newStatus === "blocked" ? "Block" : "Reactivate";

  if (!confirm(`Are you sure you want to ${actionName} this user?`)) return;

  try {
    const db = window.NP_FIREBASE.db;
    await db.collection("users").doc(userId).update({
      status: newStatus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Record audit log
    await db.collection("audit_logs").add({
      action: `USER_${newStatus.toUpperCase()}`,
      targetUserId: userId,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      performedBy: window.NP_FIREBASE.auth.currentUser ? window.NP_FIREBASE.auth.currentUser.email : "Admin"
    });

    window.NP_COMMON.showToast("success", "Status Updated", `User is now ${newStatus}.`);
  } catch (e) {
    console.error("Status toggle error:", e);
    window.NP_COMMON.showToast("error", "Update Failed", e.message);
  }
}

/**
 * View monthly entitlements in a modal.
 */
async function viewUserEntitlements(userId) {
  const user = allUsersCache.find(u => u.id === userId);
  if (!user) return;

  document.getElementById("quotaModalUserName").textContent = user.name;
  const content = document.getElementById("quotaModalContent");
  content.innerHTML = `<p class="text-muted">Loading quota...</p>`;
  window.NP_COMMON.openModal("modalViewQuota");

  try {
    const db = window.NP_FIREBASE.db;
    const now = new Date();
    const cycleId = `${userId}_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
    const snap = await db.collection("distribution_cycles").doc(cycleId).get();

    if (snap.exists && snap.data().entitlements) {
      const ents = snap.data().entitlements;
      content.innerHTML = Object.entries(ents).map(([k, v]) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--slate-200);">
          <div>
            <strong>${v.productName}</strong>
            <span class="text-muted" style="font-size:0.8rem">(${v.unit})</span>
          </div>
          <div>
            <span class="badge ${v.distributed >= v.allocated ? 'badge-danger' : 'badge-success'}">
              ${v.distributed} / ${v.allocated} ${v.unit} Collected
            </span>
          </div>
        </div>
      `).join("");
    } else {
      content.innerHTML = `<p class="text-muted">Standard quota applies: Rice (10KG), Sugar (1KG), Toor Dal (1KG), Palm Oil (1L).</p>`;
    }
  } catch (err) {
    content.innerHTML = `<p class="text-danger">Failed to load quota details.</p>`;
  }
}

function updateUserCounts() {
  const countEl = document.getElementById("userCountBadge");
  if (countEl) countEl.textContent = `${allUsersCache.length} Citizens`;
}

/**
 * Permanently delete citizen record (if card lost or deceased)
 */
async function deleteCitizenPermanently(userId, userName) {
  if (!confirm(`Are you sure you want to permanently delete citizen "${userName}"? This cannot be undone.`)) return;

  try {
    const db = window.NP_FIREBASE.db;
    await db.collection("users").doc(userId).delete();
    window.NP_COMMON.showToast("success", "Citizen Removed", `${userName}'s smart card record has been deleted.`);
  } catch (err) {
    console.error("Delete citizen error:", err);
    window.NP_COMMON.showToast("error", "Delete Failed", err.message);
  }
}

/**
 * Open Edit Citizen modal with permanent RFID UID locked
 */
function editCitizen(userId) {
  const user = allUsersCache.find(u => u.id === userId);
  if (!user) {
    window.NP_COMMON.showToast("warning", "Not Found", "Citizen record not loaded.");
    return;
  }

  document.getElementById("editUserId").value = user.id;
  document.getElementById("editRfidUid").value = user.rfidUid || "";
  document.getElementById("editAadhaar").value = window.NP_COMMON.maskAadhaar(user.aadhaar);
  document.getElementById("editFullName").value = user.name || "";
  document.getElementById("editMobile").value = user.mobile || "";

  const preview = document.getElementById("editCurrentPhotoPreview");
  if (preview) {
    const photo = user.photoUrl || "assets/images/cm_vijay.jpg";
    preview.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <img src="${photo}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border:1px solid var(--slate-300);">
        <span style="font-size:0.75rem; color:var(--slate-500);">Current Profile Photo</span>
      </div>
    `;
  }

  window.NP_COMMON.openModal("modalEditUser");
}

/**
 * Handle saving edited citizen details (RFID remains permanent and immutable)
 */
async function handleEditUserSubmit(e) {
  e.preventDefault();
  const userId = document.getElementById("editUserId").value;
  const name = document.getElementById("editFullName").value.trim();
  const mobile = document.getElementById("editMobile").value.trim();
  const photoFile = document.getElementById("editPhotoFile").files[0];
  const submitBtn = document.getElementById("btnSubmitEditUser");

  if (!userId || !name || !/^\d{10}$/.test(mobile)) {
    window.NP_COMMON.showToast("warning", "Invalid Input", "Please provide a valid name and 10-digit mobile number.");
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Updating Citizen...";

    const updateData = {
      name,
      mobile,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (photoFile && window.NP_FIREBASE && window.NP_FIREBASE.uploadImageToCloudinary) {
      submitBtn.textContent = "Uploading new photo to Cloudinary...";
      const newPhotoUrl = await window.NP_FIREBASE.uploadImageToCloudinary(photoFile);
      if (newPhotoUrl) {
        updateData.photoUrl = newPhotoUrl;
      }
    }

    const db = window.NP_FIREBASE.db;
    await db.collection("users").doc(userId).update(updateData);

    window.NP_COMMON.showToast("success", "Citizen Updated", `${name}'s profile details updated successfully.`);
    window.NP_COMMON.closeModal("modalEditUser");
  } catch (err) {
    console.error("Edit user error:", err);
    window.NP_COMMON.showToast("error", "Update Failed", err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save Profile Changes";
  }
}

// Global window attachments for HTML inline onclick handlers
window.toggleUserStatus = toggleUserStatus;
window.viewUserEntitlements = viewUserEntitlements;
window.deleteCitizenPermanently = deleteCitizenPermanently;
window.editCitizen = editCitizen;
