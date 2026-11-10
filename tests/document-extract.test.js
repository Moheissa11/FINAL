const test = require("node:test");
const assert = require("node:assert/strict");
const { extractUpload, cleanText } = require("../document-extract");

test("extracts UTF-8 text uploads", () => {
  const doc = extractUpload({ name: "notes.txt", data: "Mars atmosphere\nCarbon dioxide" });
  assert.equal(doc.name, "notes.txt");
  assert.match(doc.content, /Carbon dioxide/);
});

test("rejects unsupported file extensions", () => {
  assert.throws(() => extractUpload({ name: "archive.exe", data: "abc" }), /Supported formats/);
});

test("cleans null bytes and excessive whitespace", () => {
  assert.equal(cleanText("A\u0000\n\n\nB"), "A\n\nB");
});
