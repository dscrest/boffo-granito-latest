/* Raster image type from a file's magic bytes → canonical extension, or null.
   This is the upload allowlist: the client-sent name/type is never trusted, and
   anything that is not a raster image (SVG, HTML, …) must come back null. */
"use strict";

function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  const at = (i, s) => buf.toString("latin1", i, i + s.length) === s;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (at(0, "\x89PNG\r\n\x1a\n")) return "png";
  if (at(0, "GIF87a") || at(0, "GIF89a")) return "gif";
  if (at(0, "RIFF") && at(8, "WEBP")) return "webp";
  if (at(0, "BM")) return "bmp";
  if (at(4, "ftyp") && (at(8, "avif") || at(8, "avis"))) return "avif";
  return null;
}

module.exports = { sniffImage };
