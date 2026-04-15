/**
 * synthetic.test.mjs – Tests for the synthetic data generators (lib/synthetic.js)
 *
 * Each generator is verified against:
 *   - Output format (regex match or structural assertion)
 *   - Output validity (Luhn for credit cards, checksum for Israeli IDs)
 *   - Multiple iterations to rule out lucky passes on a single call
 *
 * The generateSynthetic() dispatcher is tested for correct routing per
 * category and for cache consistency (same original value → same synthetic).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generatePhone,
  generateLandline,
  generateIsraeliId,
  generateEmail,
  generateCreditCard,
  generateIBAN,
  generateIP,
  generateName,
  generateAddress,
  generateDate,
  generatePassword,
  generateAPIKey,
  generateAWSKey,
  generateSynthetic,
} from "../lib/synthetic.js";

// ── Helper validators ──────────────────────────────────────────────────────────

/** Luhn algorithm – returns true if the number is valid. */
function luhnValid(numStr) {
  const digits = numStr.replace(/\D/g, "");
  let sum = 0;
  let isOdd = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (isOdd) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    isOdd = !isOdd;
  }
  return sum % 10 === 0;
}

/** Israeli ID checksum (based on Luhn-like algorithm for 9 digits). */
function israeliIdValid(id) {
  const d = id.replace(/\D/g, "");
  if (d.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    let v = parseInt(d[i], 10) * (i % 2 === 0 ? 1 : 2);
    if (v > 9) v -= 9;
    sum += v;
  }
  return (10 - (sum % 10)) % 10 === parseInt(d[8], 10);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Synthetic Data Generators (lib/synthetic.js)", () => {
  describe("generatePhone", () => {
    it("returns Israeli mobile format 05X-XXX-XXXX", () => {
      const phone = generatePhone();
      assert.match(phone, /^05\d-\d{3}-\d{4}$/);
    });

    it("always returns the correct format (5 iterations)", () => {
      for (let i = 0; i < 5; i++) {
        assert.match(generatePhone(), /^05\d-\d{3}-\d{4}$/);
      }
    });
  });

  describe("generateLandline", () => {
    it("returns Israeli area-code format 0X-XXX-XXXX", () => {
      const line = generateLandline();
      assert.match(line, /^0(?:2|3|4|8|9)-\d{3}-\d{4}$/);
    });
  });

  describe("generateIsraeliId", () => {
    it("returns exactly 9 digits", () => {
      const id = generateIsraeliId();
      assert.match(id, /^\d{9}$/);
    });

    it("passes Israeli ID checksum (5 iterations)", () => {
      for (let i = 0; i < 5; i++) {
        const id = generateIsraeliId();
        assert.ok(
          israeliIdValid(id),
          `Generated ID ${id} failed checksum verification`
        );
      }
    });
  });

  describe("generateEmail", () => {
    it("returns a valid email-like string", () => {
      const email = generateEmail();
      assert.match(email, /^[a-z_0-9]+@[a-z.]+\.[a-z]{2,}$/);
    });

    it("always contains '@'", () => {
      for (let i = 0; i < 5; i++) {
        assert.ok(generateEmail().includes("@"));
      }
    });
  });

  describe("generateCreditCard", () => {
    it("returns a 16-digit card number (with spaces)", () => {
      const card = generateCreditCard();
      // Format: "XXXX XXXX XXXX XXXX"
      assert.match(card, /^\d{4} \d{4} \d{4} \d{4}$/);
    });

    it("generates a Luhn-valid Visa card (5 iterations)", () => {
      for (let i = 0; i < 5; i++) {
        const card = generateCreditCard();
        assert.ok(luhnValid(card), `Card ${card} failed Luhn`);
      }
    });

    it("starts with 4 (Visa BIN)", () => {
      const card = generateCreditCard();
      assert.ok(card.startsWith("4"));
    });
  });

  describe("generateIBAN", () => {
    it("starts with IL (Israeli IBAN)", () => {
      assert.ok(generateIBAN().startsWith("IL"));
    });

    it("contains digits after IL prefix", () => {
      const iban = generateIBAN();
      assert.match(iban, /^IL\d{2}/);
    });
  });

  describe("generateIP", () => {
    it("returns a private IP address (192.168.x.x or 10.x.x.x)", () => {
      const ip = generateIP();
      assert.match(ip, /^(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    });
  });

  describe("generateName", () => {
    it("returns a non-empty string with a space", () => {
      const name = generateName();
      assert.ok(name.length > 0);
      assert.ok(name.includes(" "), "name should include first + last");
    });

    it("accepts gender=male without error", () => {
      assert.doesNotThrow(() => generateName("male"));
    });

    it("accepts gender=female without error", () => {
      assert.doesNotThrow(() => generateName("female"));
    });
  });

  describe("generateAddress", () => {
    it("returns a non-empty string", () => {
      const addr = generateAddress();
      assert.ok(addr.length > 0);
    });

    it("contains a comma (street, city format)", () => {
      assert.ok(generateAddress().includes(","));
    });
  });

  describe("generateDate", () => {
    it("returns DD/MM/YYYY format", () => {
      const date = generateDate();
      assert.match(date, /^\d{2}\/\d{2}\/\d{4}$/);
    });

    it("year is in range 1960-2000", () => {
      for (let i = 0; i < 10; i++) {
        const year = parseInt(generateDate().split("/")[2], 10);
        assert.ok(year >= 1960 && year <= 2000, `Year ${year} out of expected range`);
      }
    });
  });

  describe("generatePassword", () => {
    it("returns a masked string (• characters only)", () => {
      assert.match(generatePassword(), /^•{8,12}$/);
    });
  });

  describe("generateAPIKey", () => {
    it("returns a string starting with 'sk-'", () => {
      const key = generateAPIKey();
      assert.ok(key.startsWith("sk-"));
    });

    it("returns a key longer than 20 characters", () => {
      assert.ok(generateAPIKey().length > 20);
    });
  });

  describe("generateAWSKey", () => {
    it("starts with 'AKIA'", () => {
      assert.ok(generateAWSKey().startsWith("AKIA"));
    });

    it("is exactly 20 characters long", () => {
      assert.strictEqual(generateAWSKey().length, 20);
    });

    it("contains only uppercase letters and digits after AKIA", () => {
      const key = generateAWSKey();
      assert.match(key, /^AKIA[A-Z0-9]{16}$/);
    });
  });

  describe("generateSynthetic – dispatcher", () => {
    it("PHONE category returns mobile format", () => {
      const v = generateSynthetic("PHONE", "050-000-0000", null);
      assert.match(v, /^05\d-\d{3}-\d{4}$/);
    });

    it("LANDLINE category returns landline format", () => {
      const v = generateSynthetic("LANDLINE", "03-000-0000", null);
      assert.match(v, /^0(?:2|3|4|8|9)-\d{3}-\d{4}$/);
    });

    it("EMAIL category returns an email-like value", () => {
      const v = generateSynthetic("EMAIL", "real@company.com", null);
      assert.ok(v.includes("@"));
    });

    it("CREDIT_CARD category returns Luhn-valid card", () => {
      const v = generateSynthetic("CREDIT_CARD", "4111111111111111", null);
      assert.ok(luhnValid(v));
    });

    it("ID category returns 9-digit valid Israeli ID", () => {
      const v = generateSynthetic("ID", "123456789", null);
      assert.match(v, /^\d{9}$/);
      assert.ok(israeliIdValid(v));
    });

    it("OPENAI_KEY category returns sk- prefixed key", () => {
      const v = generateSynthetic("OPENAI_KEY", "sk-real-key", null);
      assert.ok(v.startsWith("sk-"));
    });

    it("GENERIC_SECRET category returns sk- prefixed key", () => {
      const v = generateSynthetic("GENERIC_SECRET", "some-secret", null);
      assert.ok(v.startsWith("sk-"));
    });

    it("AWS_KEY category returns AKIA-prefixed key", () => {
      const v = generateSynthetic("AWS_KEY", "AKIAIOSFODNN7EXAMPLE", null);
      assert.ok(v.startsWith("AKIA"));
    });

    it("cache ensures same original value returns same synthetic", () => {
      const cache = new Map();
      const v1 = generateSynthetic("PHONE", "same-phone", cache);
      const v2 = generateSynthetic("PHONE", "same-phone", cache);
      assert.strictEqual(v1, v2, "Cached synthetic should be identical");
    });

    it("different original values return independent synthetics", () => {
      const cache = new Map();
      const v1 = generateSynthetic("PHONE", "phone-A", cache);
      const v2 = generateSynthetic("PHONE", "phone-B", cache);
      // They will almost certainly differ (different randoms)
      // At minimum they must be independent cache entries
      assert.notStrictEqual(v1, v2);
    });

    it("null cache does not throw", () => {
      assert.doesNotThrow(() =>
        generateSynthetic("EMAIL", "original@test.com", null)
      );
    });

    it("unknown category returns default replacement string", () => {
      const v = generateSynthetic("UNKNOWN_CATEGORY", "some value", null);
      assert.ok(typeof v === "string");
      assert.ok(v.length > 0);
    });
  });
});
