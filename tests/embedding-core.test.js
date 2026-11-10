const test = require("node:test");
const assert = require("node:assert/strict");
const { cosineSimilarity, retrieveHybridPassages } = require("../embedding-core");

test("computes cosine similarity", () => {
  assert.equal(cosineSimilarity([1,0],[1,0]), 1);
  assert.equal(cosineSimilarity([1,0],[0,1]), 0);
});

test("uses lexical retrieval when embeddings are not configured", async () => {
  const docs=[{name:"mars.txt",content:"Mars has a thin atmosphere made mostly of carbon dioxide. Scientists study the atmospheric pressure, dust, and seasonal changes on the planet."}];
  const result=await retrieveHybridPassages("Mars atmosphere",docs,{apiKey:""});
  assert.equal(result.mode,"lexical");
  assert.equal(result.passages[0].name,"mars.txt");
});

test("bounds semantic embedding work to at most 64 candidate chunks", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ data: body.input.map((_, index) => ({ index, embedding: [1, 0] })) }) };
  };
  try {
    const docs=[{id:"large",name:"large.txt",content:("Mars atmosphere carbon dioxide dust science. ").repeat(2400)}];
    const result=await retrieveHybridPassages("Mars atmosphere",docs,{apiKey:"test-key",limit:5,cache:new Map()});
    assert.equal(result.mode,"hybrid");
    assert.ok(result.passages.length>0);
    assert.equal(calls,3); // two bounded chunk batches + one query embedding
  } finally { global.fetch = originalFetch; }
});
