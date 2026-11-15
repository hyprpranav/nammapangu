/**
 * NAMMAPANGU - COMMON SHARED UTILITIES & NAVIGATION
 */

document.addEventListener("DOMContentLoaded", () => {
  initCommonUI();
  setupAuthProtection();
  setupLiveClock();
  setupMobileDrawer();
  if (window.NP_FIREBASE) {
    if (window.NP_FIREBASE.ensureInitialProducts) {
      window.NP_FIREBASE.ensureInitialProducts();
    }
    if (window.NP_FIREBASE.ensureDefaultAdminAccount) {
      window.NP_FIREBASE.ensureDefaultAdminAccount();
    }
  }
});

/**
 * Common UI bindings across all dashboard pages.
 */
function initCommonUI() {
  // Bind all sidebar and topbar logout buttons with direct listeners
  const logoutButtons = document.querySelectorAll("#btnLogout, .btn-logout, [data-action='logout']");
  logoutButtons.forEach(btn => {
    btn.removeEventListener("click", handleLogout);
    btn.addEventListener("click", handleLogout);
  });

  // Global event delegation for logout and back-home to guarantee 100% responsiveness
  document.addEventListener("click", (e) => {
    const logoutBtn = e.target.closest("#btnLogout, .btn-logout, [data-action='logout']");
    if (logoutBtn) {
      handleLogout(e);
      return;
    }

    const backHomeBtn = e.target.closest("[data-action='back-home']");
    if (backHomeBtn) {
      e.preventDefault();
      window.location.href = "index.html";
    }
  });

  // Bind any universal Back to Home buttons
  document.querySelectorAll("[data-action='back-home']").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "index.html";
    });
  });
}

/**
 * Ensures protected admin and citizen routes are secured.
 */
function setupAuthProtection() {
  const currentPath = window.location.pathname.split("/").pop() || "index.html";
  const publicPages = ["index.html", "", "login.html", "scanner.html"];
  const citizenPages = ["citizen-dashboard.html"];

  // Handle Citizen Session Protection
  if (citizenPages.includes(currentPath)) {
    const rawCitizen = sessionStorage.getItem("np_active_citizen");
    if (!rawCitizen) {
      window.location.replace("index.html");
      return;
    }
    try {
      const citizen = JSON.parse(rawCitizen);
      const sessionExpiry = citizen.sessionExpiry || 0;
      if (Date.now() > sessionExpiry) {
        sessionStorage.removeItem("np_active_citizen");
        alert("Your 5-minute security session has expired. Returning to Home.");
        window.location.replace("index.html");
        return;
      }
      initCitizenSessionTimer(sessionExpiry);
    } catch (e) {
      window.location.replace("index.html");
      return;
    }
    return; // Done protecting citizen page
  }

  // Handle Admin Firebase Protection
  if (!window.NP_FIREBASE || !window.NP_FIREBASE.auth) {
    return;
  }

  window.NP_FIREBASE.auth.onAuthStateChanged(user => {
    const isPublicPage = publicPages.includes(currentPath);

    if (user) {
      updateAdminProfileUI(user);
      if (currentPath === "login.html") {
        window.location.replace("dashboard.html");
      }
    } else {
      if (!isPublicPage) {
        window.location.replace("index.html");
      }
    }
  });
}

/**
 * 5-Minute Citizen Session Countdown Timer
 */
function initCitizenSessionTimer(expiryTimestamp) {
  const timerBadge = document.getElementById("citizenSessionTimer");
  
  function updateTimer() {
    const timeLeftMs = expiryTimestamp - Date.now();
    if (timeLeftMs <= 0) {
      sessionStorage.removeItem("np_active_citizen");
      alert("Citizen 5-minute session expired for security. Returning to login.");
      window.location.href = "login.html";
      return;
    }

    const totalSeconds = Math.floor(timeLeftMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    if (timerBadge) {
      timerBadge.textContent = formatted;
      if (totalSeconds <= 60) {
        timerBadge.style.background = "#dc2626"; // Alert red in final minute
      }
    }
  }

  updateTimer();
  setInterval(updateTimer, 1000);
}

/**
 * Updates admin information in the sidebar.
 */
function updateAdminProfileUI(user) {
  const adminNameEl = document.querySelector(".admin-name");
  const adminRoleEl = document.querySelector(".admin-role");
  const adminAvatarEl = document.querySelector(".admin-avatar");

  if (adminNameEl) {
    adminNameEl.textContent = user.displayName || user.email.split("@")[0].toUpperCase();
  }
  if (adminRoleEl) {
    adminRoleEl.textContent = "Authorized PDS Admin";
  }
  if (adminAvatarEl) {
    const initial = (user.displayName || user.email || "A").charAt(0).toUpperCase();
    adminAvatarEl.textContent = initial;
  }
}

/**
 * Handles administrator and citizen logout cleanly and returns to Landing Page (index.html).
 */
async function handleLogout(e) {
  if (e && e.preventDefault) e.preventDefault();
  const confirmed = confirm("Are you sure you want to sign out from NAMMAPANGU? / நீங்கள் வெளியேற விரும்புகிறீர்களா?");
  if (!confirmed) return;

  try {
    if (window.NP_FIREBASE && window.NP_FIREBASE.auth) {
      await window.NP_FIREBASE.auth.signOut();
    }
  } catch (error) {
    console.warn("Sign out notice:", error);
  } finally {
    sessionStorage.clear();
    sessionStorage.removeItem("np_active_citizen");
    sessionStorage.removeItem("np_active_distribution_user");
    showToast("info", "Signed Out", "Redirecting to Home...");
    setTimeout(() => {
      window.location.replace("index.html");
    }, 300);
  }
}
window.handleLogout = handleLogout;

/**
 * Real-time clock in Tamil & English.
 */
function setupLiveClock() {
  const clockEl = document.getElementById("liveClock");
  if (!clockEl) return;

  const tamilDays = ["ஞாயிறு", "திங்கள்", "செவ்வாய்", "புதன்", "வியாழன்", "வெள்ளி", "சனி"];

  function update() {
    const now = new Date();
    const dayTa = tamilDays[now.getDay()];
    const dateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });

    clockEl.innerHTML = `<span style="color:var(--tn-green-800); font-family:var(--font-tamil); font-weight:700;">${dayTa}</span> | ${dateStr} - ${timeStr}`;
  }

  update();
  setInterval(update, 1000);
}

/**
 * Mobile drawer toggler.
 */
function setupMobileDrawer() {
  const toggleBtn = document.getElementById("mobileNavToggle");
  const sidebar = document.querySelector(".app-sidebar");
  let backdrop = document.querySelector(".sidebar-backdrop");

  if (!toggleBtn || !sidebar) return;

  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.className = "sidebar-backdrop";
    document.body.appendChild(backdrop);
  }

  toggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    backdrop.classList.toggle("active");
  });

  backdrop.addEventListener("click", () => {
    sidebar.classList.remove("open");
    backdrop.classList.remove("active");
  });
}

/**
 * Toast Notification System.
 */
function showToast(type = "info", title = "", message = "") {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  let iconSvg = "";
  if (type === "success") {
    iconSvg = `<svg class="icon-svg" style="color:var(--success)" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  } else if (type === "error") {
    iconSvg = `<svg class="icon-svg" style="color:var(--danger)" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
  } else if (type === "warning") {
    iconSvg = `<svg class="icon-svg" style="color:var(--warning)" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  } else {
    iconSvg = `<svg class="icon-svg" style="color:var(--info)" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }

  toast.innerHTML = `
    <div class="toast-icon">${iconSvg}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">
      <svg class="icon-svg" style="width:14px; height:14px" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(50px)";
    setTimeout(() => toast.remove(), 350);
  }, 4500);
}

/**
 * Masking utilities.
 */
function maskAadhaar(val) {
  if (!val) return "XXXX-XXXX-XXXX";
  const clean = val.replace(/\D/g, "");
  if (clean.length >= 4) {
    const last4 = clean.slice(-4);
    return `XXXX-XXXX-${last4}`;
  }
  return "XXXX-XXXX-XXXX";
}

function maskRfid(uid) {
  if (!uid) return "••••••••";
  if (uid.length > 4) {
    return "••••" + uid.slice(-4).toUpperCase();
  }
  return uid.toUpperCase();
}

/**
 * Cryptographic Salt Generator.
 */
function generateSalt(length = 16) {
  if (window.crypto && window.crypto.getRandomValues) {
    const array = new Uint8Array(length);
    window.crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('').substring(0, length);
  }
  return "TN_PDS_" + Math.random().toString(36).substring(2, 12);
}

/**
 * Secure Salted SHA-256 Hash for 6-Digit PIN.
 */
async function hashPin(pin, salt = "NAMMAPANGU_TN_PDS_SALT_2026") {
  const enc = new TextEncoder();
  const data = enc.encode(pin + ":" + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * HTML Escaper.
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Modal dialog controller.
 */
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("active");
    const firstInput = modal.querySelector("input, select, textarea, button");
    if (firstInput) firstInput.focus();
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("active");
  }
}

// Global modal close on Escape key or backdrop click
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.active").forEach(m => m.classList.remove("active"));
  }
});

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay")) {
    e.target.classList.remove("active");
  }
});

window.NP_COMMON = {
  showToast,
  maskAadhaar,
  maskRfid,
  generateSalt,
  hashPin,
  escapeHtml,
  openModal,
  closeModal,
  handleLogout
};
