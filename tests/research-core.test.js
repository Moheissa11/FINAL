const test=require("node:test");
const assert=require("node:assert/strict");
const {splitIntoChunks,retrieveRelevantPassages}=require("../research-core");

test("splits long text into overlapping readable chunks",()=>{
  const text=("Mars has a thin atmosphere mostly made of carbon dioxide. ").repeat(50);
  const chunks=splitIntoChunks(text,300,50);
  assert.ok(chunks.length>2);
  assert.ok(chunks.every(x=>x.length<=300));
});

test("retrieves relevant saved passages above unrelated content",()=>{
  const docs=[
    {name:"mars.txt",content:"Mars has a thin atmosphere mostly composed of carbon dioxide. The planet has two moons."},
    {name:"history.txt",content:"Ancient trade routes connected cities through commerce and migration."}
  ];
  const results=retrieveRelevantPassages("Mars atmosphere carbon dioxide",docs,4);
  assert.ok(results.length>0);
  assert.equal(results[0].name,"mars.txt");
});
