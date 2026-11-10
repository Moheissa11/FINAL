#!/usr/bin/env python3
"""Validate EARTIFY JSONL dataset shape, duplicates, and split leakage."""
import json, pathlib, sys
root = pathlib.Path(__file__).parent / "datasets"
seen = {}
required = {"user_input","normalized_text","language","intent","domain","entities","expected_action"}
for split in ("train","validation","test"):
    path = root / f"{split}.jsonl"
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    for row in rows:
        missing = required - row.keys()
        if missing: raise SystemExit(f"{path.name}: missing {sorted(missing)}")
        key = row["user_input"].strip().casefold()
        if key in seen: raise SystemExit(f"duplicate/leakage: {key!r} in {split} and {seen[key]}")
        seen[key] = split
    print(f"{split}: {len(rows)} records")
print(f"OK: {len(seen)} unique examples across all splits")
