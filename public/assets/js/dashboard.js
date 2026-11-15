/**
 * NAMMAPANGU - DASHBOARD REAL-TIME ANALYTICS MODULE
 * Real-time Firestore Metrics, Inventory Health & Transaction Feeds
 */

document.addEventListener("DOMContentLoaded", () => {
  initDashboard();
});

function initDashboard() {
  subscribeDashboardMetrics();
  loadRecentTransactions();
  loadTodayDistributionWidget();
  loadInventoryMiniList();
  setupHardwareListeners();
}

/**
 * Loads Today's Active Distribution Items Widget.
 */
function loadTodayDistributionWidget() {
  const db = window.NP_FIREBASE.db;
  const container = document.getElementById("dashTodayItemsList");
  if (!container || !db) return;

  db.collection("products").where("isAvailableToday", "==", true).onSnapshot((snap) => {
    if (snap.empty) {
      container.innerHTML = `
        <div style="width:100%; padding:10px; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; color:#b45309; font-size:0.8rem;">
          <strong>No items active for today's distribution.</strong><br>
          <a href="inventory.html" style="color:#b45309; text-decoration:underline;">Click here to select items in Inventory</a>
        </div>
      `;
      return;
    }

    container.innerHTML = snap.docs.map(doc => {
      const p = doc.data();
      return `
        <span class="badge badge-success" style="padding:6px 12px; font-size:0.8rem;">
          ${window.NP_COMMON.escapeHtml(p.name)} (${p.availableStock} ${p.unit})
        </span>
      `;
    }).join("");
  }, err => console.warn("Today items widget notice:", err));
}

/**
 * Real-time listeners for summary metric cards.
 */
function subscribeDashboardMetrics() {
  const db = window.NP_FIREBASE.db;
  if (!db) return;

  // 1. Total Registered Users
  db.collection("users").onSnapshot((snap) => {
    const el = document.getElementById("dashTotalUsers");
    if (el) el.textContent = snap.size;
  }, err => console.warn(err));

  // 2. Products, Stock & Low Stock Count
  db.collection("products").onSnapshot((snap) => {
    let totalStockKg = 0;
    let lowStockCount = 0;
    const totalProducts = snap.size;

    snap.forEach(doc => {
      const p = doc.data();
      const stock = parseFloat(p.availableStock) || 0;
      const max = parseFloat(p.maxCapacity) || 100;
      totalStockKg += stock;

      if (stock <= 0.2 * max) {
        lowStockCount++;
      }
    });

    const prodEl = document.getElementById("dashTotalProducts");
    const stockEl = document.getElementById("dashTotalStock");
    const lowStockEl = document.getElementById("dashLowStock");

    if (prodEl) prodEl.textContent = totalProducts;
    if (stockEl) stockEl.textContent = totalStockKg.toFixed(1);
    if (lowStockEl) lowStockEl.textContent = lowStockCount;
  }, err => console.warn(err));

  // 3. Today's Transactions & Distributed Quantity
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  db.collection("transactions")
    .where("timestamp", ">=", todayStart)
    .onSnapshot((snap) => {
      let todayCount = snap.size;
      let todayQtyKg = 0;

      snap.forEach(doc => {
        const tx = doc.data();
        todayQtyKg += (parseFloat(tx.actualQuantity) || 0);
      });

      const countEl = document.getElementById("dashTodayTransactions");
      const qtyEl = document.getElementById("dashTodayDistributed");

      if (countEl) countEl.textContent = todayCount;
      if (qtyEl) qtyEl.textContent = todayQtyKg.toFixed(2);
    }, err => {
      // Fallback if index not yet generated
      fallbackTodayMetrics();
    });
}

async function fallbackTodayMetrics() {
  const db = window.NP_FIREBASE.db;
  try {
    const snap = await db.collection("transactions").orderBy("timestamp", "desc").limit(50).get();
    const todayStr = new Date().toDateString();
    let count = 0;
    let qty = 0;

    snap.forEach(doc => {
      const d = doc.data();
      if (d.timestamp && d.timestamp.toDate && d.timestamp.toDate().toDateString() === todayStr) {
        count++;
        qty += (parseFloat(d.actualQuantity) || 0);
      }
    });

    const countEl = document.getElementById("dashTodayTransactions");
    const qtyEl = document.getElementById("dashTodayDistributed");
    if (countEl) countEl.textContent = count;
    if (qtyEl) qtyEl.textContent = qty.toFixed(2);
  } catch (e) {
    console.warn("Fallback metric error:", e);
  }
}

/**
 * Loads recent distribution transactions table.
 */
function loadRecentTransactions() {
  const db = window.NP_FIREBASE.db;
  const tbody = document.getElementById("dashRecentTxTable");
  if (!tbody || !db) return;

  db.collection("transactions")
    .orderBy("timestamp", "desc")
    .limit(6)
    .onSnapshot((snap) => {
      if (snap.empty) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-muted" style="text-align:center; padding:16px;">No distribution transactions recorded yet today.</td></tr>`;
        return;
      }

      tbody.innerHTML = snap.docs.map(doc => {
        const tx = doc.data();
        const timeStr = tx.timestamp && tx.timestamp.toDate
          ? tx.timestamp.toDate().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
          : "Recently";

        return `
          <tr>
            <td><strong>${window.NP_COMMON.escapeHtml(tx.userName)}</strong></td>
            <td>${window.NP_COMMON.escapeHtml(tx.productName)}</td>
            <td><span class="text-bold text-success">${tx.actualQuantity} ${tx.unit}</span></td>
            <td><span class="badge badge-success">Delivered</span></td>
            <td><span class="text-muted" style="font-size:0.75rem;">${timeStr}</span></td>
          </tr>
        `;
      }).join("");
    });
}

/**
 * Loads mini inventory progress bars.
 */
function loadInventoryMiniList() {
  const db = window.NP_FIREBASE.db;
  const container = document.getElementById("dashInventoryMiniList");
  if (!container || !db) return;

  db.collection("products").limit(6).onSnapshot((snap) => {
    if (snap.empty) {
      container.innerHTML = `<p class="text-muted">No commodities tracked.</p>`;
      return;
    }

    container.innerHTML = snap.docs.map(doc => {
      const p = doc.data();
      const stock = parseFloat(p.availableStock) || 0;
      const max = parseFloat(p.maxCapacity) || 100;
      const pct = Math.min(100, Math.round((stock / max) * 100));
      let barClass = "";
      if (pct <= 15) barClass = "danger";
      else if (pct <= 30) barClass = "warning";

      return `
        <div class="inventory-mini-item">
          <div class="inv-meta">
            <span class="inv-name">${window.NP_COMMON.escapeHtml(p.name)}</span>
            <span class="inv-qty">${stock} / ${max} ${p.unit} (${pct}%)</span>
          </div>
          <div class="progress-track">
            <div class="progress-bar-fill ${barClass}" style="width:${pct}%;"></div>
          </div>
        </div>
      `;
    }).join("");
  });
}

/**
 * Loads recent user registrations.
 */
function loadRecentUsers() {
  const db = window.NP_FIREBASE.db;
  const container = document.getElementById("dashRecentUsersList");
  if (!container || !db) return;

  db.collection("users")
    .orderBy("createdAt", "desc")
    .limit(5)
    .onSnapshot((snap) => {
      if (snap.empty) {
        container.innerHTML = `<p class="text-muted">No citizens registered yet.</p>`;
        return;
      }

      container.innerHTML = snap.docs.map(doc => {
        const u = doc.data();
        const photo = u.photoUrl || "assets/images/cm_vijay.jpg";
        return `
          <div class="activity-item">
            <img src="${photo}" alt="" style="width:34px; height:34px; border-radius:50%; object-fit:cover;" onerror="this.src='assets/images/cm_vijay.jpg'">
            <div class="activity-details">
              <div class="activity-title">${window.NP_COMMON.escapeHtml(u.name)}</div>
              <div class="activity-subtitle">${window.NP_COMMON.maskAadhaar(u.aadhaar)} | UID: ${window.NP_COMMON.maskRfid(u.rfidUid)}</div>
            </div>
            <span class="badge ${u.status === 'blocked' ? 'badge-danger' : 'badge-success'}">${u.status}</span>
          </div>
        `;
      }).join("");
    });
}

function setupHardwareListeners() {
  const statusEl = document.getElementById("dashHwState");
  if (!statusEl) return;

  function update() {
    if (window.NPHardware && window.NPHardware.isConnected) {
      statusEl.innerHTML = `<span class="badge badge-success">ESP32 Online (Serial 115200)</span>`;
    } else {
      statusEl.innerHTML = `<span class="badge badge-warning">ESP32 Offline (Simulator Mode Ready)</span>`;
    }
  }

  update();
  window.addEventListener("np:hardware:connection", update);
}
