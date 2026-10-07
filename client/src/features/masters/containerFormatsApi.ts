/* ============================================================
   Container Master (CR-261) — typed Data Store wrapper over lib/dataOps.

   A ContainerFormat is what ONE container of ONE size holds: the pallet
   formats of that size with a count each. A Size may have SEVERAL
   containers (CR-273): a loading picks the one it uses (LoadBox.container_format);
   readers with no pick fall back to the size's largest (defaultFormatBySize).
   Per-container capacity for the planner, loading fill % and palletization
   comes from here — never from the Pallet master, which is "boxes per pallet"
   only since CR-261.

   ponytail: pallet lines live in a JSON column (pallets_json), no child
   table — totals are denormalised on save so capacity readers project
   two int columns and nothing else.
   ============================================================ */
import { useEffect, useState } from "react";
import { listAll, insert, update, remove, type DSRow, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import { listPallets, type PalletRow, type SizeOption } from "./palletsApi";
import { resolveFormatBySize } from "@/features/quotes/containerOptions";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

export interface ContainerFormatLine {
  palletId: string;
  palletName: string;
  boxesPerPallet: number;
  count: number;
  boxes: number; // count × boxesPerPallet
}

export interface ContainerFormatRow {
  id: string;
  name: string;
  sizeId: string;
  sizeLabel: string;
  lines: ContainerFormatLine[];
  totalPallets: number;
  totalBoxes: number;
  remarks: string;
  createdTime: string;
  modifiedTime: string;
}

/** What the form saves. Totals + name are formula-owned (see totalsOf / nameOf). */
export interface ContainerFormatInput {
  size: string; // Size ROWID — required
  lines: { palletId: string; count: number }[];
  remarks: string;
}

type StoredLine = { pallet: string; count: number };

export function parseLines(json: unknown): StoredLine[] {
  try {
    const v = JSON.parse(str(json) || "[]");
    return Array.isArray(v) ? v.map((l) => ({ pallet: str(l?.pallet), count: num(l?.count) })).filter((l) => l.pallet && l.count > 0) : [];
  } catch {
    return [];
  }
}

export function totalsOf(lines: { count: number; boxesPerPallet: number }[]) {
  return {
    totalPallets: lines.reduce((s, l) => s + l.count, 0),
    totalBoxes: lines.reduce((s, l) => s + l.count * l.boxesPerPallet, 0),
  };
}

export const nameOf = (sizeLabel: string, totalPallets: number, totalBoxes: number) =>
  `${sizeLabel || "Container"} · ${totalPallets} pallets = ${totalBoxes} boxes`;

/** Fallback when nothing picked a container: Size ROWID → the size's LARGEST container
    (most boxes; ties → the first met, i.e. newest since rows come ROWID desc). */
export function defaultFormatBySize(rows: ContainerFormatRow[]): Map<string, ContainerFormatRow> {
  return resolveFormatBySize(rows, {}); // CR-274: one rule, shared with the planner's per-size pick
}

const cache = createListCache(fetchContainerFormats);

/** Cached-first list of container formats for any component (CR-273: loading picker, labels). */
export function useContainerFormats(): ContainerFormatRow[] {
  const [formats, setFormats] = useState<ContainerFormatRow[]>(() => cache.cached()?.formats ?? []);
  useEffect(() => {
    void cache.load().then((r) => r.ok && setFormats(r.formats));
  }, []);
  return formats;
}

export function cachedContainerFormats(): ContainerFormatRow[] | null {
  return cache.cached()?.formats ?? null;
}
export function invalidateContainerFormats(): void {
  cache.invalidate();
}
export function listContainerFormats(): Promise<{ ok: boolean; formats: ContainerFormatRow[]; pallets: PalletRow[]; sizes: SizeOption[]; error?: string }> {
  return cache.load();
}

async function fetchContainerFormats() {
  const [rows, pal] = await Promise.all([listAll("ContainerFormat", { order: "ROWID desc" }), listPallets()]);
  if (!rows.ok) return { ok: false, formats: [], pallets: [], sizes: [], error: rows.error };
  if (!pal.ok) return { ok: false, formats: [], pallets: [], sizes: [], error: pal.error };
  const palletById = new Map(pal.pallets.map((p) => [p.id, p]));
  const sizeLabel = new Map(pal.sizes.map((s) => [s.id, s.label]));
  const formats: ContainerFormatRow[] = (rows.rows || []).map((r: DSRow) => {
    const lines: ContainerFormatLine[] = parseLines(r.pallets_json).map((l) => {
      const p = palletById.get(l.pallet);
      const bpp = p?.boxesPerPallet ?? 0;
      return { palletId: l.pallet, palletName: p?.name || "—", boxesPerPallet: bpp, count: l.count, boxes: l.count * bpp };
    });
    const sizeId = str(r.size);
    return {
      id: String(r.ROWID),
      name: str(r.name),
      sizeId,
      sizeLabel: sizeLabel.get(sizeId) || "",
      lines,
      // Stored totals win (what the planner read); fall back to the lines for a row saved blank.
      totalPallets: num(r.total_pallets) || totalsOf(lines).totalPallets,
      totalBoxes: num(r.total_boxes) || totalsOf(lines).totalBoxes,
      remarks: str(r.remarks),
      createdTime: str(r.CREATEDTIME),
      modifiedTime: str(r.MODIFIEDTIME),
    };
  });
  return { ok: true, formats, pallets: pal.pallets, sizes: pal.sizes };
}

function toPayload(input: ContainerFormatInput, pallets: PalletRow[], sizes: SizeOption[]): Record<string, unknown> {
  const lines = input.lines
    .filter((l) => l.palletId && l.count > 0)
    .map((l) => ({ ...l, boxesPerPallet: pallets.find((p) => p.id === l.palletId)?.boxesPerPallet ?? 0 }));
  const { totalPallets, totalBoxes } = totalsOf(lines);
  return {
    name: nameOf(sizes.find((s) => s.id === input.size)?.label || "", totalPallets, totalBoxes),
    size: input.size,
    pallets_json: JSON.stringify(lines.map((l) => ({ pallet: l.palletId, count: l.count }))),
    total_pallets: totalPallets,
    total_boxes: totalBoxes,
    remarks: input.remarks.trim(),
  };
}

function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    return r;
  });
}

export function createContainerFormat(input: ContainerFormatInput, pallets: PalletRow[], sizes: SizeOption[]): Promise<OpResult> {
  return bust(insert("ContainerFormat", toPayload(input, pallets, sizes)));
}
export function updateContainerFormat(rowid: string, input: ContainerFormatInput, pallets: PalletRow[], sizes: SizeOption[]): Promise<OpResult> {
  return bust(update("ContainerFormat", rowid, toPayload(input, pallets, sizes)));
}
export function deleteContainerFormat(rowid: string, reason?: string): Promise<OpResult> {
  return bust(remove("ContainerFormat", rowid, reason));
}
export async function bulkDeleteContainerFormats(rowids: string[], reason?: string) {
  const results = await Promise.all(rowids.map((id) => remove("ContainerFormat", id, reason)));
  cache.invalidate();
  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, done: results.length - failed.length, failed: failed.length, firstError: failed[0]?.error };
}
