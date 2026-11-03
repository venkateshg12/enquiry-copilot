import crypto from "node:crypto";
import { CONTACT_HASH_SALT } from "../constants/env";

/**
 * PII masking and redaction utilities for PaperTrail (Phase 31).
 * Full account numbers are sensitive financial data. They are stored
 * encrypted or isolated in the database, but masked everywhere else by default.
 */

/**
 * Masks a bank account number, displaying only the last 4 characters preceded by 'X's.
 * Example: "1234567890" -> "XXXXXX7890", "5432" -> "5432"
 */
export const maskAccount = (accountNumber: string | null | undefined): string => {
  if (!accountNumber) return "";
  const cleaned = String(accountNumber).trim();
  if (cleaned.length <= 4) return cleaned;
  const lastFour = cleaned.slice(-4);
  const maskedPrefix = "X".repeat(cleaned.length - 4);
  return `${maskedPrefix}${lastFour}`;
};

const SENSITIVE_KEYS = new Set([
  "accountnumber",
  "password",
  "secret",
  "creditcard",
  "token",
  "authorization",
  "apikey",
  "cookie",
]);

/**
 * Deep redaction for structured trace logs or audit metadata.
 */
export const redactForTrace = (obj: unknown): unknown => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactForTrace(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      if (lowerKey === "accountnumber" && typeof val === "string") {
        result[key] = maskAccount(val);
      } else {
        result[key] = "[redacted]";
      }
    } else if (typeof val === "object" && val !== null) {
      result[key] = redactForTrace(val);
    } else {
      result[key] = val;
    }
  }

  return result;
};

/** "ravi.kumar@gmail.com" → "r***r@gmail.com". Keeps the domain (useful for spotting spam waves). */
export const maskEmail = (email: string): string => {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const head = local.slice(0, 1);
  const tail = local.length > 2 ? local.slice(-1) : "";
  return `${head}***${tail}@${domain}`;
};

/** "+91 98765 43210" → "+91 98xxxx3210". Keeps country code and the last 4 digits. */
export const maskPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return "xxxx";
  const last4 = digits.slice(-4);
  const prefix = phone.trim().startsWith("+") ? `+${digits.slice(0, digits.length - 10)} ` : "";
  const lead = digits.slice(-10, -8);
  return `${prefix}${lead}xxxx${last4}`.trim();
};

/** A stable, non-reversible handle for one contact within this deployment: "c_3f9a1b2c". */
export const contactRef = (contact: string): string =>
  "c_" +
  crypto
    .createHash("sha256")
    .update(CONTACT_HASH_SALT + contact.trim().toLowerCase())
    .digest("hex")
    .slice(0, 8);
