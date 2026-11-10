// Lightweight, deterministic preprocessing helpers. These signals guide the LLM;
// they are not presented as a replacement for semantic understanding.
"use strict";

const ARABIZI_MARKERS = /\b(?:3ayz|3aiz|3rf|a3rf|eh|bt3ml|el|msh|mesh|ezay|leh|3shan|keda|b2a|ana|enta|eih)\b/i;

function detectLanguage(text) {
  const value = String(text || "");
  if (/[\u0600-\u06FF]/.test(value)) return "ar";
  if (ARABIZI_MARKERS.test(value)) return "ar";
  return "en";
}

function normalizeForMatching(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[ـ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function classifyIntent(text) {
  const q = normalizeForMatching(text);
  if (!q) return "empty";
  if (/(follow.?up|what about|tell me more|explain the (first|second|third)|طب و|طيب و|كمل|كمّل|واللي بعده|ماذا عن)/i.test(q)) return "follow_up";
  if (/(nasa|ntrs|scientific paper|research paper|journal article|arxiv|doi|بحث علمي|ورقة بحثية|ابحاث ناسا)/i.test(q)) return "scientific_research";
  if (/(summari[sz]|لخص|ملخص)/i.test(q)) return "summarization";
  if (/(translate|ترجم)/i.test(q)) return "translation";
  if (/(compare|versus|\bvs\b|قارن|الفرق بين)/i.test(q)) return "comparison";
  if (/(solve|calculate|compute|احسب|حل المسألة)/i.test(q)) return "calculation";
  if (/(explain|teach|اشرح|فهمني|مش فاهم|ليه|ازاي)/i.test(q)) return "explanation";
  if (/(research|paper|publication|بحث علمي|دراسة|مصادر)/i.test(q)) return "research";
  if (/(code|program|debug|برمج|كود)/i.test(q)) return "coding";
  if (/(^hi$|^hello$|^hey$|مرحبا|اهلا|ازيك)/i.test(q)) return "greeting";
  if (/(^thanks|شكرا|متشكر)/i.test(q)) return "thanks";
  return "general_question";
}

function classifyTeachingMode(text) {
  const q = normalizeForMatching(text);
  if (/(simple|simpler|ببساطة|بسهولة)/i.test(q)) return "simple";
  if (/(advanced|technical|deep dive|متقدم|بالتفصيل العلمي)/i.test(q)) return "advanced";
  if (/(step.?by.?step|in detail|بالتفصيل|واحدة واحدة|خطوة بخطوة|اشرح|فهمني)/i.test(q)) return "detailed";
  return "adaptive";
}

function tokenize(text) {
  return normalizeForMatching(text).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
}

module.exports = { detectLanguage, normalizeForMatching, classifyIntent, classifyTeachingMode, tokenize };
