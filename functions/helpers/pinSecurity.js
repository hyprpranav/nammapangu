const crypto = require("crypto");

/**
 * Computes salted SHA-256 hash for 6-digit distribution PIN.
 * @param {string} pin - 6-digit PIN
 * @param {string} salt - Cryptographic salt
 * @returns {string} Hex encoded hash
 */
function hashPin(pin, salt) {
  const combined = `${pin}:${salt}`;
  return crypto.createHash("sha256").update(combined).digest("hex");
}

/**
 * Generates a random cryptographic salt.
 * @returns {string} Random hex salt
 */
function generateSalt() {
  return crypto.randomBytes(16).toString("hex");
}

module.exports = {
  hashPin,
  generateSalt
};
