/* Tests for the upload allowlist. Run: node --test functions/data-ops/lib/*.test.js */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { sniffImage } = require("./sniffImage");

const pad = (head) => Buffer.concat([Buffer.from(head, "latin1"), Buffer.alloc(16)]);

test("recognises each allowed raster type", () => {
  assert.equal(sniffImage(pad("\xff\xd8\xff\xe0")), "jpg");
  assert.equal(sniffImage(pad("\x89PNG\r\n\x1a\n")), "png");
  assert.equal(sniffImage(pad("GIF89a")), "gif");
  assert.equal(sniffImage(pad("RIFF\x00\x00\x00\x00WEBP")), "webp");
  assert.equal(sniffImage(pad("BM")), "bmp");
  assert.equal(sniffImage(pad("\x00\x00\x00\x1cftypavif")), "avif");
});

test("rejects script-capable and unknown payloads", () => {
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniffImage(Buffer.from('<?xml version="1.0"?><svg></svg>')), null);
  assert.equal(sniffImage(Buffer.from("<!doctype html><script>alert(1)</script>")), null);
  assert.equal(sniffImage(pad("RIFF\x00\x00\x00\x00WAVE")), null);
  assert.equal(sniffImage(Buffer.from("tiny")), null);
  assert.equal(sniffImage("not a buffer"), null);
});
