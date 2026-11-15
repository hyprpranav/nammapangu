/**
 * NAMMAPANGU - TRANSACTION AUDIT & HISTORY MODULE
 * Cloud Firestore Real-time Ledger with Date & Status Filtering
 */

let allTransactions = [];

document.addEventListener("DOMContentLoaded", () => {
  initTransactionsPage();
  setupTxFilters();
});

function initTransactionsPage() {
  loadTransactionsRealtime();
}

/**
 * Real-time subscription to `transactions` collection.
 */
function loadTransactionsRealtime() {
  const db = window.NP_FIREBASE.db;
  if (!db) return;

  const tbody = document.getElementById("transactionsTableBody");
  if (!tbody) return;

  db.collection("transactions")
    .orderBy("timestamp", "desc")
    .onSnapshot((snap) => {
      allTransactions = [];
      snap.forEach(doc => {
        allTransactions.push({ id: doc.id, ...doc.data() });
      });

      renderTransactions(allTransactions);
    }, (err) => {
      console.error("Transactions snapshot error:", err);
      window.NP_COMMON.showToast("error", "Transactions Sync Failed", err.message);
    });
}

function renderTransactions(list) {
  const tbody = document.getElementById("transactionsTableBody");
  const countEl = document.getElementById("txTotalCountBadge");
  if (!tbody) return;

  if (countEl) countEl.textContent = `${list.length} Records`;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-state">
          <div class="empty-title">No Transactions Found</div>
          <div class="empty-desc">Ration distributions will appear here automatically in real time.</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(tx => {
    const dateObj = tx.timestamp && tx.timestamp.toDate ? tx.timestamp.toDate() : new Date();
    const dateStr = dateObj.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = dateObj.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });

    return `
      <tr>
        <td><code>${window.NP_COMMON.escapeHtml(tx.transactionId || tx.id.slice(0, 8))}</code></td>
        <td>
          <strong>${window.NP_COMMON.escapeHtml(tx.userName)}</strong>
          <div style="font-size:0.72rem; color:var(--slate-500);">${window.NP_COMMON.maskAadhaar(tx.aadhaar)}</div>
        </td>
        <td><code>${window.NP_COMMON.maskRfid(tx.rfidUid)}</code></td>
        <td>${window.NP_COMMON.escapeHtml(tx.productName)}</td>
        <td>${tx.targetQuantity || 0} ${tx.unit}</td>
        <td><strong class="text-success">${tx.actualQuantity} ${tx.unit}</strong></td>
        <td>
          <div>${dateStr}</div>
          <div style="font-size:0.72rem; color:var(--slate-400);">${timeStr}</div>
        </td>
        <td><span class="badge badge-success">${tx.status || 'COMPLETED'}</span></td>
        <td><span class="text-muted" style="font-size:0.75rem;">${window.NP_COMMON.escapeHtml(tx.adminEmail || 'Admin')}</span></td>
      </tr>
    `;
  }).join("");
}

function setupTxFilters() {
  const periodFilter = document.getElementById("filterTxPeriod");
  const searchInput = document.getElementById("searchTxInput");

  if (periodFilter) {
    periodFilter.addEventListener("change", applyFilters);
  }

  if (searchInput) {
    searchInput.addEventListener("input", applyFilters);
  }

  const btnExport = document.getElementById("btnExportTxCsv");
  if (btnExport) {
    btnExport.addEventListener("click", exportTransactionsCsv);
  }

  const btnPrint = document.getElementById("btnPrintTxLedger");
  if (btnPrint) {
    btnPrint.addEventListener("click", () => window.print());
  }
}

function exportTransactionsCsv() {
  if (allTransactions.length === 0) {
    window.NP_COMMON.showToast("warning", "No Data", "No transactions recorded to export.");
    return;
  }

  const headers = ["Transaction ID", "Citizen Name", "Aadhaar", "RFID UID", "Commodity", "Target Qty", "Measured Qty", "Unit", "Timestamp", "Status", "Officer"];
  const rows = allTransactions.map(tx => [
    `"${tx.transactionId || tx.id}"`,
    `"${tx.userName || ''}"`,
    `"${tx.aadhaar || ''}"`,
    `"${tx.rfidUid || ''}"`,
    `"${tx.productName || ''}"`,
    tx.targetQuantity || 0,
    tx.actualQuantity || 0,
    `"${tx.unit || 'KG'}"`,
    `"${tx.timestamp && tx.timestamp.toDate ? tx.timestamp.toDate().toISOString() : ''}"`,
    `"${tx.status || 'COMPLETED'}"`,
    `"${tx.adminEmail || 'PDS Admin'}"`
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `NAMMAPANGU_TRANSACTIONS_LEDGER_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.NP_COMMON.showToast("success", "Export Complete", "Transactions CSV downloaded.");
}

function applyFilters() {
  const period = document.getElementById("filterTxPeriod").value;
  const q = document.getElementById("searchTxInput").value.toLowerCase().trim();

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;

  let filtered = allTransactions.filter(tx => {
    // Search match
    const matchesSearch = !q ||
      (tx.userName && tx.userName.toLowerCase().includes(q)) ||
      (tx.productName && tx.productName.toLowerCase().includes(q)) ||
      (tx.rfidUid && tx.rfidUid.toLowerCase().includes(q)) ||
      (tx.transactionId && tx.transactionId.toLowerCase().includes(q));

    if (!matchesSearch) return false;

    // Period match
    if (period === "all") return true;

    const txTime = tx.timestamp && tx.timestamp.toDate ? tx.timestamp.toDate().getTime() : 0;
    if (period === "today") {
      return txTime >= startOfToday;
    } else if (period === "yesterday") {
      return txTime >= startOfYesterday && txTime < startOfToday;
    } else if (period === "week") {
      return txTime >= (startOfToday - 7 * 86400000);
    }

    return true;
  });

  renderTransactions(filtered);
}
