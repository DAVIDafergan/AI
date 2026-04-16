import test from "node:test";
import assert from "node:assert/strict";
import { _test_getApiKeyLookupCandidates, hashApiKey } from "../lib/db.js";

process.env.API_KEY_HMAC_SECRET ||= "test-hmac-secret";

test("API key lookup candidates include normalized raw key + its hash", () => {
  const raw = "  key-abc123  ";
  const candidates = _test_getApiKeyLookupCandidates(raw);

  assert.ok(candidates.includes("key-abc123"));
  assert.ok(candidates.includes(hashApiKey("key-abc123")));
});

test("API key lookup candidates normalize Bearer prefix", () => {
  const candidates = _test_getApiKeyLookupCandidates("Bearer key-xyz789");

  assert.ok(candidates.includes("key-xyz789"));
  assert.ok(candidates.includes(hashApiKey("key-xyz789")));
});

test("API key lookup candidates include lowercase digest form", () => {
  const digestUpper = "A".repeat(64);
  const candidates = _test_getApiKeyLookupCandidates(digestUpper);

  assert.ok(candidates.includes(digestUpper));
  assert.ok(candidates.includes(digestUpper.toLowerCase()));
});

test("API key lookup candidates return empty for blank input", () => {
  assert.deepEqual(_test_getApiKeyLookupCandidates("   "), []);
  assert.deepEqual(_test_getApiKeyLookupCandidates(null), []);
  assert.deepEqual(_test_getApiKeyLookupCandidates(undefined), []);
});
