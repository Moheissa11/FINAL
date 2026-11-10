const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../assistant-core");

test("detects Arabic, Arabizi, and English", () => {
  assert.equal(core.detectLanguage("عايز أفهم"), "ar");
  assert.equal(core.detectLanguage("3ayz afham"), "ar");
  assert.equal(core.detectLanguage("I want to understand"), "en");
});
test("normalizes common Arabic spelling variants", () => {
  assert.equal(core.normalizeForMatching("إزاي  تِفهم؟"), "ازاي تفهم؟");
});
test("classifies common intents", () => {
  assert.equal(core.classifyIntent("اشرحلي الجاذبية"), "explanation");
  assert.equal(core.classifyIntent("compare Mars and Moon"), "comparison");
  assert.equal(core.classifyIntent("لخص الملف"), "summarization");
});
test("teaching depth remains adaptive unless requested", () => {
  assert.equal(core.classifyTeachingMode("اشرح بالتفصيل"), "detailed");
  assert.equal(core.classifyTeachingMode("make it simpler"), "simple");
  assert.equal(core.classifyTeachingMode("hello"), "adaptive");
});

test("classifies scientific research and contextual follow-ups", () => {
  assert.equal(core.classifyIntent("ابحث عن ورقة بحثية عن المريخ"), "scientific_research");
  assert.equal(core.classifyIntent("what about its atmosphere?"), "follow_up");
});
