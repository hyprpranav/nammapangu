/**
 * NAMMAPANGU - REPORTS & EXPORT GENERATOR MODULE
 * Real-time Firestore Aggregations, CSV/Excel Export & Printable Audits
 */

let reportRecords = [];

document.addEventListener("DOMContentLoaded", () => {
  initReportsPage();
  setupReportEvents();
});

function initReportsPage() {
  const dateInput = document.getElementById("reportDateInput");
  if (dateInput) {
    const today = new Date().toISOString().split("T")[0];
    dateInput.value = today;
  }

  generateSelectedReport();
}

function setupReportEvents() {
  const btnGenerate = document.getElementById("btnGenerateReport");
  if (btnGenerate) {
    btnGenerate.addEventListener("click", generateSelectedReport);
  }

  const btnExportCsv = document.getElementById("btnExportCsv");
  if (btnExportCsv) {
    btnExportCsv.addEventListener("click", exportReportToCsv);
  }

  const btnPrint = document.getElementById("btnPrintReport");
  if (btnPrint) {
    btnPrint.addEventListener("click", () => window.print());
  }
}

/**
 * Generates report by querying actual Firestore collections.
 */
async function generateSelectedReport() {
  const reportType = document.getElementById("reportTypeSelect").value;
  const dateVal = document.getElementById("reportDateInput").value;
  const tbody = document.getElementById("reportOutputTableBody");
  const summaryEl = document.getElementById("reportSummaryHeader");

  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" class="text-muted" style="text-align:center; padding:24px;">Querying Cloud Firestore records...</td></tr>`;

  const db = window.NP_FIREBASE.db;
  if (!db) return;

  try {
    if (reportType === "daily" || reportType === "weekly" || reportType === "monthly") {
      let startDate = new Date(dateVal);
      startDate.setHours(0, 0, 0, 0);

      let endDate = new Date(dateVal);
      if (reportType === "daily") {
        endDate.setHours(23, 59, 59, 999);
      } else if (reportType === "weekly") {
        startDate = new Date(startDate.getTime() - 6 * 86400000);
        endDate.setHours(23, 59, 59, 999);
      } else if (reportType === "monthly") {
        startDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0, 23, 59, 59);
      }

      const snap = await db.collection("transactions")
        .where("timestamp", ">=", startDate)
        .where("timestamp", "<=", endDate)
        .orderBy("timestamp", "desc")
        .get();

      reportRecords = [];
      let totalQty = 0;
      snap.forEach(doc => {
        const d = doc.data();
        reportRecords.push(d);
        totalQty += (parseFloat(d.actualQuantity) || 0);
      });

      if (summaryEl) {
        summaryEl.innerHTML = `
          <strong>${reportType.toUpperCase()} DISTRIBUTION REPORT</strong> |
          ${startDate.toLocaleDateString("en-IN")} to ${endDate.toLocaleDateString("en-IN")} |
          Total Records: <strong>${reportRecords.length}</strong> | Total Distributed: <strong>${totalQty.toFixed(2)} KG</strong>
        `;
      }

      renderReportTableRows(reportRecords);

    } else if (reportType === "replenishment") {
      const snap = await db.collection("stock_movements")
        .orderBy("timestamp", "desc")
        .limit(100)
        .get();

      reportRecords = [];
      snap.forEach(doc => reportRecords.push(doc.data()));

      if (summaryEl) {
        summaryEl.innerHTML = `<strong>STOCK REPLENISHMENT AUDIT REPORT</strong> | Total Records: <strong>${reportRecords.length}</strong>`;
      }

      renderReplenishmentRows(reportRecords);
    } else {
      // Product-wise inventory report
      const snap = await db.collection("products").get();
      reportRecords = [];
      snap.forEach(doc => reportRecords.push(doc.data()));

      if (summaryEl) {
        summaryEl.innerHTML = `<strong>CURRENT WAREHOUSE INVENTORY AUDIT</strong> | Total Commodities: <strong>${reportRecords.length}</strong>`;
      }

      renderInventoryReportRows(reportRecords);
    }

  } catch (err) {
    console.error("Report generation error:", err);
    tbody.innerHTML = `<tr><td colspan="7" class="text-danger" style="text-align:center; padding:16px;">Failed to generate report: ${err.message}</td></tr>`;
  }
}

function renderReportTableRows(records) {
  const tbody = document.getElementById("reportOutputTableBody");
  if (!tbody) return;

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><div class="empty-title">No Records Found for Selected Period</div></td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(r => {
    const timeStr = r.timestamp && r.timestamp.toDate ? r.timestamp.toDate().toLocaleString("en-IN") : "N/A";
    return `
      <tr>
        <td><code>${window.NP_COMMON.escapeHtml(r.transactionId || "TXN")}</code></td>
        <td><strong>${window.NP_COMMON.escapeHtml(r.userName)}</strong></td>
        <td><code>${window.NP_COMMON.maskRfid(r.rfidUid)}</code></td>
        <td>${window.NP_COMMON.escapeHtml(r.productName)}</td>
        <td><strong>${r.actualQuantity} ${r.unit}</strong></td>
        <td>${timeStr}</td>
        <td><span class="badge badge-success">${r.status || 'COMPLETED'}</span></td>
      </tr>
    `;
  }).join("");
}

function renderReplenishmentRows(records) {
  const tbody = document.getElementById("reportOutputTableBody");
  if (!tbody) return;

  tbody.innerHTML = records.map(r => {
    const timeStr = r.timestamp && r.timestamp.toDate ? r.timestamp.toDate().toLocaleString("en-IN") : "N/A";
    return `
      <tr>
        <td><code>INWARD</code></td>
        <td><strong>${window.NP_COMMON.escapeHtml(r.productName)}</strong></td>
        <td>—</td>
        <td>Stock Inward</td>
        <td><strong class="text-success">+${r.addedQuantity} ${r.unit}</strong></td>
        <td>${timeStr}</td>
        <td><span class="badge badge-info">${window.NP_COMMON.escapeHtml(r.reference || "Chalan")}</span></td>
      </tr>
    `;
  }).join("");
}

function renderInventoryReportRows(records) {
  const tbody = document.getElementById("reportOutputTableBody");
  if (!tbody) return;

  tbody.innerHTML = records.map(r => {
    const pct = Math.round(((r.availableStock || 0) / (r.maxCapacity || 100)) * 100);
    return `
      <tr>
        <td><code>PROD</code></td>
        <td><strong>${window.NP_COMMON.escapeHtml(r.name)}</strong> (${window.NP_COMMON.escapeHtml(r.nameTa || '')})</td>
        <td>—</td>
        <td>Capacity: ${r.maxCapacity} ${r.unit}</td>
        <td><strong>${r.availableStock} ${r.unit} (${pct}%)</strong></td>
        <td>Current</td>
        <td><span class="badge ${pct <= 20 ? 'badge-warning' : 'badge-success'}">${pct <= 20 ? 'LOW' : 'OPTIMAL'}</span></td>
      </tr>
    `;
  }).join("");
}

/**
 * Export report to standard CSV / Excel-compatible format.
 */
function exportReportToCsv() {
  if (reportRecords.length === 0) {
    window.NP_COMMON.showToast("warning", "Empty Report", "No records to export.");
    return;
  }

  const headers = ["Transaction ID", "User Name", "RFID UID", "Product", "Quantity", "Unit", "Timestamp", "Status"];
  const rows = reportRecords.map(r => [
    `"${r.transactionId || 'TXN'}"`,
    `"${r.userName || ''}"`,
    `"${r.rfidUid || ''}"`,
    `"${r.productName || r.name || ''}"`,
    r.actualQuantity || r.availableStock || 0,
    `"${r.unit || 'KG'}"`,
    `"${r.timestamp && r.timestamp.toDate ? r.timestamp.toDate().toISOString() : ''}"`,
    `"${r.status || 'OK'}"`
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `NAMMAPANGU_PDS_REPORT_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.NP_COMMON.showToast("success", "Export Complete", "CSV report downloaded successfully.");
}
