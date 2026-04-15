/**
 * policies.test.mjs – Tests for the DLP policy definitions (lib/policies.js)
 *
 * Verifies:
 *   - All four classification levels exist with the correct action mappings
 *   - Default category → classification mappings are correct for key PII types
 *   - getClassification() returns the right level and falls back gracefully
 *   - DEFAULT_POLICIES array has required structure for every policy
 *   - SEVERITY_SCORES has the correct relative ordering
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLASSIFICATION_LEVELS,
  DEFAULT_CATEGORY_CLASSIFICATION,
  getClassification,
  DEFAULT_POLICIES,
  SEVERITY_SCORES,
  getDefaultPolicies,
} from "../lib/policies.js";

describe("DLP Policies (lib/policies.js)", () => {
  // ── CLASSIFICATION_LEVELS ─────────────────────────────────────────────────

  describe("CLASSIFICATION_LEVELS", () => {
    it("defines PUBLIC, INTERNAL, SECRET and TOP_SECRET", () => {
      assert.ok(CLASSIFICATION_LEVELS.PUBLIC);
      assert.ok(CLASSIFICATION_LEVELS.INTERNAL);
      assert.ok(CLASSIFICATION_LEVELS.SECRET);
      assert.ok(CLASSIFICATION_LEVELS.TOP_SECRET);
    });

    it("PUBLIC action is 'none'", () => {
      assert.strictEqual(CLASSIFICATION_LEVELS.PUBLIC.action, "none");
    });

    it("INTERNAL action is 'log'", () => {
      assert.strictEqual(CLASSIFICATION_LEVELS.INTERNAL.action, "log");
    });

    it("SECRET action is 'mask'", () => {
      assert.strictEqual(CLASSIFICATION_LEVELS.SECRET.action, "mask");
    });

    it("TOP_SECRET action is 'block'", () => {
      assert.strictEqual(CLASSIFICATION_LEVELS.TOP_SECRET.action, "block");
    });

    it("each level has an id, label and description", () => {
      for (const level of Object.values(CLASSIFICATION_LEVELS)) {
        assert.ok(level.id, `Level missing id: ${JSON.stringify(level)}`);
        assert.ok(level.label, `Level ${level.id} missing label`);
        assert.ok(level.description, `Level ${level.id} missing description`);
      }
    });
  });

  // ── DEFAULT_CATEGORY_CLASSIFICATION ────────────────────────────────────────

  describe("DEFAULT_CATEGORY_CLASSIFICATION", () => {
    it("credit_card → TOP_SECRET", () => {
      assert.strictEqual(
        DEFAULT_CATEGORY_CLASSIFICATION.credit_card,
        "TOP_SECRET"
      );
    });

    it("api_key → TOP_SECRET", () => {
      assert.strictEqual(DEFAULT_CATEGORY_CLASSIFICATION.api_key, "TOP_SECRET");
    });

    it("password → TOP_SECRET", () => {
      assert.strictEqual(
        DEFAULT_CATEGORY_CLASSIFICATION.password,
        "TOP_SECRET"
      );
    });

    it("iban → TOP_SECRET", () => {
      assert.strictEqual(DEFAULT_CATEGORY_CLASSIFICATION.iban, "TOP_SECRET");
    });

    it("bank_account → TOP_SECRET", () => {
      assert.strictEqual(
        DEFAULT_CATEGORY_CLASSIFICATION.bank_account,
        "TOP_SECRET"
      );
    });

    it("israeli_id → SECRET", () => {
      assert.strictEqual(
        DEFAULT_CATEGORY_CLASSIFICATION.israeli_id,
        "SECRET"
      );
    });

    it("phone → SECRET", () => {
      assert.strictEqual(DEFAULT_CATEGORY_CLASSIFICATION.phone, "SECRET");
    });

    it("email → INTERNAL", () => {
      assert.strictEqual(DEFAULT_CATEGORY_CLASSIFICATION.email, "INTERNAL");
    });

    it("vehicle → INTERNAL", () => {
      assert.strictEqual(DEFAULT_CATEGORY_CLASSIFICATION.vehicle, "INTERNAL");
    });

    it("ip_address → INTERNAL", () => {
      assert.strictEqual(
        DEFAULT_CATEGORY_CLASSIFICATION.ip_address,
        "INTERNAL"
      );
    });
  });

  // ── getClassification ──────────────────────────────────────────────────────

  describe("getClassification", () => {
    it("credit_card returns TOP_SECRET classification with action=block", () => {
      const cls = getClassification("credit_card");
      assert.strictEqual(cls.id, "TOP_SECRET");
      assert.strictEqual(cls.action, "block");
    });

    it("phone returns SECRET classification with action=mask", () => {
      const cls = getClassification("phone");
      assert.strictEqual(cls.id, "SECRET");
      assert.strictEqual(cls.action, "mask");
    });

    it("email returns INTERNAL classification with action=log", () => {
      const cls = getClassification("email");
      assert.strictEqual(cls.id, "INTERNAL");
      assert.strictEqual(cls.action, "log");
    });

    it("unknown category falls back to SECRET", () => {
      const cls = getClassification("some_unknown_type");
      assert.strictEqual(cls.id, "SECRET");
    });

    it("undefined input falls back to SECRET", () => {
      const cls = getClassification(undefined);
      assert.strictEqual(cls.id, "SECRET");
    });

    it("returns an object with id, label, action, description", () => {
      const cls = getClassification("email");
      assert.ok(cls.id);
      assert.ok(cls.label);
      assert.ok(cls.action);
      assert.ok(cls.description);
    });
  });

  // ── DEFAULT_POLICIES ───────────────────────────────────────────────────────

  describe("DEFAULT_POLICIES", () => {
    it("is a non-empty array", () => {
      assert.ok(Array.isArray(DEFAULT_POLICIES));
      assert.ok(DEFAULT_POLICIES.length > 0);
    });

    it("every policy has id, label, description, enabled, category, severity", () => {
      for (const p of DEFAULT_POLICIES) {
        assert.ok(p.id, `Policy missing id: ${JSON.stringify(p)}`);
        assert.ok(p.label, `Policy ${p.id} missing label`);
        assert.ok(p.description, `Policy ${p.id} missing description`);
        assert.ok(typeof p.enabled === "boolean", `Policy ${p.id} enabled should be boolean`);
        assert.ok(p.category, `Policy ${p.id} missing category`);
        assert.ok(p.severity, `Policy ${p.id} missing severity`);
      }
    });

    it("credit_card policy is enabled with severity=critical", () => {
      const cc = DEFAULT_POLICIES.find((p) => p.id === "credit_card");
      assert.ok(cc, "credit_card policy should exist");
      assert.strictEqual(cc.enabled, true);
      assert.strictEqual(cc.severity, "critical");
    });

    it("israeli_id policy is enabled", () => {
      const idPolicy = DEFAULT_POLICIES.find((p) => p.id === "israeli_id");
      assert.ok(idPolicy, "israeli_id policy should exist");
      assert.strictEqual(idPolicy.enabled, true);
    });

    it("api_key policy is enabled with severity=critical", () => {
      const apiKey = DEFAULT_POLICIES.find((p) => p.id === "api_key");
      assert.ok(apiKey, "api_key policy should exist");
      assert.strictEqual(apiKey.enabled, true);
      assert.strictEqual(apiKey.severity, "critical");
    });

    it("password policy is enabled with severity=critical", () => {
      const pw = DEFAULT_POLICIES.find((p) => p.id === "password");
      assert.ok(pw, "password policy should exist");
      assert.strictEqual(pw.enabled, true);
      assert.strictEqual(pw.severity, "critical");
    });

    it("no two policies share the same id", () => {
      const ids = DEFAULT_POLICIES.map((p) => p.id);
      const uniqueIds = new Set(ids);
      assert.strictEqual(uniqueIds.size, ids.length, "Duplicate policy ids found");
    });
  });

  // ── getDefaultPolicies ─────────────────────────────────────────────────────

  describe("getDefaultPolicies", () => {
    it("returns array of same length as DEFAULT_POLICIES", () => {
      const policies = getDefaultPolicies("org-123");
      assert.strictEqual(policies.length, DEFAULT_POLICIES.length);
    });

    it("each policy has the organizationId attached", () => {
      const orgId = "test-org-abc";
      const policies = getDefaultPolicies(orgId);
      for (const p of policies) {
        assert.strictEqual(p.organizationId, orgId);
      }
    });

    it("does not mutate the original DEFAULT_POLICIES array", () => {
      const origFirst = DEFAULT_POLICIES[0].organizationId;
      getDefaultPolicies("mutate-test");
      assert.strictEqual(DEFAULT_POLICIES[0].organizationId, origFirst);
    });
  });

  // ── SEVERITY_SCORES ────────────────────────────────────────────────────────

  describe("SEVERITY_SCORES", () => {
    it("defines critical, high, medium, low scores", () => {
      assert.ok(typeof SEVERITY_SCORES.critical === "number");
      assert.ok(typeof SEVERITY_SCORES.high === "number");
      assert.ok(typeof SEVERITY_SCORES.medium === "number");
      assert.ok(typeof SEVERITY_SCORES.low === "number");
    });

    it("scores are in descending order: critical > high > medium > low", () => {
      assert.ok(
        SEVERITY_SCORES.critical > SEVERITY_SCORES.high,
        "critical should be > high"
      );
      assert.ok(
        SEVERITY_SCORES.high > SEVERITY_SCORES.medium,
        "high should be > medium"
      );
      assert.ok(
        SEVERITY_SCORES.medium > SEVERITY_SCORES.low,
        "medium should be > low"
      );
    });

    it("all scores are positive integers", () => {
      for (const [name, score] of Object.entries(SEVERITY_SCORES)) {
        assert.ok(score > 0, `${name} score should be positive`);
        assert.ok(Number.isInteger(score), `${name} score should be an integer`);
      }
    });
  });
});
