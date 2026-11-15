/**
 * NAMMAPANGU - CITIZEN / BUYER DASHBOARD CONTROLLER
 * Personal Entitlement Quota, Purchase History, 5-Minute Session Guard & Export
 */

let activeCitizen = null;
let citizenPurchases = [];

document.addEventListener("DOMContentLoaded", () => {
  initCitizenDashboard();
  setupCitizenEvents();
});

function initCitizenDashboard() {
  const rawCitizen = sessionStorage.getItem("np_active_citizen");
  if (!rawCitizen) {
    window.location.href = "login.html";
    return;
  }

  try {
    activeCitizen = JSON.parse(rawCitizen);
    renderCitizenProfile(activeCitizen);
    loadCitizenEntitlements(activeCitizen.id);
    loadCitizenPurchaseHistory(activeCitizen.id);
  } catch (e) {
    console.error(e);
    window.location.href = "login.html";
  }
}

function renderCitizenProfile(citizen) {
  document.getElementById("citizenName").textContent = citizen.name || "Smart Card Citizen";
  document.getElementById("citizenAadhaar").textContent = window.NP_COMMON.maskAadhaar(citizen.aadhaar);
  document.getElementById("citizenMobile").textContent = citizen.mobile ? `+91 ${citizen.mobile}` : "N/A";
  document.getElementById("citizenPermanentUid").textContent = citizen.rfidUid ? citizen.rfidUid.toUpperCase() : "PERMANENT_UID";

  const photoEl = document.getElementById("citizenPhoto");
  if (photoEl) {
    photoEl.src = citizen.photoUrl || "assets/images/cm_vijay.jpg";
  }
}

/**
 * Loads the citizen's current month quotas
 */
async function loadCitizenEntitlements(userId) {
  const container = document.getElementById("citizenQuotaGrid");
  if (!container) return;

  const db = window.NP_FIREBASE.db;
  if (!db) return;

  const now = new Date();
  const cycleId = `${userId}_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    const doc = await db.collection("distribution_cycles").doc(cycleId).get();
    let entitlements = {};

    if (doc.exists && doc.data().entitlements) {
      entitlements = doc.data().entitlements;
    } else {
      // Default initial allocations
      entitlements = {
        prod_rice: { productName: "Rice", unit: "KG", allocated: 10, distributed: 0 },
        prod_sugar: { productName: "Sugar", unit: "KG", allocated: 1, distributed: 0 },
        prod_wheat: { productName: "Wheat", unit: "KG", allocated: 5, distributed: 0 },
        prod_toor_dal: { productName: "Toor Dal", unit: "KG", allocated: 1, distributed: 0 },
        prod_palm_oil: { productName: "Palm Oil", unit: "Litre", allocated: 1, distributed: 0 }
      };
    }

    renderQuotaCards(entitlements);

  } catch (err) {
    console.warn("Could not fetch entitlements:", err);
  }
}

function renderQuotaCards(entitlements) {
  const container = document.getElementById("citizenQuotaGrid");
  if (!container) return;

  const keys = Object.keys(entitlements);
  if (keys.length === 0) {
    container.innerHTML = `<p class="text-muted">No monthly quotas assigned.</p>`;
    return;
  }

  container.innerHTML = keys.map(k => {
    const item = entitlements[k];
    const allocated = parseFloat(item.allocated) || 0;
    const distributed = parseFloat(item.distributed) || 0;
    const remaining = Math.max(0, allocated - distributed);
    const pct = allocated > 0 ? Math.min(100, Math.round((distributed / allocated) * 100)) : 100;

    let badgeClass = "badge-success";
    let statusText = `${remaining} ${item.unit} REMAINING`;
    let barColor = "";

    if (remaining <= 0) {
      badgeClass = "badge-danger";
      statusText = "FULLY COLLECTED";
      barColor = "danger";
    }

    return `
      <div class="card" style="margin-bottom:0;">
        <div class="card-header" style="padding:12px 16px;">
          <div style="font-weight:700; font-size:1rem; color:var(--slate-900);">${window.NP_COMMON.escapeHtml(item.productName)}</div>
          <span class="badge ${badgeClass}">${statusText}</span>
        </div>
        <div class="card-body" style="padding:14px 16px;">
          <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:6px;">
            <span>Quota: <strong>${allocated} ${item.unit}</strong></span>
            <span>Collected: <strong class="text-success">${distributed} ${item.unit}</strong></span>
          </div>
          <div class="progress-track" style="height:10px;">
            <div class="progress-bar-fill ${barColor}" style="width:${pct}%;"></div>
          </div>
          <div style="text-align:right; font-size:0.72rem; color:var(--slate-500); margin-top:4px;">
            ${pct}% collected for ${new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' })}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

/**
 * Loads citizen's historical purchases from Firestore
 */
async function loadCitizenPurchaseHistory(userId) {
  const tbody = document.getElementById("citizenTxTableBody");
  if (!tbody) return;

  const db = window.NP_FIREBASE.db;
  if (!db) return;

  try {
    const snap = await db.collection("transactions")
      .where("userId", "==", userId)
      .orderBy("timestamp", "desc")
      .limit(20)
      .get();

    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-muted" style="text-align:center; padding:20px;">No purchase history found for this card.</td></tr>`;
      return;
    }

    citizenPurchases = [];
    snap.forEach(doc => citizenPurchases.push({ id: doc.id, ...doc.data() }));

    tbody.innerHTML = citizenPurchases.map(tx => {
      const dateStr = tx.timestamp && tx.timestamp.toDate
        ? tx.timestamp.toDate().toLocaleString("en-IN")
        : "Recently";

      return `
        <tr>
          <td><code>${window.NP_COMMON.escapeHtml(tx.transactionId || tx.id.slice(0, 8))}</code></td>
          <td><strong>${window.NP_COMMON.escapeHtml(tx.productName)}</strong></td>
          <td><strong class="text-success">${tx.actualQuantity} ${tx.unit}</strong></td>
          <td><span class="badge badge-success">Delivered</span></td>
          <td><span style="font-size:0.8rem; color:var(--slate-600);">${dateStr}</span></td>
          <td>
            <button class="btn btn-sm btn-secondary" onclick="printSingleReceipt('${tx.id}')">
              Print
            </button>
          </td>
        </tr>
      `;
    }).join("");

  } catch (err) {
    console.error("Could not load citizen purchases:", err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-danger" style="text-align:center; padding:16px;">Failed to load history: ${err.message}</td></tr>`;
  }
}

function setupCitizenEvents() {
  const btnLogout = document.getElementById("btnCitizenLogout");
  if (btnLogout) {
    btnLogout.addEventListener("click", (e) => {
      e.preventDefault();
      if (confirm("Are you sure you want to sign out from your Citizen Portal? / நீங்கள் வெளியேற விரும்புகிறீர்களா?")) {
        sessionStorage.removeItem("np_active_citizen");
        sessionStorage.clear();
        window.location.replace("index.html");
      }
    });
  }

  const btnExport = document.getElementById("btnExportCitizenHistory");
  if (btnExport) {
    btnExport.addEventListener("click", exportCitizenHistoryCsv);
  }

  const btnPrintPassbook = document.getElementById("btnPrintPassbook");
  if (btnPrintPassbook) {
    btnPrintPassbook.addEventListener("click", () => window.print());
  }
}

function exportCitizenHistoryCsv() {
  if (citizenPurchases.length === 0) {
    window.NP_COMMON.showToast("warning", "No Records", "No purchase transactions available to export.");
    return;
  }

  const headers = ["Transaction ID", "Commodity", "Quantity", "Unit", "Date Time", "Status"];
  const rows = citizenPurchases.map(p => [
    `"${p.transactionId || p.id}"`,
    `"${p.productName}"`,
    p.actualQuantity,
    `"${p.unit}"`,
    `"${p.timestamp && p.timestamp.toDate ? p.timestamp.toDate().toLocaleString('en-IN') : ''}"`,
    `"${p.status || 'COMPLETED'}"`
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `PDS_CITIZEN_RATION_STATEMENT_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function printSingleReceipt(txId) {
  const tx = citizenPurchases.find(p => p.id === txId);
  if (!tx) return;

  const printWin = window.open("", "_blank", "width=600,height=500");
  printWin.document.write(`
    <html>
    <head><title>PDS Receipt - ${tx.transactionId}</title></head>
    <body style="font-family:sans-serif; padding:24px; text-align:center;">
      <h3>தமிழ்நாடு அரசு – பொது விநியோகத் திட்டம்</h3>
      <h4>GOVERNMENT OF TAMIL NADU - PDS SMART RECEIPT</h4>
      <hr>
      <p><strong>Citizen:</strong> ${activeCitizen.name}</p>
      <p><strong>Smart Card UID:</strong> ${activeCitizen.rfidUid}</p>
      <p><strong>Commodity:</strong> ${tx.productName}</p>
      <p><strong>Dispensed Weight:</strong> ${tx.actualQuantity} ${tx.unit}</p>
      <p><strong>Date & Time:</strong> ${tx.timestamp && tx.timestamp.toDate ? tx.timestamp.toDate().toLocaleString('en-IN') : new Date().toLocaleString()}</p>
      <hr>
      <p style="font-size:0.8rem; color:#666;">Electronic Verification Record &bull; நன்றி!</p>
    </body>
    </html>
  `);
  printWin.document.close();
  printWin.print();
}
