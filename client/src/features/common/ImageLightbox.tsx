/* ============================================================
   Image lightbox + thumb (CR-192) — extracted from ImageManager so
   read-only screens (panel picker, order form, grids) can show a
   record's images without the upload UI. ImageThumb = first image
   as a small cover square; click opens the lightbox over ALL images.
   ============================================================ */
import { useState, type MouseEvent } from "react";
import { designImageUrl } from "@/lib/api";
import type { DesignImage } from "@/features/masters/designsApi";

export function ImageLightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: DesignImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const img = images[index];
  if (!img) return null;
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <div
      onClick={(e) => {
        stop(e);
        onClose();
      }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <button
        className="btn x"
        onClick={(e) => {
          stop(e);
          onClose();
        }}
        title="Close"
        style={{ position: "absolute", top: 16, right: 16 }}
      >
        ✕
      </button>
      {images.length > 1 && (
        <button
          className="btn"
          onClick={(e) => {
            stop(e);
            onIndex((index - 1 + images.length) % images.length);
          }}
          title="Previous"
          style={{ position: "absolute", left: 16, width: 40, height: 40, fontSize: 22, lineHeight: 1 }}
        >
          ‹
        </button>
      )}
      <img
        src={designImageUrl(img.id)}
        alt={img.name || `Image ${index + 1}`}
        onClick={stop}
        style={{ maxWidth: "88vw", maxHeight: "84vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}
      />
      {images.length > 1 && (
        <button
          className="btn"
          onClick={(e) => {
            stop(e);
            onIndex((index + 1) % images.length);
          }}
          title="Next"
          style={{ position: "absolute", right: 16, bottom: "50%", width: 40, height: 40, fontSize: 22, lineHeight: 1 }}
        >
          ›
        </button>
      )}
      <div style={{ position: "absolute", bottom: 16, color: "#fff", fontSize: "var(--t-sm)" }}>
        {index + 1} / {images.length}
      </div>
    </div>
  );
}

/** First image as a cover square; click zooms over all images. Dashed
    placeholder of the same size when the record has none, so grid columns
    stay aligned. Never bubbles the click (row-click / card select stay put). */
export function ImageThumb({
  images,
  index = 0,
  size = 28,
  alt = "Image",
}: {
  images: DesignImage[];
  /** Which image the thumb shows (and the lightbox opens on); default = front view. */
  index?: number;
  size?: number;
  alt?: string;
}) {
  const [viewer, setViewer] = useState<number | null>(null);
  const box = { width: size, height: size, borderRadius: size >= 40 ? 8 : 6, flex: "0 0 auto" } as const;
  const img = images[index];
  if (!img) {
    return <span className="dim" title="No image" style={{ ...box, display: "inline-block", border: "1px dashed var(--border)" }} />;
  }
  return (
    <>
      <img
        src={designImageUrl(img.id)}
        alt={alt}
        loading="lazy"
        title="Click to view"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setViewer(index);
        }}
        style={{ ...box, objectFit: "cover", border: "1px solid var(--border)", cursor: "zoom-in", display: "inline-block", verticalAlign: "middle" }}
      />
      {viewer !== null && <ImageLightbox images={images} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
    </>
  );
}
