/* ============================================================
   Panel master (Panel Craft) — typed Data Store wrapper over lib/dataOps.

   A Panel is a printed showcase banner: header (panel_code, panel size,
   vinyl size) + PanelLine rows (design + cut piece size + cut piece qty —
   how many cut pieces of that design go on the panel; NOT stock).
   Design names/sizes hydrate from the designsApi cache; cut sizes from
   the CutPieceSize lookup. Every write is recorded in OperationLog.
   ============================================================ */
import { insert, listAll, op, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import { listDesigns, parseImages, type DesignImage } from "@/features/masters/designsApi";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

export interface CutSizeOption {
  id: string; // CutPieceSize ROWID
  label: string;
}

export interface PanelLineRow {
  id: string; // PanelLine ROWID
  designId: string;
  designName: string; // unique item name (fallback design name)
  sizeLabel: string; // the design's Available Size, from the Design master
  cutSizeId: string;
  cutSizeName: string;
  qty: number; // cut pieces of this design on the panel
}

export interface PanelRow {
  id: string; // ROWID
  panelCode: string;
  panelSize: string;
  vinylSize: string;
  images: DesignImage[]; // File Store images, same shape as Design.image_urls
  lines: PanelLineRow[];
  createdTime: string;
  modifiedTime: string;
}

/* Stale-while-revalidate cache (lib/cache); mutations below invalidate. */
const cache = createListCache(fetchPanels);

/** Last fetched panels, or null if never fetched this session. */
export function cachedPanels(): PanelRow[] | null {
  return cache.cached()?.panels ?? null;
}
/** Last fetched cut-size options ([] if never fetched this session). */
export function cachedCutSizes(): CutSizeOption[] {
  return cache.cached()?.cutSizes ?? [];
}
/** Drop the cache so the next listPanels() hits the network. */
export function invalidatePanels(): void {
  cache.invalidate();
}
/** Patch one panel in the snapshot (no refetch) — image saves. */
export function patchPanelCache(id: string, patch: Partial<PanelRow>): void {
  cache.patch((v) => ({ ...v, panels: v.panels.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
}

/** All panels (lines hydrated) + CutPieceSize options. Cached + deduped. */
export function listPanels(): Promise<{
  ok: boolean;
  panels: PanelRow[];
  cutSizes: CutSizeOption[];
  error?: string;
}> {
  return cache.load();
}

async function fetchPanels(): Promise<{
  ok: boolean;
  panels: PanelRow[];
  cutSizes: CutSizeOption[];
  error?: string;
}> {
  const [panels, lines, cuts, designsRes] = await Promise.all([
    listAll("Panel", { order: "ROWID desc" }),
    listAll("PanelLine"),
    listAll("CutPieceSize", { order: "name" }),
    listDesigns(), // cached — hydrates design name + Available Size labels
  ]);
  if (!panels.ok) return { ok: false, panels: [], cutSizes: [], error: panels.error };

  const designById = new Map(
    (designsRes.ok ? designsRes.designs : []).map((d) => [d.id, d]),
  );
  const cutSizes: CutSizeOption[] = (cuts.rows || [])
    .map((r) => ({ id: String(r.ROWID), label: str(r.name) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const cutById = new Map(cutSizes.map((c) => [c.id, c.label]));

  const linesByPanel = new Map<string, PanelLineRow[]>();
  for (const l of lines.rows || []) {
    const panelId = str(l.panel);
    if (!panelId) continue;
    const designId = str(l.design);
    const d = designById.get(designId);
    const row: PanelLineRow = {
      id: String(l.ROWID),
      designId,
      designName: d?.uniqueName || d?.designName || "—",
      sizeLabel: d?.sizeLabel || "",
      cutSizeId: str(l.cut_piece_size),
      cutSizeName: cutById.get(str(l.cut_piece_size)) || "",
      qty: num(l.cut_piece_qty),
    };
    (linesByPanel.get(panelId) ?? linesByPanel.set(panelId, []).get(panelId)!).push(row);
  }

  const rows: PanelRow[] = (panels.rows || []).map((p) => ({
    id: String(p.ROWID),
    panelCode: str(p.panel_code),
    panelSize: str(p.panel_size),
    vinylSize: str(p.vinyl_size),
    images: parseImages(str(p.image_urls)),
    lines: linesByPanel.get(String(p.ROWID)) ?? [],
    createdTime: str(p.CREATEDTIME),
    modifiedTime: str(p.MODIFIEDTIME),
  }));

  return { ok: true, panels: rows, cutSizes };
}

export interface PanelLineInput {
  design: string; // Design ROWID
  cut_piece_size: string; // CutPieceSize ROWID
  cut_piece_qty: number;
}

export interface PanelInput {
  panel_code: string;
  panel_size: string;
  vinyl_size: string;
  lines: PanelLineInput[];
}

function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    return r;
  });
}

/** Create/update via /panel-save — server replaces lines wholesale.
    Pure master data: no cut-piece stock movement. */
function savePanel(input: PanelInput, rowid?: string): Promise<OpResult> {
  return bust(
    op("panel-save", {
      rowid,
      panel_code: input.panel_code.trim(),
      panel_size: input.panel_size.trim(),
      vinyl_size: input.vinyl_size.trim(),
      lines: input.lines,
    }),
  );
}

export function createPanel(input: PanelInput): Promise<OpResult> {
  return savePanel(input);
}

export function updatePanel(rowid: string, input: PanelInput): Promise<OpResult> {
  return savePanel(input, rowid);
}

/** Soft-delete via /panel-delete. No stock movement. */
export function deletePanel(panel: PanelRow): Promise<OpResult> {
  return bust(op(`panel-delete/${panel.id}`, {}));
}

export interface BulkResult {
  ok: boolean;
  done: number;
  failed: number;
  firstError?: string;
}

export async function bulkDeletePanels(panels: PanelRow[]): Promise<BulkResult> {
  const results = await Promise.all(panels.map(deletePanel));
  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    done: results.length - failed.length,
    failed: failed.length,
    firstError: failed[0]?.error,
  };
}

/** Create a CutPieceSize from the form's Combobox "Create …" row
    (write-through, same pattern as DesignForm's createPartyBrand).
    ponytail: no seq_code here — the Masters editor assigns them. */
export function createCutSize(name: string): Promise<OpResult> {
  return bust(insert("CutPieceSize", { name: name.trim() }));
}
