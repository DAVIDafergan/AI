/**
 * triage.test.mjs – Tests for the server-side triage pipeline (lib/triage.js)
 *
 * Covers all three detection layers:
 *   L1 – Fast Regex + Bloom Filter  (Israeli PII, API keys, connection strings)
 *   L2 – Semantic Hash Cache        (exact-match after addSensitiveHash)
 *   L3 – Hebrew Contextual NLP      (password/credit-card stated in Hebrew)
 *
 * Also tests the combined runTriage / runTriageWithStats pipeline and
 * the admin statistics endpoint (getTriageStats).
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  triageL1,
  triageL2,
  triageL3,
  runTriage,
  runTriageWithStats,
  addSensitiveHash,
  getTriageStats,
} from "../lib/triage.js";

describe("Triage Pipeline (lib/triage.js)", () => {
  // ── L1 – Fast Regex Scan ──────────────────────────────────────────────────

  describe("triageL1 – Regex + Bloom Filter", () => {
    it("safe text returns found=false with no matches", () => {
      const r = triageL1("The quick brown fox jumps over the lazy dog");
      assert.strictEqual(r.found, false);
      assert.deepStrictEqual(r.matches, []);
    });

    it("returns duration as non-negative number", () => {
      const r = triageL1("test");
      assert.ok(typeof r.duration === "number");
      assert.ok(r.duration >= 0);
    });

    describe("Israeli phone numbers", () => {
      it("detects 050-xxx-xxxx (mobile)", () => {
        const r = triageL1("Call 050-123-4567 today");
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "PHONE"));
      });

      it("detects 052-xxx-xxxx (mobile)", () => {
        const r = triageL1("reach out at 052-999-8888");
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "PHONE"));
      });

      it("detects 03-xxx-xxxx (landline)", () => {
        const r = triageL1("Office: 03-765-4321");
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "LANDLINE"));
      });

      it("detects 02-xxx-xxxx (Jerusalem landline)", () => {
        const r = triageL1("02-500-6000");
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "LANDLINE"));
      });
    });

    describe("Israeli ID (9-digit)", () => {
      it("detects a valid 9-digit ID (023456783)", () => {
        const r = triageL1("ID: 023456783");
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "ID"));
      });
    });

    describe("Credit cards", () => {
      it("detects Visa 4111 1111 1111 1111", () => {
        const r = triageL1("card 4111 1111 1111 1111");
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "CREDIT_CARD"));
      });

      it("Luhn-invalid card number is NOT reported", () => {
        // 4111 1111 1111 1112 fails Luhn
        const r = triageL1("card 4111 1111 1111 1112");
        const ccMatches = r.matches.filter((m) => m.id === "CREDIT_CARD");
        assert.strictEqual(ccMatches.length, 0);
      });
    });

    describe("Email addresses", () => {
      it("detects user@example.com", () => {
        const r = triageL1("Contact user@example.com for help");
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "EMAIL"));
      });
    });

    describe("API keys and secrets", () => {
      it("detects AWS access key (AKIA...)", () => {
        const r = triageL1("Key=AKIAIOSFODNN7EXAMPLE");
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "AWS_KEY"));
      });

      it("detects OpenAI API key (sk-...)", () => {
        const r = triageL1("Token: sk-abcdefghij1234567890abcde");
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "OPENAI_KEY"));
      });

      it("detects GitHub token (ghp_...)", () => {
        const token = "ghp_" + "a".repeat(36);
        const r = triageL1(`token=${token}`);
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "GITHUB_TOKEN"));
      });

      it("detects Google API key (AIza... – 39 chars total)", () => {
        // Google API keys: "AIza" + exactly 35 alphanum chars = 39 total chars
        const r = triageL1("AIzaSyAbcdefghijklmnopqrstuvwxyz1234567");
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "GOOGLE_API_KEY"));
      });

      it("detects JWT token (eyJ...)", () => {
        const r = triageL1(
          "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        );
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "JWT"));
      });

      it("detects PEM private key header", () => {
        const r = triageL1("-----BEGIN RSA PRIVATE KEY-----");
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "PEM_KEY"));
      });

      it("detects MongoDB connection string", () => {
        const r = triageL1("mongodb://user:pass@host:27017/mydb");
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "MONGODB_URI"));
      });

      it("detects PostgreSQL connection string", () => {
        const r = triageL1("postgresql://admin:pw@localhost/db");
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "POSTGRES_URI"));
      });
    });

    describe("Internal IP addresses", () => {
      it("detects 192.168.x.x", () => {
        const r = triageL1("Server at 192.168.1.100");
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "INTERNAL_IP"));
      });

      it("detects 10.x.x.x", () => {
        const r = triageL1("Access 10.0.0.1 from the VPN");
        assert.ok(r.found);
        assert.ok(r.matches.some((m) => m.id === "INTERNAL_IP"));
      });
    });

    describe("Bloom Filter", () => {
      it("bloomHit=true for text containing 'password'", () => {
        const r = triageL1("my password is hunter2");
        assert.ok(r.bloomHit);
      });

      it("bloomHit=false for benign text", () => {
        const r = triageL1("I like walking in the park");
        assert.strictEqual(r.bloomHit, false);
      });
    });
  });

  // ── L2 – Semantic Hash Cache ──────────────────────────────────────────────

  describe("triageL2 – Semantic Hash Cache", () => {
    const KNOWN_SECRET = "TopSecretUniqueHashCacheString99999";

    before(() => {
      addSensitiveHash(KNOWN_SECRET, "UNIT_TEST_CATEGORY", "Unit test hash");
    });

    it("finds an exact match after addSensitiveHash", () => {
      const r = triageL2(KNOWN_SECRET);
      assert.ok(r.found);
      assert.ok(r.matches.length > 0);
      assert.strictEqual(r.matches[0].category, "UNIT_TEST_CATEGORY");
    });

    it("is case-insensitive (stored hash is lowercase)", () => {
      const r = triageL2(KNOWN_SECRET.toLowerCase());
      assert.ok(r.found);
    });

    it("returns found=false for unknown text", () => {
      const r = triageL2("completely random text nobody has ever added here");
      assert.strictEqual(r.found, false);
    });

    it("returns duration as a number", () => {
      const r = triageL2("anything");
      assert.ok(typeof r.duration === "number");
    });
  });

  // ── L3 – Hebrew Contextual NLP ────────────────────────────────────────────

  describe("triageL3 – Hebrew Contextual NLP", () => {
    it("detects Hebrew password context (הסיסמה שלי היא ...)", () => {
      const r = triageL3("הסיסמה שלי היא hunter2");
      assert.ok(r.found);
      assert.ok(r.matches.some((m) => m.category === "PASSWORD"));
    });

    it("detects Hebrew credit-card context (מספר הכרטיס שלי ...)", () => {
      const r = triageL3("מספר הכרטיס שלי הוא 4111111111111111");
      assert.ok(r.found);
      assert.ok(r.matches.some((m) => m.category === "CREDIT_CARD"));
    });

    it("detects Hebrew ID context (ת.ז. שלי ...)", () => {
      const r = triageL3("ת.ז. שלי היא 023456783");
      assert.ok(r.found);
      assert.ok(r.matches.some((m) => m.category === "ID"));
    });

    it("detects Hebrew phone context (הטלפון שלי ...)", () => {
      const r = triageL3("הטלפון שלי הוא 050-123-4567");
      assert.ok(r.found);
      assert.ok(r.matches.some((m) => m.category === "PHONE"));
    });

    it("detects Hebrew email context (כתובת המייל שלי ...)", () => {
      const r = triageL3("כתובת המייל שלי היא user@example.com");
      assert.ok(r.found);
      assert.ok(r.matches.some((m) => m.category === "EMAIL"));
    });

    it("score is a number", () => {
      const r = triageL3("test text");
      assert.ok(typeof r.score === "number");
    });

    it("does NOT flag clearly benign Hebrew with low score", () => {
      // "The apple is green and beautiful" – score should be well below 25
      const r = triageL3("התפוח שלי ירוק ויפה");
      assert.ok(r.score < 25 || !r.found || r.matches.length === 0,
        `Unexpected detection on benign text (score=${r.score}, found=${r.found})`);
    });
  });

  // ── runTriage – Full Pipeline ─────────────────────────────────────────────

  describe("runTriage – full pipeline", () => {
    it("returns safe=true for completely benign text", () => {
      const r = runTriage("The sky is blue today");
      assert.strictEqual(r.safe, true);
      assert.strictEqual(r.level, "none");
    });

    it("returns safe=false with level=l1 for a phone number", () => {
      const r = runTriage("Contact: 050-999-1234");
      assert.strictEqual(r.safe, false);
      assert.strictEqual(r.level, "l1");
      assert.ok(r.score > 0);
    });

    it("returns safe=false for an email address", () => {
      const r = runTriage("Send to admin@company.org now");
      assert.strictEqual(r.safe, false);
    });

    it("returns safe=false for an AWS key", () => {
      const r = runTriage("AKIAIOSFODNN7EXAMPLE is the key");
      assert.strictEqual(r.safe, false);
    });

    it("includes timing object with l1 and total as numbers", () => {
      const r = runTriage("sample text here");
      assert.ok(typeof r.timing.l1 === "number");
      assert.ok(typeof r.timing.total === "number");
    });

    it("matches array is always an array", () => {
      const r = runTriage("any text");
      assert.ok(Array.isArray(r.matches));
    });
  });

  // ── runTriageWithStats ────────────────────────────────────────────────────

  describe("runTriageWithStats", () => {
    it("increments totalRuns on every call", () => {
      const before = getTriageStats().totalRuns;
      runTriageWithStats("neutral text here");
      const after = getTriageStats().totalRuns;
      assert.ok(after > before, "totalRuns should have increased");
    });

    it("increments totalUnsafe on sensitive content", () => {
      const before = getTriageStats().totalUnsafe;
      runTriageWithStats("card 4111 1111 1111 1111");
      const after = getTriageStats().totalUnsafe;
      assert.ok(after > before, "totalUnsafe should have increased");
    });

    it("returns the same result as runTriage", () => {
      const text = "email contact@example.com";
      const r1 = runTriage(text);
      const r2 = runTriageWithStats(text);
      assert.strictEqual(r2.safe, r1.safe);
      assert.strictEqual(r2.level, r1.level);
    });
  });

  // ── getTriageStats ────────────────────────────────────────────────────────

  describe("getTriageStats", () => {
    it("returns object with expected numeric fields", () => {
      const stats = getTriageStats();
      assert.ok(typeof stats.totalRuns === "number");
      assert.ok(typeof stats.totalUnsafe === "number");
      assert.ok(typeof stats.l1Hits === "number");
      assert.ok(typeof stats.l2Hits === "number");
      assert.ok(typeof stats.l3Hits === "number");
    });

    it("returns hit-rate strings (e.g. '50.0')", () => {
      const stats = getTriageStats();
      assert.match(stats.l1HitRate, /^\d+\.\d$/);
      assert.match(stats.l2HitRate, /^\d+\.\d$/);
      assert.match(stats.l3HitRate, /^\d+\.\d$/);
    });
  });
});
