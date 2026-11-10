"use strict";
const { splitIntoChunks, retrieveRelevantPassages } = require("./research-core");

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

async function createEmbeddings(texts, apiKey, model = "text-embedding-3-small") {
  if (!apiKey || !texts.length) return [];
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts.map(t => String(t).slice(0, 8000)), encoding_format: "float" }),
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw new Error(`Embedding service returned ${response.status}`);
  const payload = await response.json();
  return (payload.data || []).sort((a, b) => a.index - b.index).map(item => item.embedding);
}

async function retrieveHybridPassages(question, documents, options = {}) {
  const { apiKey = "", model = "text-embedding-3-small", limit = 8, cache = new Map() } = options;
  const lexical = retrieveRelevantPassages(question, documents, Math.max(limit * 2, 64));
  if (!apiKey) return { passages: lexical.slice(0, limit), mode: "lexical" };

  const chunks = [];
  for (const doc of documents || []) {
    for (const [index, chunk] of splitIntoChunks(doc.content).entries()) {
      const key = `${doc.id || doc.name}:${index}`;
      chunks.push({ key, name: doc.name, chunk, index });
    }
  }
  if (!chunks.length) return { passages: [], mode: "hybrid" };
  // Bound embedding work per query: lexical ranking selects up to 64 candidate chunks.
  // This keeps latency and API usage predictable for large uploaded libraries.
  const candidateKeys = new Set(lexical.slice(0,64).map(item => `${item.name}:${item.index}`));
  const candidates = chunks.filter(item => candidateKeys.has(`${item.name}:${item.index}`));
  const selectedChunks = candidates.length ? candidates : chunks.slice(0,64);
  const missing = selectedChunks.filter(item => !cache.has(item.key));
  try {
    for (let i = 0; i < missing.length; i += 48) {
      const batch = missing.slice(i, i + 48);
      const vectors = await createEmbeddings(batch.map(x => x.chunk), apiKey, model);
      batch.forEach((item, index) => { if (vectors[index]) cache.set(item.key, vectors[index]); });
      while (cache.size > 12000) cache.delete(cache.keys().next().value);
    }
    const [queryVector] = await createEmbeddings([question], apiKey, model);
    if (!queryVector) throw new Error("No query embedding returned");
    const lexicalScores = new Map(lexical.map(p => [`${p.name}:${p.index}`, p.score]));
    const maxLex = Math.max(1, ...lexical.map(p => p.score));
    const ranked = selectedChunks.map(item => {
      const semantic = cosineSimilarity(queryVector, cache.get(item.key));
      const lex = (lexicalScores.get(`${item.name}:${item.index}`) || 0) / maxLex;
      return { ...item, semanticScore: semantic, score: semantic * 0.78 + lex * 0.22 };
    }).sort((a, b) => b.score - a.score).slice(0, limit);
    return { passages: ranked, mode: "hybrid" };
  } catch (error) {
    return { passages: lexical.slice(0, limit), mode: "lexical-fallback", warning: error.message };
  }
}

module.exports = { cosineSimilarity, createEmbeddings, retrieveHybridPassages };
