"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 300_000;

function run(command, args, input, label) {
  let result = spawnSync(command, args, { input, maxBuffer: 12 * 1024 * 1024, timeout: 30_000 });
  if (result.error && result.error.code === "ENOENT" && command === "python3") {
    result = spawnSync("python", args, { input, maxBuffer: 12 * 1024 * 1024, timeout: 30_000 });
  }
  if (result.error) {
    if (result.error.code === "ENOENT") throw new Error(`${label} extraction requires ${command} to be installed on the server.`);
    throw result.error;
  }
  if (result.status !== 0) throw new Error(`${label} extraction failed. The file may be damaged, encrypted, or unsupported.`);
  return result.stdout.toString("utf8");
}

function cleanText(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/\r/g, "")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_CHARS);
}

function extractUpload(input) {
  const name = path.basename(String(input.name || "document.txt")).slice(0, 140);
  const ext = path.extname(name).toLowerCase();
  let bytes;
  if (typeof input.base64 === "string") {
    const encoded = input.base64.replace(/^data:[^,]*,/, "");
    if (encoded.length > Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) + 16) throw new Error("File is too large (maximum 8 MB).");
    bytes = Buffer.from(encoded, "base64");
  } else {
    const data = String(input.data || "");
    if (Buffer.byteLength(data, "utf8") > MAX_UPLOAD_BYTES) throw new Error("File is too large (maximum 8 MB).");
    bytes = Buffer.from(data, "utf8");
  }
  if (!bytes.length) throw new Error("The selected file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error("File is too large (maximum 8 MB).");

  let text;
  if ([".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm"].includes(ext)) {
    text = bytes.toString("utf8");
    if (ext === ".html" || ext === ".htm" || ext === ".xml") {
      text = text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
    }
  } else if (ext === ".pdf") {
    text = run("pdftotext", ["-layout", "-enc", "UTF-8", "-", "-"], bytes, "PDF");
    if (!cleanText(text)) {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eartify-ocr-"));
      try {
        const pdfPath = path.join(tempDir, "source.pdf");
        const prefix = path.join(tempDir, "page");
        fs.writeFileSync(pdfPath, bytes, { mode: 0o600 });
        run("pdftoppm", ["-f", "1", "-l", "10", "-r", "160", "-png", pdfPath, prefix], Buffer.alloc(0), "Scanned PDF image");
        const pages = fs.readdirSync(tempDir).filter(file => /^page-\d+\.png$/.test(file)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
        if (!pages.length) throw new Error("No pages could be rendered from this PDF.");
        text = pages.map(file => run("tesseract", [path.join(tempDir,file), "stdout", "-l", "eng+ara", "--psm", "3"], Buffer.alloc(0), "PDF OCR")).join("\n\n");
        if (pages.length === 10) text += "\n\n[OCR processed the first 10 pages only.]";
      } finally { fs.rmSync(tempDir,{recursive:true,force:true}); }
    }
  } else if (ext === ".docx") {
    const script = [
      "import sys, zipfile, xml.etree.ElementTree as ET, html",
      "data=sys.stdin.buffer.read()",
      "try:",
      " z=zipfile.ZipFile(__import__('io').BytesIO(data))",
      " root=ET.fromstring(z.read('word/document.xml'))",
      " ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}",
      " paras=[]",
      " for p in root.findall('.//w:p',ns):",
      "  parts=[]",
      "  for node in p.iter():",
      "   if node.tag.endswith('}t') and node.text: parts.append(node.text)",
      "   elif node.tag.endswith('}tab'): parts.append('\\t')",
      "  if parts: paras.append(''.join(parts))",
      " print('\\n'.join(paras))",
      "except Exception as e:",
      " print('DOCX extraction failed',file=sys.stderr); sys.exit(2)"
    ].join("\n");
    text = run("python3", ["-c", script], bytes, "DOCX");
  } else {
    throw new Error("Supported formats: TXT, MD, CSV, JSON, XML, HTML, PDF, and DOCX.");
  }
  text = cleanText(text);
  if (!text) throw new Error("No readable text was found. Scanned PDFs need OCR before they can be searched.");
  return { name, content: text, type: ext.slice(1), characters: text.length };
}

module.exports = { extractUpload, MAX_UPLOAD_BYTES, MAX_EXTRACTED_CHARS, cleanText };
