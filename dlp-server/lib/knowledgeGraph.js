// ── גרף ידע – Knowledge Graph Engine ──
// TF-IDF based embedding עם cosine similarity לעברית ולאנגלית
// SensitiveEntity: text, embedding, category, organizationId

// ── TF-IDF Utilities ──

// Tokenize text (Hebrew + English)
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\u05D0-\u05EA\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

// חישוב TF (Term Frequency)
function computeTF(tokens) {
  const tf = new Map();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  const total = tokens.length || 1;
  for (const [key, count] of tf) {
    tf.set(key, count / total);
  }
  return tf;
}

// חישוב IDF (Inverse Document Frequency) לפי מאגר מסמכים
function computeIDF(documents) {
  const idf = new Map();
  const N = documents.length || 1;
  const termDocCount = new Map();

  for (const doc of documents) {
    const tokens = new Set(tokenize(doc.text));
    for (const token of tokens) {
      termDocCount.set(token, (termDocCount.get(token) || 0) + 1);
    }
  }

  for (const [term, count] of termDocCount) {
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
  }

  return idf;
}

// חישוב וקטור TF-IDF
function computeTFIDF(text, idf) {
  const tokens = tokenize(text);
  const tf = computeTF(tokens);
  const tfidf = new Map();

  for (const [term, tfVal] of tf) {
    // ערך ברירת מחדל log(2) ≈ 0.693 מייצג IDF של מסמך אחד מתוך שניים – ניטרלי ולא מעניש
    const idfVal = idf.get(term) || Math.log(2);
    tfidf.set(term, tfVal * idfVal);
  }

  return tfidf;
}

// נרמול וקטור
function normalizeVector(vec) {
  let magnitude = 0;
  for (const val of vec.values()) {
    magnitude += val * val;
  }
  magnitude = Math.sqrt(magnitude) || 1;
  const normalized = new Map();
  for (const [key, val] of vec) {
    normalized.set(key, val / magnitude);
  }
  return normalized;
}

// Cosine Similarity בין שני וקטורים (Map)
function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  for (const [term, valA] of vecA) {
    if (vecB.has(term)) {
      dot += valA * vecB.get(term);
    }
  }
  return dot; // וקטורים מנורמלים → dot = cosine
}

// ── In-Memory Entity Store ──
// במערכת production: להחליף ב-MongoDB SensitiveEntity collection
const entityStore = new Map(); // entityId → entity object
let entityCounter = 0;
let cachedIDF = new Map();
let idfDirty = true;

function rebuildIDF() {
  const docs = [...entityStore.values()];
  if (docs.length === 0) {
    cachedIDF = new Map();
    return;
  }
  cachedIDF = computeIDF(docs);
  idfDirty = false;
}

// ── CRUD Operations ──

// הוספת ישות רגישה חדשה
export function addEntity(text, category, organizationId) {
  const id = `entity-${++entityCounter}-${Date.now()}`;
  const entity = {
    id,
    text,
    category: category || "UNKNOWN",
    organizationId: organizationId || "default-org",
    createdAt: new Date().toISOString(),
    embedding: null, // ייחושב בזמן חיפוש
  };
  entityStore.set(id, entity);
  idfDirty = true;
  return entity;
}

// שליפת ישות לפי ID
export function getEntity(entityId) {
  return entityStore.get(entityId) || null;
}

// מחיקת ישות
export function deleteEntity(entityId) {
  const existed = entityStore.has(entityId);
  if (existed) {
    entityStore.delete(entityId);
    idfDirty = true;
  }
  return existed;
}

// שליפת כל הישויות של ארגון
export function getEntitiesByOrg(organizationId, limit = 100) {
  const results = [];
  for (const entity of entityStore.values()) {
    if (entity.organizationId === organizationId) {
      results.push(entity);
      if (results.length >= limit) break;
    }
  }
  return results;
}

// ── חיפוש בגרף ידע (Cosine Similarity Search) ──
export function searchSimilar(queryText, organizationId, topK = 5, threshold = 0.3) {
  if (idfDirty) rebuildIDF();

  const orgEntities = [...entityStore.values()].filter(
    (e) => e.organizationId === organizationId || e.organizationId === "global"
  );

  if (orgEntities.length === 0) {
    return [];
  }

  // חישוב וקטור השאילתה
  const queryVec = normalizeVector(computeTFIDF(queryText, cachedIDF));

  const scored = [];
  for (const entity of orgEntities) {
    const entityVec = normalizeVector(computeTFIDF(entity.text, cachedIDF));
    const score = cosineSimilarity(queryVec, entityVec);
    if (score >= threshold) {
      scored.push({ ...entity, similarityScore: score });
    }
  }

  // מיון לפי ציון דמיון (גבוה ראשון)
  scored.sort((a, b) => b.similarityScore - a.similarityScore);

  return scored.slice(0, topK);
}

// ── בדיקה האם טקסט דומה לישות רגישה קיימת ──
export function isTextSensitive(text, organizationId, threshold = 0.5) {
  const results = searchSimilar(text, organizationId, 1, threshold);
  if (results.length === 0) return { sensitive: false };
  return {
    sensitive: true,
    matchedEntity: results[0],
    score: results[0].similarityScore,
  };
}

// ── סטטיסטיקות ──
export function getKnowledgeGraphStats(organizationId) {
  const allEntities = [...entityStore.values()];
  const orgEntities = organizationId
    ? allEntities.filter((e) => e.organizationId === organizationId)
    : allEntities;

  const categoryBreakdown = {};
  for (const entity of orgEntities) {
    categoryBreakdown[entity.category] = (categoryBreakdown[entity.category] || 0) + 1;
  }

  return {
    total: orgEntities.length,
    categoryBreakdown,
    globalEntities: allEntities.filter((e) => e.organizationId === "global").length,
  };
}
