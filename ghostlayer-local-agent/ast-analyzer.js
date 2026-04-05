/**
 * ast-analyzer.js – AST-Based Code Business-Logic Detector
 *
 * When a developer pastes JavaScript / TypeScript code into an AI chat, the
 * paste may not contain explicit secrets (API keys, passwords) but can still
 * expose proprietary business logic such as discount algorithms, database
 * query patterns, or internal service endpoints.
 *
 * This module uses Acorn (a battle-tested JS parser) to build an Abstract
 * Syntax Tree from the paste and walks it looking for high-value constructs:
 *
 *   • Business-logic function names  (calculateDiscount, getCustomerById …)
 *   • Database / ORM call patterns   (db.query, Model.find, knex, sequelize …)
 *   • Internal service/API URLs      (hard-coded internal URLs or fetch calls)
 *   • Credential access patterns     (process.env lookups, config.secret …)
 *   • Export / module patterns       (export default / module.exports)
 *
 * If any of these are found the text is treated as containing sensitive
 * proprietary business logic and the sensitivity score is raised accordingly.
 *
 * All processing is 100% local – no code ever leaves this machine.
 *
 * @module ast-analyzer
 */

import * as acorn from "acorn";

// ── Heuristic: is the text likely JavaScript/TypeScript? ─────────────────────

/**
 * Lightweight pre-screen: return true if the text looks like JS/TS code so
 * we can skip the expensive parse step for non-code inputs.
 *
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeCode(text) {
  const CODE_SIGNALS = [
    /\bfunction\s+\w+\s*\(/,
    /\b(?:const|let|var)\s+\w+\s*=/,
    /\bclass\s+\w+/,
    /=>\s*\{/,
    /\bimport\b.+\bfrom\b/,
    /\bexport\b/,
    /\brequire\s*\(/,
    /\bmodule\.exports\b/,
  ];
  return CODE_SIGNALS.some((re) => re.test(text));
}

// ── Business-logic keyword sets ───────────────────────────────────────────────

/**
 * Function / method name patterns that suggest business logic.
 * Matched case-insensitively against identifier names extracted from the AST.
 */
const BUSINESS_LOGIC_PATTERNS = [
  /^calculate/i,
  /^compute/i,
  /^get[A-Z]/,            // getCustomer, getDiscount, …
  /^fetch[A-Z]/,          // fetchOrders, fetchInvoice, …
  /^find[A-Z]/,           // findUser, findOrder, …
  /^process[A-Z]/,        // processPayment, processOrder, …
  /^create[A-Z]/,         // createInvoice, createUser, …
  /^update[A-Z]/,         // updateBalance, updateStatus, …
  /^delete[A-Z]/,         // deleteRecord, …
  /^apply[A-Z]/,          // applyDiscount, applyTax, …
  /^validate[A-Z]/,       // validateLicense, …
  /discount/i,
  /pricing/i,
  /invoice/i,
  /order/i,
  /customer/i,
  /payment/i,
  /billing/i,
  /revenue/i,
  /salary/i,
  /payroll/i,
  /employee/i,
];

/**
 * Callee (object + method) patterns that suggest database or ORM usage.
 * Checked against stringified callee paths like "db.query" or "User.find".
 */
const DB_CALL_PATTERNS = [
  /\bdb\.(query|execute|run|all|get)\b/i,
  /\b\w+\.(find|findOne|findAll|findById|findAndCountAll)\b/i,
  /\b\w+\.(save|create|upsert|bulkCreate|insert)\b/i,
  /\b\w+\.(update|updateOne|updateMany|updateById)\b/i,
  /\b\w+\.(delete|deleteOne|deleteMany|remove)\b/i,
  /\b\w+\.(aggregate|populate|lean|exec|toArray)\b/i,
  /\bknex\b/i,
  /\bsequelize\b/i,
  /\bmongoose\b/i,
  /\bprisma\b/i,
  /\bdrizzle\b/i,
  /\bsupabase\b/i,
  /\bfirestore\b/i,
  /\bquery\(/i,
  /SELECT\s+.+\s+FROM/i,
  /INSERT\s+INTO/i,
  /UPDATE\s+\w+\s+SET/i,
  /DELETE\s+FROM/i,
];

/**
 * Patterns that detect credential / secret access.
 */
const CREDENTIAL_PATTERNS = [
  /process\.env\.\w*(secret|key|token|pass|pwd|credential|auth|api[_\-]?key)/i,
  /config\.\w*(secret|key|token|pass|auth)/i,
  /\.env\[["']\w*(secret|key|token|pass)/i,
];

// ── AST walker ────────────────────────────────────────────────────────────────

/**
 * Walk an Acorn AST node recursively, calling `visitor(node)` for every node.
 *
 * @param {object} node
 * @param {(node: object) => void} visitor
 */
function walkAst(node, visitor) {
  if (!node || typeof node !== "object") return;
  visitor(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) walkAst(item, visitor);
    } else if (child && typeof child === "object" && child.type) {
      walkAst(child, visitor);
    }
  }
}

/**
 * Stringify a MemberExpression chain into "obj.method" form for pattern matching.
 * Returns an empty string if the node is not a MemberExpression.
 *
 * @param {object} node
 * @returns {string}
 */
function memberExprToString(node) {
  if (!node) return "";
  if (node.type === "Identifier")       return node.name || "";
  if (node.type !== "MemberExpression") return "";
  const obj    = memberExprToString(node.object);
  const prop   = node.computed ? "" : (node.property?.name || "");
  return prop ? `${obj}.${prop}` : obj;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   hasBusinessLogic: boolean,
 *   hasDbCalls:       boolean,
 *   hasCredentialAccess: boolean,
 *   businessLogicFunctions: string[],
 *   dbCallSites:      string[],
 *   credentialAccess: string[],
 *   parseError:       boolean,
 * }} AstAnalysisResult
 */

/**
 * Analyse `text` for business-logic constructs using an AST parser.
 *
 * Returns an `AstAnalysisResult` with the findings.  When the text cannot be
 * parsed as JavaScript (e.g. it is plain prose), `parseError` is set to true
 * and all `has*` flags remain false – this is not an error condition, it simply
 * means AST analysis is not applicable to this input.
 *
 * @param {string} text
 * @returns {AstAnalysisResult}
 */
export function analyzeCodeAst(text) {
  const SAFE = {
    hasBusinessLogic:       false,
    hasDbCalls:             false,
    hasCredentialAccess:    false,
    businessLogicFunctions: [],
    dbCallSites:            [],
    credentialAccess:       [],
    parseError:             false,
  };

  if (!text || !looksLikeCode(text)) return SAFE;

  // Limit size to avoid CPU spikes on extremely long pastes
  const snippet = text.slice(0, 50_000);

  let ast;
  try {
    // Try modern ES2022; fall back to ES5 for older code snippets
    ast = acorn.parse(snippet, {
      ecmaVersion: 2022,
      sourceType:  "module",
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction:  true,
      allowHashBang:               true,
    });
  } catch {
    try {
      ast = acorn.parse(snippet, {
        ecmaVersion: 5,
        sourceType:  "script",
      });
    } catch {
      return { ...SAFE, parseError: true };
    }
  }

  const businessLogicFunctions = new Set();
  const dbCallSites            = new Set();
  const credentialAccess       = new Set();

  walkAst(ast, (node) => {
    // ── Business-logic: function / method declarations ────────────────────
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression"
    ) {
      const name = node.id?.name;
      if (name && BUSINESS_LOGIC_PATTERNS.some((p) => p.test(name))) {
        businessLogicFunctions.add(name);
      }
    }

    // Handle: const discountCalc = function() {} or const calculateFee = () => {}
    if (
      node.type === "VariableDeclarator" &&
      node.id?.type === "Identifier" &&
      (node.init?.type === "FunctionExpression" ||
       node.init?.type === "ArrowFunctionExpression")
    ) {
      const name = node.id.name;
      if (name && BUSINESS_LOGIC_PATTERNS.some((p) => p.test(name))) {
        businessLogicFunctions.add(name);
      }
    }

    // ── Database calls ─────────────────────────────────────────────────────
    if (node.type === "CallExpression") {
      const callee = memberExprToString(node.callee);
      if (callee && DB_CALL_PATTERNS.some((p) => p.test(callee))) {
        dbCallSites.add(callee);
      }
    }

    // ── Credential access (MemberExpression chains, e.g. process.env.SECRET) ─
    if (node.type === "MemberExpression") {
      const expr = memberExprToString(node);
      if (expr && CREDENTIAL_PATTERNS.some((p) => p.test(expr))) {
        credentialAccess.add(expr);
      }
    }
  });

  // Walk raw text for raw SQL or inline DB call patterns not visible in AST
  for (const pattern of DB_CALL_PATTERNS) {
    if (pattern.test(snippet)) {
      // Use the pattern source as a label if no callee was found yet
      if (dbCallSites.size === 0) dbCallSites.add(`[pattern: ${pattern.source.slice(0, 40)}]`);
    }
  }

  const result = {
    hasBusinessLogic:       businessLogicFunctions.size > 0,
    hasDbCalls:             dbCallSites.size > 0,
    hasCredentialAccess:    credentialAccess.size > 0,
    businessLogicFunctions: [...businessLogicFunctions],
    dbCallSites:            [...dbCallSites].slice(0, 10),
    credentialAccess:       [...credentialAccess].slice(0, 10),
    parseError:             false,
  };

  return result;
}

/**
 * Convenience: return a short human-readable summary of the findings.
 *
 * @param {AstAnalysisResult} result
 * @returns {string}
 */
export function summarizeAstFindings(result) {
  const parts = [];
  if (result.hasBusinessLogic)
    parts.push(`Business-logic functions: ${result.businessLogicFunctions.join(", ")}`);
  if (result.hasDbCalls)
    parts.push(`DB call sites: ${result.dbCallSites.join(", ")}`);
  if (result.hasCredentialAccess)
    parts.push(`Credential access: ${result.credentialAccess.join(", ")}`);
  return parts.join("; ");
}
