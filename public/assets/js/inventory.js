/**
 * NAMMAPANGU - INVENTORY & TODAY'S DISTRIBUTION MODULE
 * Real-time Stock Tracking, Today's Items Management & Stock Replenishment
 */

let productsCache = [];

document.addEventListener("DOMContentLoaded", () => {
  initInventoryModule();
  setupInventoryListeners();
});

function initInventoryModule() {
  loadProductsRealtime();
  loadRecentReplenishmentsRealtime();
}

/**
 * Real-time subscription to Cloud Firestore `products` collection.
 */
function loadProductsRealtime() {
  const db = window.NP_FIREBASE.db;
  if (!db) {
    console.warn("Firestore not available");
    return;
  }

  db.collection("products").onSnapshot((snapshot) => {
    productsCache = [];
    snapshot.forEach((doc) => {
      productsCache.push({ id: doc.id, ...doc.data() });
    });

    // Update product counter
    const countEl = document.getElementById("allProductsCount");
    if (countEl) countEl.textContent = `${productsCache.length} Commodities`;

    // Render both sections
    renderTodayDistributionSection(productsCache);
    renderAllInventoryCards(productsCache);

  }, (err) => {
    console.error("Products sync error:", err);
    window.NP_COMMON.showToast("error", "Sync Error", err.message);
  });
}

/**
 * Section 1: Renders Today's Distribution Items.
 * If empty, displays: "NO ITEMS AVAILABLE TODAY. Please contact the system administrator."
 */
function renderTodayDistributionSection(products) {
  const container = document.getElementById("todayItemsGrid");
  const countBadge = document.getElementById("todayCountBadge");
  if (!container) return;

  const todayItems = products.filter(p => p.isAvailableToday === true);

  if (countBadge) {
    countBadge.textContent = `${todayItems.length} Item${todayItems.length === 1 ? '' : 's'} Active`;
  }

  if (todayItems.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; background: #fffbeb; border: 2px dashed #f59e0b; border-radius: 12px; padding: 24px; text-align: center;">
        <div style="font-size: 1.15rem; font-weight: 800; color: #b45309; margin-bottom: 6px;">
          NO ITEMS AVAILABLE TODAY. Please contact the system administrator.
        </div>
        <div style="font-size: 0.9rem; color: #92400e; font-family: var(--font-tamil); font-weight: 700; margin-bottom: 10px;">
          இன்று விநியோகிக்க பொருட்கள் எதுவும் ஒதுக்கப்படவில்லை. கீழே உள்ள பொருட்களில் '+ ADD TO TODAY' என்பதைக் கிளிக் செய்து சேர்க்கவும்.
        </div>
        <p style="font-size: 0.8rem; color: #78350f; margin: 0;">
          During smart card scanning, citizens will only see items configured in this section.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = todayItems.map(item => {
    const stock = parseFloat(item.availableStock) || 0;
    const isOut = stock <= 0;

    return `
      <div class="card" style="margin-bottom:0; background:#ffffff; border: 1px solid #86efac; box-shadow: var(--shadow-sm);">
        <div class="card-header" style="background: #f0fdf4; padding: 10px 14px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight: 800; color: #166534; font-size: 0.95rem;">${window.NP_COMMON.escapeHtml(item.name)}</div>
            <div style="font-size: 0.78rem; font-family: var(--font-tamil); color: #15803d;">${window.NP_COMMON.escapeHtml(item.nameTa || "")}</div>
          </div>
          <span class="badge ${isOut ? 'badge-danger' : 'badge-success'}">${isOut ? 'Out of Stock' : 'Active Today'}</span>
        </div>
        <div class="card-body" style="padding: 14px;">
          <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom: 8px;">
            <div style="font-size: 1.35rem; font-weight: 800; color: var(--slate-900);">
              ${stock} <span style="font-size:0.8rem; color:var(--slate-500);">${item.unit}</span>
            </div>
            <span style="font-size: 0.75rem; color: var(--slate-500);">Quota: ${item.defaultEntitlement || 1} ${item.unit}</span>
          </div>

          <button class="btn btn-sm btn-secondary" style="width: 100%; color: #dc2626; border-color: #fca5a5; font-weight: 700;" onclick="toggleTodayDistribution('${item.id}', false)">
            - REMOVE FROM TODAY
          </button>
        </div>
      </div>
    `;
  }).join("");
}

/**
 * Section 2: Renders All Inventory Items (10 Items + Custom) with + ADD STOCK and + ADD TO TODAY.
 */
function renderAllInventoryCards(products) {
  const container = document.getElementById("inventoryCardsGrid");
  if (!container) return;

  if (products.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-title">No commodities configured</div></div>`;
    return;
  }

  container.innerHTML = products.map(prod => {
    const stock = parseFloat(prod.availableStock) || 0;
    const maxCap = parseFloat(prod.maxCapacity) || 100;
    const pct = Math.min(100, Math.max(0, Math.round((stock / maxCap) * 100)));

    let statusClass = "badge-success";
    let statusText = "Optimal";
    let barColor = "";

    if (stock <= 0) {
      statusClass = "badge-danger";
      statusText = "Out of Stock";
      barColor = "danger";
    } else if (pct <= 20) {
      statusClass = "badge-warning";
      statusText = "Low Stock";
      barColor = "warning";
    }

    const isToday = prod.isAvailableToday === true;

    return `
      <div class="card" style="margin-bottom:0; border-top: 4px solid ${isToday ? '#10b981' : '#cbd5e1'};">
        <div class="card-header" style="padding: 12px 16px;">
          <div>
            <div class="card-title" style="font-size: 1rem; font-weight: 800;">${window.NP_COMMON.escapeHtml(prod.name)}</div>
            <div class="card-title-ta" style="font-size: 0.8rem; color: var(--slate-500);">${window.NP_COMMON.escapeHtml(prod.nameTa || "")}</div>
          </div>
          <span class="badge ${statusClass}">${statusText}</span>
        </div>

        <div class="card-body" style="padding: 16px;">
          <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom: 8px;">
            <div style="font-size: 1.5rem; font-weight: 800; color: var(--slate-900);">
              ${stock} <span style="font-size:0.85rem; font-weight:600; color:var(--slate-500);">${prod.unit}</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--slate-500);">
              Max Cap: ${maxCap} ${prod.unit}
            </div>
          </div>

          <div class="progress-track" style="height: 10px; margin-bottom: 8px;">
            <div class="progress-bar-fill ${barColor}" style="width: ${pct}%;"></div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; font-size: 0.75rem; color: var(--slate-600); margin-bottom: 14px;">
            <span>Stock Capacity: <strong>${pct}%</strong></span>
            <span>${isToday ? '<span class="today-item-badge">&check; In Today\'s List</span>' : '<span style="color:#94a3b8;">Not in Today\'s List</span>'}</span>
          </div>

          <!-- Action Buttons: + ADD STOCK and + ADD TO TODAY -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <button class="btn btn-sm btn-primary" onclick="openAddStockModal('${prod.id}')" title="Replenish stock for this item">
              + ADD STOCK
            </button>
            <button class="btn btn-sm ${isToday ? 'btn-secondary' : 'btn-saffron'}" style="${isToday ? 'color:#dc2626; border-color:#fca5a5;' : ''}" onclick="toggleTodayDistribution('${prod.id}', ${!isToday})">
              ${isToday ? 'REMOVE TODAY' : '+ ADD TO TODAY'}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

/**
 * Toggles whether an item is active for Today's Distribution.
 */
async function toggleTodayDistribution(productId, makeAvailable) {
  const db = window.NP_FIREBASE.db;
  if (!db) return;

  try {
    await db.collection("products").doc(productId).update({
      isAvailableToday: makeAvailable,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    const prod = productsCache.find(p => p.id === productId);
    const prodName = prod ? prod.name : "Commodity";

    if (makeAvailable) {
      window.NP_COMMON.showToast("success", "Added to Today's List", `${prodName} is now active for citizen distribution.`);
    } else {
      window.NP_COMMON.showToast("info", "Removed from Today's List", `${prodName} removed from today's distribution.`);
    }

  } catch (err) {
    console.error("Error updating today status:", err);
    window.NP_COMMON.showToast("error", "Update Error", err.message);
  }
}
window.toggleTodayDistribution = toggleTodayDistribution;

/**
 * Opens + ADD STOCK modal for a specific item.
 */
function openAddStockModal(productId) {
  const prod = productsCache.find(p => p.id === productId);
  if (!prod) return;

  document.getElementById("addStockProductId").value = prod.id;
  document.getElementById("addStockProductTitle").textContent = `${prod.name} (${prod.nameTa || ""})`;
  document.getElementById("addStockCurrentValue").textContent = `${prod.availableStock} ${prod.unit}`;
  document.getElementById("addStockCapacityValue").textContent = `${prod.maxCapacity} ${prod.unit}`;
  document.getElementById("addStockUnitBadge").textContent = prod.unit;
  document.getElementById("addStockQtyInput").value = "";
  document.getElementById("addStockReferenceInput").value = "";

  window.NP_COMMON.openModal("modalAddStock");
}
window.openAddStockModal = openAddStockModal;

/**
 * Setup Event Listeners for Forms.
 */
function setupInventoryListeners() {
  // Add Stock Modal Form Submit
  const addStockForm = document.getElementById("addStockModalForm");
  if (addStockForm) {
    addStockForm.addEventListener("submit", handleAddStockSubmit);
  }

  // New Product Form Submit
  const newProductForm = document.getElementById("newProductForm");
  if (newProductForm) {
    newProductForm.addEventListener("submit", handleNewProductSubmit);
  }
}

/**
 * Handles Add Stock form submission.
 */
async function handleAddStockSubmit(e) {
  e.preventDefault();
  const submitBtn = document.getElementById("btnSubmitAddStock");
  const prodId = document.getElementById("addStockProductId").value;
  const addedQty = parseFloat(document.getElementById("addStockQtyInput").value);
  const reference = document.getElementById("addStockReferenceInput").value.trim() || "Godown Inward Refill";

  if (!prodId || isNaN(addedQty) || addedQty <= 0) {
    window.NP_COMMON.showToast("warning", "Invalid Input", "Please enter a valid positive quantity.");
    return;
  }

  const prod = productsCache.find(p => p.id === prodId);
  if (!prod) return;

  const db = window.NP_FIREBASE.db;
  if (!db) return;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Updating Cloud Firestore...";

    const currentStock = parseFloat(prod.availableStock) || 0;
    const newStock = Math.round((currentStock + addedQty) * 100) / 100;

    // 1. Update product availableStock in Firestore
    await db.collection("products").doc(prodId).update({
      availableStock: newStock,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 2. Record in stock_movements ledger
    await db.collection("stock_movements").add({
      productId: prodId,
      productName: prod.name,
      addedQuantity: addedQty,
      previousStock: currentStock,
      newStock: newStock,
      unit: prod.unit,
      reference: reference,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    window.NP_COMMON.closeModal("modalAddStock");
    window.NP_COMMON.showToast("success", "Stock Replenished", `Added ${addedQty} ${prod.unit} to ${prod.name}. New Stock: ${newStock} ${prod.unit}.`);

  } catch (err) {
    console.error("Add stock error:", err);
    window.NP_COMMON.showToast("error", "Replenishment Failed", err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Update Stock in Firebase";
  }
}

/**
 * Handles New Commodity form submission.
 */
async function handleNewProductSubmit(e) {
  e.preventDefault();
  const submitBtn = document.getElementById("btnSubmitNewProduct");
  const name = document.getElementById("newProdName").value.trim();
  const nameTa = document.getElementById("newProdNameTa").value.trim();
  const unit = document.getElementById("newProdUnit").value;
  const stock = parseFloat(document.getElementById("newProdStock").value) || 0;
  const capacity = parseFloat(document.getElementById("newProdCapacity").value) || 500;
  const quota = parseFloat(document.getElementById("newProdQuota").value) || 1;
  const isToday = document.getElementById("newProdTodayCheck").checked;

  if (!name) {
    window.NP_COMMON.showToast("warning", "Missing Name", "Please enter commodity name.");
    return;
  }

  const db = window.NP_FIREBASE.db;
  if (!db) return;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating in Firestore...";

    const prodId = "prod_" + name.toLowerCase().replace(/[^a-z0-9]/g, "_") + "_" + Date.now().toString().slice(-4);

    await db.collection("products").doc(prodId).set({
      name,
      nameTa,
      unit,
      availableStock: stock,
      maxCapacity: capacity,
      defaultEntitlement: quota,
      active: true,
      isAvailableToday: isToday,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    window.NP_COMMON.closeModal("modalNewProduct");
    document.getElementById("newProductForm").reset();
    window.NP_COMMON.showToast("success", "Commodity Created", `Added ${name} (${nameTa}) to inventory.`);

  } catch (err) {
    console.error("New product creation error:", err);
    window.NP_COMMON.showToast("error", "Creation Failed", err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Create Commodity";
  }
}

/**
 * Real-time ledger of recent stock replenishments.
 */
function loadRecentReplenishmentsRealtime() {
  const db = window.NP_FIREBASE.db;
  const tbody = document.getElementById("recentMovementsTableBody");
  if (!db || !tbody) return;

  db.collection("stock_movements")
    .orderBy("timestamp", "desc")
    .limit(10)
    .onSnapshot((snap) => {
      if (snap.empty) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-muted" style="text-align:center; padding:16px;">No recent inward deliveries recorded.</td></tr>`;
        return;
      }

      tbody.innerHTML = snap.docs.map(doc => {
        const d = doc.data();
        const dateStr = d.timestamp && d.timestamp.toDate
          ? d.timestamp.toDate().toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })
          : "Just now";

        return `
          <tr>
            <td><strong>${window.NP_COMMON.escapeHtml(d.productName || "Commodity")}</strong></td>
            <td style="color:var(--tn-green-700); font-weight:700;">+${d.addedQuantity} ${d.unit}</td>
            <td style="font-size:0.85rem; color:var(--slate-600);">${d.previousStock} &rarr; <strong>${d.newStock} ${d.unit}</strong></td>
            <td><code style="font-size:0.75rem;">${window.NP_COMMON.escapeHtml(d.reference || "N/A")}</code></td>
            <td style="font-size:0.8rem; color:var(--slate-500);">${dateStr}</td>
          </tr>
        `;
      }).join("");
    }, (e) => {
      console.warn("Stock movements notice:", e);
    });
}
