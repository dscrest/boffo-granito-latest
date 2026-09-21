/* ============================================================
   Plan Containerisation — /quotes/:id/containerise (More menu) and
   /orders/:id/containerise (SO owns an editable copy of the plan,
   snapshotted from the quote at conversion). ContainerisePlanner is
   the shared body; the two thin wrappers below differ only in where
   lines seed from and what Save persists (quote: full line set +
   plan · SO: the plan JSON only — SO lines are never rewritten here).

   Item-wise container planning for a quote, in one of two modes
   (same view, same details):
   · Box Fitting (default) — capacity from the chosen Pallet format:
     pallets/container × boxes/pallet = boxes per container.
   · Weight Fitting — each container has a Ton capacity (default 28 t,
     editable) and boxes-per-container = floor(tonCapacity·1000 /
     boxWeightKg) from the Item's per-box weight (Size default, per-item
     override), falling back to the Pallet format's.
   Packing is strictly item-wise, in line order (line 1
   first): every container starts with a single item, so raising an
   item's quantity refills its own partial container before opening a
   new one — it never spills into another item's container on its own.
   On top of that auto-pack the user can MOVE boxes between containers
   (⇄ Move on an item inside a container, drag a card onto another, or
   the Adjust panel's Move suggestions), which may mix items in one
   container; fill is then fractional — each item's boxes against its
   own capacity, as on the dispatch board. A move is a ROW operation:
   the moved boxes become their own row sharing a `group` with the
   target container's rows, and grouped rows pack into one container.
   A saved multi-line container reseeds as grouped rows, so merges
   survive Save + reopen.

   Items are fully editable here: change the item, edit the quantity
   (no cap) and rate, add brand-new items, or remove lines. Save
   persists the full line set (add/remove/change) to the quote in one
   update-quote-with-items call (which replaces all lines wholesale),
   together with a container-plan snapshot + the ton capacity.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { useModalA11y } from "@/ui/useModalA11y";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { parseContainerPlan, type ContainerPlan, type Order, type Quote } from "@/data";
import { update } from "@/lib/dataOps";
import { useMasters } from "@/features/masters/useMasters";
import { listPallets, cachedPallets, palletsForSize, widthOf, type PalletRow } from "@/features/masters/palletsApi";
import { listBatchStock, cachedBatchStock, type BatchStockRow } from "@/features/stages/batchStockApi";
import type { DesignRow } from "@/features/masters/designsApi";
import { cachedOrders, invalidateOrders, listOrders, soStatusLabel, SO_STATUS_CHIP } from "@/features/orders/ordersApi";
import { STATUS_CHIP, STATUS_LABEL, quoteToInput } from "./QuotesTable";
import { cellsOfSegs, emptyCells, packItemWise } from "./containerPack";
import {
  cachedQuotes,
  invalidateQuotes,
  listQuotes,
  updateQuoteWithItems,
} from "./quotesApi";

/* Slot colors per line index — existing stage accent palette. */
const LINE_COLORS = ["var(--c-blue)", "var(--c-green)", "var(--c-amber)", "var(--c-violet)", "var(--c-cyan)"];

const EPS = 1e-6;
const DEFAULT_TON_CAPACITY = 28;
const round1 = (n: number) => Math.round(n * 10) / 10;


/** Reopen a saved plan as editable row groups (design → one entry per row):
 *  each plan line starts a new group, except an auto-overflow continuation —
 *  previous container is single-line, full, same design + pallet, and the line
 *  opens its container — which merges back into the previous group. So a
 *  deliberate clone split (300+200, first container partial) survives reopen,
 *  while a plain overflow (400 filling C1 + 100) reseeds as one row. Lines of
 *  a MIXED container (>1 lines) each become a row carrying that container's
 *  `group`, so grouped packing rebuilds the merge exactly. */
// ponytail: a split whose first part exactly fills a container merges back to one row — it repacks to the identical plan, only the visual row split is lost
function planRowGroups(plan: ContainerPlan | null) {
  const groups = new Map<string, { qty: number; palletId: string; group?: string; over?: boolean }[]>();
  const containers = plan?.containers ?? [];
  containers.forEach((c, i) => {
    // An overridden (>100%) container reseeds grouped + over even when single-line (CR-196).
    const mixed = c.lines.length > 1 || !!c.over;
    c.lines.forEach((ln, j) => {
      const list = groups.get(ln.design) ?? [];
      const prev = i > 0 ? containers[i - 1] : undefined;
      const overflow =
        !mixed && j === 0 && prev?.lines.length === 1 && !prev.over && prev.fillPct >= 100 &&
        prev.lines[0].design === ln.design && (prev.lines[0].palletId || "") === (ln.palletId || "");
      if (overflow && list.length) list[list.length - 1].qty += ln.boxes;
      else list.push({ qty: ln.boxes, palletId: ln.palletId || "", ...(mixed ? { group: `C${c.no ?? i + 1}` } : {}), ...(c.over ? { over: true } : {}) });
      groups.set(ln.design, list);
    });
  });
  return groups;
}

/** Collapse draft rows to one line per item — mirrors what the quote save persists. */
function mergeByItem(valid: DraftLine[]) {
  const merged = new Map<string, { item: string; qty: number; rate: number; discount: number; description: string }>();
  for (const l of valid) {
    const m = merged.get(l.item);
    if (m) m.qty += l.qty;
    else merged.set(l.item, { item: l.item, qty: l.qty, rate: l.rate, discount: l.discount || 0, description: l.description || "" });
  }
  return [...merged.values()];
}

/** An editable plan line (the local source of truth; seeded from the quote). */
interface DraftLine {
  key: string; // stable local id (React key)
  item: string; // design name (matches DesignRow.designName)
  qty: number; // boxes (freely editable, ≥ 0)
  rate: number; // per box
  discount: number; // percent (preserved)
  description: string; // preserved
  palletId: string; // chosen pallet ROWID ("" = auto best-size match)
  ordered?: number; // original quote qty for this row (reference only; undefined for new lines)
  group?: string; // rows sharing a group pack into ONE (mixed) container — set by a Move
  over?: boolean; // manual override: the group's container may exceed 100% (CR-196)
}

interface ResolvedLine {
  key: string;
  idx: number; // draftLines index (stable within a render: color + seg join)
  item: string;
  sku: string;
  designId: string;
  qty: number;
  rate: number;
  ordered?: number;
  group?: string;
  over?: boolean;
  boxWeightKg: number; // per box
  tonnes: number; // qty * boxWeightKg / 1000 (0 when weight unknown)
  palletId: string;
  palletName: string;
  palletOptions: { value: string; label: string }[];
  boxesPerPallet: number;
  boxesPerContainer: number; // Pallet format: total boxes per container (arr. A + B)
  palletsPerContainer: number; // Pallet format: total pallets per container (arr. A + B)
  capacityBoxes: number; // boxes mode: boxesPerContainer · weight mode: floor(tonCapacity·1000 / boxWeightKg)
  pallets: number; // ceil(qty / boxesPerPallet)
  color: string;
  packable: boolean;
  reason?: string; // when !packable
}
/** A line's boxes inside one container. */
interface Seg {
  idx: number;
  boxes: number;
}
interface PackedContainer {
  segs: Seg[]; // one seg per item; >1 for a merged (mixed) container
  fill: number; // Σ per-seg boxes / that line's capacity — ≤ 1 by construction
  capTons: number; // weight mode: this container's weight cap (override or global default) · boxes mode: derived from the owner line
  capBoxes: number; // owner (first) line's capacity in this container — per-item fits come from fitBoxesIn
}

/** What the shared planner needs from its document (quote or SO). */
interface PlannerProps {
  docNo: string;
  statusChip: { cls: string; label: string };
  customer: string;
  partyCode: string;
  /** Extra " · "-joined subtitle segments after the customer link (date, port). */
  subtitleExtras: string[];
  /** Where the ✕ close button navigates. */
  closeTo: string;
  /** Embedded in another page (LoadingDetail tab): hide the ✕ close button. */
  embedded?: boolean;
  /** Seed lines (keys assigned internally); re-seeded when seedKey changes. */
  seedLines: Omit<DraftLine, "key">[];
  seedKey: string;
  /** The persisted container-plan JSON ("" when none) — drives mode restore + dirty. */
  savedPlan: string;
  pallets: PalletRow[];
  canSave: boolean;
  saving: boolean;
  saveTitle: string;
  /** Extra dirty signal beyond the plan JSON (quote wrapper: line diffs). */
  linesDirty?: (lines: DraftLine[]) => boolean;
  onSave: (planJson: string, valid: DraftLine[]) => Promise<void>;
}

function ContainerisePlanner({
  docNo, statusChip, customer, partyCode, subtitleExtras, closeTo, embedded,
  seedLines, seedKey, savedPlan, pallets, canSave, saving, saveTitle, linesDirty, onSave,
}: PlannerProps) {
  const navigate = useNavigate();
  const { designRows, designs } = useMasters();

  const [selected, setSelected] = useState<number | null>(null); // container index; null = tail
  const [mode, setMode] = useState<"boxes" | "weight">("boxes"); // fitting basis
  const [tonCapacity, setTonCapacity] = useState<number>(DEFAULT_TON_CAPACITY); // weight mode: global default
  const [capByIdx, setCapByIdx] = useState<Record<number, number>>({}); // per-container ton overrides, by position
  // Editable plan lines — the local source of truth; seeded from the quote.
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  // Drag/prompt state for the move flow (the move itself edits draftLines).
  const [dragFrom, setDragFrom] = useState<number | null>(null); // dragged container position
  const [overIdx, setOverIdx] = useState<number | null>(null); // drop-target highlight
  const [movePrompt, setMovePrompt] = useState<{ from: number; to: number; key: string; over?: boolean } | null>(null);
  const [moveCount, setMoveCount] = useState(0);
  const promptRef = useModalA11y(() => setMovePrompt(null));

  const keySeq = useRef(0);
  const nextKey = () => `L${keySeq.current++}`;

  // Batch stock per item — shown under the Item picker (same source as
  // Stock Details / the item Stock tab; cached + deduped app-wide).
  const [batchStock, setBatchStock] = useState<BatchStockRow[]>(() => cachedBatchStock() ?? []);
  useEffect(() => {
    void listBatchStock().then((r) => r.ok && setBatchStock(r.rows));
  }, []);
  const batchesByItem = useMemo(() => {
    const m = new Map<string, BatchStockRow[]>();
    for (const b of batchStock) {
      if (!b.batchNumber || b.current <= 0) continue;
      const list = m.get(b.designName) ?? [];
      list.push(b);
      m.set(b.designName, list);
    }
    return m;
  }, [batchStock]);

  // Re-seed editable lines + ton capacity whenever the underlying document changes.
  useEffect(() => {
    setDraftLines(seedLines.map((l) => ({ ...l, key: nextKey() })));
    const saved = parseContainerPlan(savedPlan);
    // Saved plans reopen in their own mode; pre-mode plans were weight-packed.
    setMode(saved ? (saved.mode ?? "weight") : "boxes");
    const g = saved?.tonCapacity && saved.tonCapacity > 0 ? saved.tonCapacity : DEFAULT_TON_CAPACITY;
    setTonCapacity(g);
    const caps: Record<number, number> = {};
    saved?.containers?.forEach((c, i) => {
      if (c.tonCapacity && c.tonCapacity > 0 && c.tonCapacity !== g) caps[i] = c.tonCapacity;
    });
    setCapByIdx(caps);
  }, [seedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- resolve each draft line: design → size-matched pallet → weight capacity ---- */
  const rows = useMemo<ResolvedLine[]>(() => {
    const tonKg = Math.max(1, tonCapacity) * 1000;
    return draftLines.map((dl, idx) => {
      const color = LINE_COLORS[idx % LINE_COLORS.length];
      const base = { key: dl.key, idx, item: dl.item, qty: Math.max(0, dl.qty), rate: dl.rate, ordered: dl.ordered, group: dl.group, over: dl.over, color };
      const fail = (reason: string, extra: Partial<ResolvedLine> = {}): ResolvedLine => ({
        ...base,
        sku: "",
        designId: extra.designId ?? "",
        boxWeightKg: extra.boxWeightKg ?? 0,
        tonnes: extra.tonnes ?? 0,
        palletId: extra.palletId ?? "",
        palletName: "",
        palletOptions: extra.palletOptions ?? [],
        boxesPerPallet: 0,
        boxesPerContainer: 0,
        palletsPerContainer: 0,
        capacityBoxes: 0,
        pallets: 0,
        packable: false,
        reason,
      });

      if (!dl.item) return fail("choose an item");
      // uniqueName first; design_name fallback keeps old saved plan drafts packable.
      const d: DesignRow | undefined = designRows.find((x) => x.uniqueName === dl.item || x.designName === dl.item);
      if (!d) return fail("item not found in Item master");

      // Pallet specs offered = the item's own size first, then the shared size rule
      // (palletsForSize: same WxH, size-less always). ponytail: a size with NO
      // same-size pallet still falls back to the width so old plans keep packing.
      const w = widthOf(d.sizeLabel);
      const exact = pallets.filter((p) => p.sizeId && p.sizeId === d.sizeId);
      const sized = palletsForSize(pallets, d.sizeLabel).filter((p) => !exact.includes(p));
      const wide = exact.length || sized.some((p) => p.sizeId) ? [] : pallets.filter((p) => p.sizeId && !sized.includes(p) && (!w || widthOf(p.sizeLabel) === w));
      const opts = [...exact, ...sized, ...wide].filter((p) => p.boxesPerPallet > 0);
      const palletOptions = opts.map((p) => ({ value: p.id, label: p.name }));
      if (opts.length === 0) return fail("no Pallet format for this size", { designId: d.id, boxWeightKg: d.boxWeightKg, tonnes: base.qty * (d.boxWeightKg || 0) / 1000 });

      const chosen = opts.find((p) => p.id === dl.palletId) || opts[0];
      // CR-190: the Item's (overridable) box weight wins; the Pallet format's is the fallback —
      // same order as the server loading-capacity check.
      const boxWeightKg = d.boxWeightKg || chosen.boxWeightKg;
      const tonnes = base.qty * boxWeightKg / 1000;
      const capacityBoxes =
        mode === "boxes"
          ? chosen.totalBoxesPerContainer
          : boxWeightKg > 0 ? Math.floor(tonKg / boxWeightKg) : 0;
      if (capacityBoxes < 1) {
        const reason =
          mode === "boxes"
            ? `no pallets/container on Pallet format “${chosen.name}”`
            : boxWeightKg > 0 ? "box heavier than container capacity" : "no box weight — set it on the Item (or Size) master";
        return fail(reason, {
          designId: d.id,
          boxWeightKg,
          tonnes,
          palletId: chosen.id,
          palletOptions,
        });
      }
      return {
        ...base,
        sku: d.sku,
        designId: d.id,
        boxWeightKg,
        tonnes,
        palletId: chosen.id,
        palletName: chosen.name,
        palletOptions,
        boxesPerPallet: chosen.boxesPerPallet,
        boxesPerContainer: chosen.totalBoxesPerContainer,
        palletsPerContainer: chosen.totalPalletsPerContainer,
        capacityBoxes,
        pallets: Math.ceil(base.qty / chosen.boxesPerPallet),
        packable: base.qty > 0,
        reason: base.qty > 0 ? undefined : "quantity is 0",
      };
    });
  }, [draftLines, mode, tonCapacity, designRows, pallets]);

  const lines = useMemo(() => rows.filter((r) => r.packable), [rows]);

  /* ---- pack item-wise: each container starts with a single item, in line
     order. Boxes mode: capacity from the item's Pallet-format boxes-per-
     container. Weight mode: each container (by position) fills to its own ton
     capacity (global default or capByIdx override), converted to boxes by the
     item's box weight. Rows sharing a `group` (a Move's result) pack into one
     container, mixing items there — fill becomes fractional (each line's
     boxes / that line's own capacity); a grouped qty beyond the free space
     spills item-wise, so edits degrade gracefully. ---- */
  const containers = useMemo<PackedContainer[]>(() => {
    const capTonsAt = (pos: number) => Math.max(1, capByIdx[pos] ?? tonCapacity);
    const byIdx = (idx: number) => lines.find((x) => x.idx === idx);
    // Boxes of line l a container at this position can hold on its own.
    const lineCapIn = (l: ResolvedLine, pos: number) =>
      mode === "boxes"
        ? l.boxesPerContainer
        : l.boxWeightKg > 0
          ? Math.floor((capTonsAt(pos) * 1000) / l.boxWeightKg)
          : l.capacityBoxes;
    const fillOf = (c: { segs: Seg[] }, pos: number) =>
      c.segs.reduce((s, x) => {
        const l = byIdx(x.idx);
        return l ? s + x.boxes / Math.max(1, lineCapIn(l, pos)) : s;
      }, 0);

    // Item-wise in line order; grouped rows share one container.
    const list: { segs: Seg[] }[] = packItemWise(lines, (idx, pos) => {
      const l = byIdx(idx);
      return l ? lineCapIn(l, pos) : 0;
    }).map((segs) => ({ segs }));

    return list.map((c, pos) => {
      const owner = byIdx(c.segs[0]?.idx);
      const capBoxes = owner ? lineCapIn(owner, pos) : 0;
      return {
        segs: c.segs,
        fill: fillOf(c, pos),
        capBoxes,
        capTons: mode === "boxes" ? (owner ? capBoxes * owner.boxWeightKg / 1000 : 0) : capTonsAt(pos),
      };
    });
  }, [lines, mode, tonCapacity, capByIdx]);

  // Remaining to plan per ITEM — ordered boxes not yet in the Boxes (plan)
  // column across all rows of that item (a cloned split mustn't double-count).
  // Only the row carrying `ordered` shows it; clones show "—".
  const qtyByItem = rows.reduce((m, l) => m.set(l.item, (m.get(l.item) ?? 0) + l.qty), new Map<string, number>());
  const remainingOf = (l: { item: string; ordered?: number }) =>
    l.ordered == null ? null : Math.max(0, l.ordered - (qtyByItem.get(l.item) ?? 0));
  const totalRemaining = rows.reduce((s, l) => s + (remainingOf(l) ?? 0), 0);

  const totalBoxes = lines.reduce((s, l) => s + l.qty, 0);
  const totalPalletsCount = lines.reduce((s, l) => s + l.pallets, 0);
  const totalTonnes = rows.reduce((s, l) => s + l.tonnes, 0);
  const totalFrac = containers.reduce((s, c) => s + c.fill, 0);
  const nContainers = containers.length;
  const anyPartial = containers.some((c) => c.fill < 1 - EPS);
  const balanced = nContainers > 0 && !anyPartial;

  const sel = Math.min(selected ?? Math.max(0, nContainers - 1), Math.max(0, nContainers - 1));
  const selContainer = containers[sel];

  const lineOf = (idx: number | null | undefined) => lines.find((x) => x.idx === idx);
  const tonnesIn = (c: PackedContainer) =>
    c.segs.reduce((s, x) => {
      const l = lineOf(x.idx);
      return l ? s + x.boxes * l.boxWeightKg / 1000 : s;
    }, 0);

  /* ---- box movability: fit hint + drag-a-card-onto-another + move prompt ---- */
  // How many boxes of line l still fit in container i — the shared hint formula
  // (free fraction × that line's own capacity, as on the dispatch board).
  const fitBoxesIn = (l: ResolvedLine, i: number) => {
    const c = containers[i];
    if (!c) return 0;
    const cap =
      mode === "boxes"
        ? l.boxesPerContainer
        : l.boxWeightKg > 0 ? Math.floor((c.capTons * 1000) / l.boxWeightKg) : l.capacityBoxes;
    return Math.max(0, Math.floor((1 - c.fill) * cap + EPS));
  };
  // Open the move prompt for line `key` sitting in container `from`; `to`
  // defaults to the first other container with room (the prompt lets you change it).
  const openMove = (from: number, key: string, to?: number) => {
    const l = lines.find((x) => x.key === key);
    const seg = containers[from]?.segs.find((s) => s.idx === l?.idx);
    if (!l || !seg) return;
    const roomy = containers.findIndex((_, i) => i !== from && fitBoxesIn(l, i) > 0);
    // Nothing has room → still open, pre-ticked for the manual override (CR-196).
    const target = to ?? (roomy >= 0 ? roomy : containers.findIndex((_, i) => i !== from));
    if (target < 0 || target === from) {
      toast.error(`No other container to move ${l.item} into`);
      return;
    }
    const fit = fitBoxesIn(l, target);
    setMoveCount(fit < 1 ? seg.boxes : Math.min(seg.boxes, fit));
    setMovePrompt({ from, to: target, key, over: fit < 1 });
  };
  // Dragging a card moves its last seg's item (the movable one on mixed cards).
  const movableSegOf = (i: number) => containers[i]?.segs[containers[i].segs.length - 1];
  const dragLine = dragFrom != null ? lineOf(movableSegOf(dragFrom)?.idx) : undefined;
  const onDropCard = (to: number) => {
    const from = dragFrom;
    setDragFrom(null);
    setOverIdx(null);
    if (from == null || from === to || !dragLine) return;
    openMove(from, dragLine.key, to);
  };
  const promptLine = movePrompt ? lines.find((x) => x.key === movePrompt.key) : undefined;
  const promptSeg = movePrompt && promptLine ? containers[movePrompt.from]?.segs.find((s) => s.idx === promptLine.idx) : undefined;
  const promptFit = movePrompt && promptLine ? fitBoxesIn(promptLine, movePrompt.to) : 0;
  const maxMove = promptSeg ? (movePrompt?.over ? promptSeg.boxes : Math.min(promptSeg.boxes, promptFit)) : 0;
  const effMove = Math.max(0, Math.min(moveCount, maxMove));
  const promptTargets = movePrompt && promptLine
    ? containers.map((_, i) => ({ value: String(i), label: `C${i + 1} · can take ${fmt(fitBoxesIn(promptLine, i))} boxes` })).filter((_, i) => i !== movePrompt.from)
    : [];

  /* Move = row edit: the moved boxes become a row sharing the target
     container's `group` (minted on the target's owner row if it has none —
     splitting that row when only its last, partial container is the target).
     ponytail: moving out of a FULL container of a row that also has a partial one repacks the row, so the boxes effectively leave the partial — totals right, arrangement differs */
  const moveBoxes = (from: number, to: number, key: string, n: number, over = false) => {
    const owner = lineOf(containers[to]?.segs[0]?.idx);
    const ownerSeg = containers[to]?.segs[0];
    if (!owner || !ownerSeg || n < 1 || from === to) return;
    const group = owner.group || nextKey();
    setDraftLines((ls) => {
      const split = (arr: DraftLine[], k: string, boxes: number, g: string) =>
        arr.flatMap((l) => {
          if (l.key !== k) return [l];
          if (boxes >= l.qty) return [{ ...l, group: g }];
          return [{ ...l, qty: l.qty - boxes }, { ...l, key: nextKey(), qty: boxes, group: g, ordered: undefined }];
        });
      const withTarget = owner.group ? ls : split(ls, owner.key, ownerSeg.boxes, group);
      // Override is group-level: packing is line-ordered, so a row-level flag
      // would let whichever row packs second get clamped and spill.
      const moved = split(withTarget, key, n, group);
      return over ? moved.map((l) => (l.group === group ? { ...l, over: true } : l)) : moved;
    });
    setSelected(to);
  };
  const confirmMove = () => {
    if (!movePrompt || !promptLine || effMove < 1) return;
    moveBoxes(movePrompt.from, movePrompt.to, promptLine.key, effMove, !!movePrompt.over && effMove > promptFit);
    setMovePrompt(null);
  };

  /* ---- snapshot: what Save publishes for downstream (SO detail, dispatch board) ---- */
  const planJson = useMemo(() => {
    if (!containers.length) return "";
    const plan: ContainerPlan = {
      v: 1,
      mode,
      ...(mode === "weight" ? { tonCapacity: Math.max(1, tonCapacity) } : {}),
      containers: containers.map((c, i) => {
        const segLines = c.segs.flatMap((s) => {
          const l = lineOf(s.idx);
          return l
            ? [{ design: l.item, palletId: l.palletId, palletName: l.palletName, pallets: Math.ceil(s.boxes / l.boxesPerPallet), boxes: s.boxes }]
            : [];
        });
        return {
          no: i + 1,
          fillPct: Math.round(c.fill * 100),
          ...(c.fill > 1 + EPS ? { over: true } : {}),
          pallets: segLines.reduce((s, x) => s + x.pallets, 0),
          boxes: segLines.reduce((s, x) => s + x.boxes, 0),
          tonnes: round1(tonnesIn(c)),
          ...(mode === "weight"
            ? { tonCapacity: c.capTons }
            : { palletCapacity: lineOf(c.segs[0]?.idx)?.palletsPerContainer ?? 0 }),
          lines: segLines,
        };
      }),
    };
    return JSON.stringify(plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containers, lines, mode, tonCapacity]);

  /** Colored pallet cells of a container (single item): ceil(boxes / box-per-pallet). */
  const cellsOf = (c: PackedContainer) =>
    cellsOfSegs(c.segs.filter((s) => lineOf(s.idx)), (idx) => lineOf(idx)?.boxesPerPallet ?? 1).map((idx) => {
      const l = lineOf(idx)!;
      return { color: l.color, item: l.item };
    });
  /** Empty (hatched) cells = the container's box-capacity, in pallet units, minus used. */
  const emptyCellsOf = (c: PackedContainer, used: number) => {
    const l = lineOf(c.segs[0]?.idx);
    if (!l) return 0;
    const capCells = mode === "boxes" ? l.palletsPerContainer : Math.ceil(c.capBoxes / l.boxesPerPallet);
    return emptyCells(c.fill, capCells, used);
  };

  /* ---- line editing ---- */
  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setDraftLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) =>
    setDraftLines((ls) => {
      const gone = ls.find((l) => l.key === key);
      const rest = ls.filter((l) => l.key !== key);
      // Removing the row that carries Ordered hands it to a surviving clone —
      // deleting the original must not blank Ordered/Remaining for the item.
      if (gone?.ordered != null) {
        const heir = rest.find((l) => l.item === gone.item && l.ordered == null);
        if (heir) return rest.map((l) => (l === heir ? { ...l, ordered: gone.ordered } : l));
      }
      return rest;
    });
  // Clone = same item on a fresh row (qty 0, no Ordered) to split across containers.
  const cloneLine = (key: string) =>
    setDraftLines((ls) => ls.flatMap((l) => (l.key === key ? [l, { ...l, key: nextKey(), ordered: undefined, qty: 0 }] : [l])));
  const addLine = () =>
    setDraftLines((ls) => [...ls, { key: nextKey(), item: "", qty: 1, rate: 0, discount: 0, description: "", palletId: "" }]);
  const setQtyByIdx = (idx: number, raw: string) => {
    const r = rows[idx];
    if (r) setLine(r.key, { qty: Math.max(0, Number(raw) || 0) });
  };
  // Mode switch re-packs under different capacities; grouped rows just overflow if they no longer fit.
  const switchMode = (m: "boxes" | "weight") => setMode(m);
  // Per-container ton override; setting it back to the global default clears it (inherits).
  const setCap = (i: number, raw: string) =>
    setCapByIdx((p) => {
      const v = Math.max(1, Number(raw) || 0);
      const next = { ...p };
      if (v === Math.max(1, tonCapacity)) delete next[i];
      else next[i] = v;
      return next;
    });

  /* ---- suggestions: trim / add-to-fill / move-here on the selected container ---- */
  let trim: { headline: string; detail: string; apply: () => void } | null = null;
  let add: { headline: string; detail: string; apply: () => void } | null = null;
  const moveIns: { headline: string; detail: string; apply: () => void }[] = [];
  if (selContainer && selContainer.fill < 1 - EPS) {
    const l = lineOf(selContainer.segs[0]?.idx);
    const boxesIn = selContainer.segs.reduce((s, x) => s + x.boxes, 0);
    if (l) {
      const upBoxes = fitBoxesIn(l, sel);
      if (upBoxes > 0)
        add = {
          headline: `Add ${fmt(upBoxes)} boxes → fill C${sel + 1}`,
          detail:
            mode === "boxes"
              ? `${fmt(upBoxes)} more boxes (~${Math.ceil(upBoxes / l.boxesPerPallet)} pallets) of ${l.item} tops C${sel + 1} up to ${fmt(l.palletsPerContainer)} pallets.`
              : `${fmt(upBoxes)} more boxes (~${Math.ceil(upBoxes / l.boxesPerPallet)} pallets) of ${l.item} tops C${sel + 1} up to ${fmt(selContainer.capTons)} t.`,
          apply: () => setLine(l.key, { qty: l.qty + upBoxes }),
        };
      if (selContainer.segs.length === 1 && boxesIn > 0 && l.qty - boxesIn > 0)
        trim = {
          headline: `Trim ${fmt(boxesIn)} boxes → drop part-full C${sel + 1}`,
          detail: `Drop ${l.item} by ${fmt(boxesIn)} boxes (~${Math.ceil(boxesIn / l.boxesPerPallet)} pallets) to ${fmt(l.qty - boxesIn)} so its earlier containers all ship full.`,
          apply: () => setLine(l.key, { qty: l.qty - boxesIn }),
        };
    }
    // Move-here: boxes from other containers that fit the selected one's free space.
    const cands: { n: number; l: ResolvedLine; from: number; newPct: number }[] = [];
    containers.forEach((c, j) => {
      if (j === sel) return;
      for (const s of c.segs) {
        const l2 = lineOf(s.idx);
        if (!l2) continue;
        const fit = fitBoxesIn(l2, sel);
        const n = Math.min(s.boxes, fit);
        if (n < 1) continue;
        const capIn =
          mode === "boxes"
            ? l2.boxesPerContainer
            : l2.boxWeightKg > 0 ? Math.floor((selContainer.capTons * 1000) / l2.boxWeightKg) : l2.capacityBoxes;
        cands.push({ n, l: l2, from: j, newPct: Math.min(100, Math.round((selContainer.fill + n / Math.max(1, capIn)) * 100)) });
      }
    });
    cands.sort((a, b) => b.newPct - a.newPct);
    for (const cand of cands.slice(0, 3)) {
      moveIns.push({
        headline: `Move ${fmt(cand.n)} boxes of ${cand.l.item} from C${cand.from + 1}`,
        detail: `C${sel + 1} can take ${fmt(cand.n)} boxes of ${cand.l.item} — fills it to ${cand.newPct}%.`,
        apply: () => moveBoxes(cand.from, sel, cand.l.key, cand.n),
      });
    }
  }

  // Dirty when the ton capacity/plan (or, for quotes, any line) differs from the saved doc.
  const dirty = planJson !== (savedPlan || "") || (linesDirty?.(draftLines) ?? false);

  const handleSave = async () => {
    if (!dirty || saving) return;
    const valid = draftLines.filter((l) => l.item && l.qty > 0);
    if (!valid.length) {
      toast.error("Add at least one item");
      return;
    }
    // container_plan is text(10000); a truncated slice stores invalid JSON that never parses back.
    if (planJson.length > 10000) {
      toast.error("Plan too large to save — reduce containers or lines");
      return;
    }
    await onSave(planJson, valid);
  };

  const itemOptions = useMemo(
    () => designs.map((x) => ({ value: x.uniqueName || x.name, label: x.uniqueName || x.name, hint: [x.size, x.finish].filter(Boolean).join(" · ") })),
    [designs],
  );

  return (
    <div className="qcplan">
      {/* Header — same card pattern as the detail pages; actions right-aligned. */}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div className="title" style={{ flex: 1, minWidth: 0, fontSize: 28, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Plan Containerisation
            </span>
            <span className="mono dim" style={{ fontSize: "var(--t-lg)", fontWeight: 500 }}>{docNo}</span>
            <span className={`chip qstatus ${statusChip.cls}`}>{statusChip.label}</span>
          </div>
          {canSave && (
            <button className="hbtn primary" disabled={!dirty || saving} onClick={() => void handleSave()} title={saveTitle}>
              <Icon name="check" size={13} /> {saving ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          )}
          {!embedded && (
            <button className="btn x" onClick={() => navigate(closeTo)} title="Close">
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
        <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4 }}>
          <Link className="linkish" to={`/parties/${encodeURIComponent(partyCode)}`} title="Open customer">
            {customer}
          </Link>
          {subtitleExtras.filter(Boolean).map((s, i) => (
            <span key={i}> · {s}</span>
          ))}
        </div>
      </div>

      {/* Items — edit item / quantity / pallet; add or remove lines. */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ minWidth: 240 }}>Item</th>
                <th className="num" style={{ textAlign: "right" }}>Ordered</th>
                <th className="num" style={{ textAlign: "right", width: 120 }}>Boxes</th>
                <th className="num" style={{ textAlign: "right" }}>Remaining</th>
                <th className="num" style={{ textAlign: "right" }}>Tonnes</th>
                {/* Rate stays in DraftLine state + quote save; only the column is hidden (CR). */}
                <th style={{ minWidth: 220 }}>Pallet Type</th>
                <th className="num" style={{ textAlign: "right" }}>Pallets</th>
                <th style={{ width: 64 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.key}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "100%" }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: l.packable ? l.color : "transparent", border: l.packable ? "none" : "1px dashed var(--dim)", flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <Combobox
                          value={l.item}
                          options={itemOptions}
                          onChange={(v) => setLine(l.key, { item: v, palletId: "" })}
                          placeholder="Search item…"
                          ariaLabel="Item"
                        />
                        {l.sku && <div className="mono dim" style={{ fontSize: "var(--t-xs)", marginTop: 2 }}>{l.sku}</div>}
                        {(batchesByItem.get(l.item)?.length ?? 0) > 0 && (
                          <div className="mono dim" style={{ fontSize: "var(--t-xs)", marginTop: 2 }} title="Batches in stock (boxes on hand)">
                            {batchesByItem.get(l.item)!.map((b) => `${b.batchNumber} ×${fmt(b.current)}`).join(" · ")}
                          </div>
                        )}
                        {!l.packable && l.reason && (
                          <div className="dim" style={{ fontSize: "var(--t-xs)", marginTop: 2, color: "var(--c-amber)" }}>
                            ⚠ {l.reason}
                            {l.designId && (
                              <>
                                {" · "}
                                <Link className="linkish" to={`/design/${l.designId}`}>open item</Link>
                              </>
                            )}
                          </div>
                        )}
                      </span>
                    </span>
                  </td>
                  <td className="num mono dim">{l.ordered == null ? "—" : fmt(l.ordered)}</td>
                  <td className="num">
                    <NumberInput
                      value={l.qty}
                      onChange={(e) => setQtyByIdx(l.idx, e.target.value)}
                      disabled={!canSave}
                      placeholder="0"
                      style={{ width: 100, textAlign: "right" }}
                      aria-label={`${l.item || "item"} boxes`}
                    />
                  </td>
                  <td className="num mono dim">{l.ordered == null ? "—" : fmt(remainingOf(l) ?? 0)}</td>
                  <td className="num mono" style={{ fontWeight: 600 }}>{l.boxWeightKg > 0 ? `${round1(l.tonnes).toFixed(1)} t` : "—"}</td>
                  <td>
                    <Combobox
                      value={l.palletId}
                      options={l.palletOptions}
                      onChange={(v) => setLine(l.key, { palletId: v })}
                      placeholder={l.palletOptions.length ? "Choose pallet…" : "—"}
                      ariaLabel={`${l.item || "item"} pallet`}
                    />
                  </td>
                  <td
                    className="num mono"
                    style={{ fontWeight: 600 }}
                    title={
                      !l.capacityBoxes
                        ? ""
                        : mode === "boxes"
                          ? `ceil(${fmt(l.qty)} boxes ÷ ${fmt(l.boxesPerPallet)} box/pallet) = ${fmt(l.pallets)} · a container holds ${fmt(l.palletsPerContainer)} pallets = ${fmt(l.capacityBoxes)} boxes`
                          : `ceil(${fmt(l.qty)} boxes ÷ ${fmt(l.boxesPerPallet)} box/pallet) = ${fmt(l.pallets)} · a ${fmt(tonCapacity)} t container holds ${fmt(l.capacityBoxes)} boxes`
                    }
                  >
                    {l.capacityBoxes ? fmt(l.pallets) : "—"}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn ord-rm" onClick={() => cloneLine(l.key)} title="Clone line — split this item across containers" disabled={!canSave} tabIndex={-1}>
                      <Icon name="copy" size={12} />
                    </button>{" "}
                    <button className="btn ord-rm" onClick={() => removeLine(l.key)} title="Remove line" disabled={!canSave} tabIndex={-1}>✕</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 18 }}>No items yet — add one below.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="dim" style={{ textTransform: "uppercase", fontSize: "var(--t-xs)", letterSpacing: "0.05em" }}>Total</td>
                <td />
                <td className="num mono">{fmt(totalBoxes)}</td>
                <td className="num mono dim">{fmt(totalRemaining)}</td>
                <td className="num mono" style={{ fontWeight: 600 }}>{round1(totalTonnes).toFixed(1)} t</td>
                <td />
                <td className="num mono" style={{ fontWeight: 600 }}>{fmt(totalPalletsCount)} pallets</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        {canSave && (
          <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
            <button className="hbtn" onClick={addLine}>
              <Icon name="plus" size={13} /> Add item
            </button>
          </div>
        )}
      </div>

      {/* Plan — ton capacity + container cards + inside/suggestions panels. */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600 }}>Plan containerisation</span>
          <span className="dim" style={{ fontSize: "var(--t-sm)", flex: 1 }}>
            {nContainers > 0
              ? `${totalFrac.toFixed(1)} containers filled · ${nContainers} needed · ${round1(totalTonnes).toFixed(1)} t`
              : "No packable quantities yet"}
          </span>
          <span style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }} role="group" aria-label="Fitting basis" title="Switch fitting basis">
            <button onClick={() => switchMode("boxes")} title="Capacity from the Pallet format: pallets/container × boxes/pallet"
              style={{ background: mode === "boxes" ? "var(--accent-soft)" : "transparent", color: mode === "boxes" ? "var(--fg)" : "var(--muted)", border: 0, padding: "5px 12px", cursor: "pointer", fontSize: "var(--t-sm)" }}>
              Box Fitting
            </button>
            <button onClick={() => switchMode("weight")} title="Capacity from the container's ton limit"
              style={{ background: mode === "weight" ? "var(--accent-soft)" : "transparent", color: mode === "weight" ? "var(--fg)" : "var(--muted)", border: 0, padding: "5px 12px", cursor: "pointer", fontSize: "var(--t-sm)" }}>
              Weight Fitting
            </button>
          </span>
          {mode === "weight" && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--t-sm)" }} title="Default container weight capacity — override any container below">
              <span className="dim">Default</span>
              <NumberInput
                value={tonCapacity}
                onChange={(e) => setTonCapacity(Math.max(1, Number(e.target.value) || DEFAULT_TON_CAPACITY))}
                disabled={!canSave}
                style={{ width: 70, textAlign: "right" }}
                aria-label="Default container ton capacity"
              />
              <span className="dim">t / container</span>
            </label>
          )}
        </div>

        {/* Container cards — fixed 4-per-row grid so rows stay aligned. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, padding: "18px 16px" }}>
          {containers.map((c, i) => {
            const cells = cellsOf(c);
            const empties = emptyCellsOf(c, cells.length);
            const pct = Math.round(c.fill * 100);
            const full = c.fill >= 1 - EPS;
            const overFull = c.fill > 1 + EPS;
            const active = i === sel;
            const boxesIn = c.segs.reduce((s, x) => s + x.boxes, 0);
            const mixed = c.segs.length > 1;
            const isDropTarget = dragFrom != null && dragFrom !== i;
            const isOver = isDropTarget && overIdx === i;
            return (
              <div
                key={i}
                onClick={() => setSelected(i)}
                draggable={canSave}
                onDragStart={(e) => {
                  // Don't hijack text-selection drags inside the ton-capacity input.
                  if ((e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); return; }
                  setDragFrom(i);
                }}
                onDragEnd={() => { setDragFrom(null); setOverIdx(null); }}
                onDragOver={(e) => { if (isDropTarget) { e.preventDefault(); setOverIdx(i); } }}
                onDragLeave={() => setOverIdx((o) => (o === i ? null : o))}
                onDrop={(e) => { e.preventDefault(); onDropCard(i); }}
                style={{ display: "flex", flexDirection: "column", gap: 6, cursor: canSave ? "grab" : "pointer", opacity: dragFrom === i ? 0.5 : 1 }}
              >
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "0 2px" }}>
                  <span className="mono dim" style={{ fontSize: "var(--t-xs)" }}>{docNo} · C{i + 1}</span>
                  <span className="mono" style={{ fontSize: "var(--t-sm)", fontWeight: 600, color: overFull ? "var(--c-red)" : full ? "var(--c-green)" : "var(--c-amber)" }} title={overFull ? "Manual override — beyond 100%" : undefined}>{pct}%{overFull ? " · Override" : ""}</span>
                </div>
                <div
                  style={{
                    border: isOver ? "1.5px dashed var(--accent)" : `1.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 6,
                    background: isOver ? "var(--accent-soft)" : "var(--panel-2, var(--bg))",
                    boxShadow: active ? "0 4px 14px oklch(0.71 0.17 55 / 0.22)" : "0 1px 2px rgba(0,0,0,0.06)",
                    overflow: "hidden",
                    transition: "background .12s",
                  }}
                >
                  {/* corrugated roof */}
                  <div style={{ height: 8, background: "repeating-linear-gradient(90deg, var(--faint) 0 3px, transparent 3px 7px)", borderBottom: "1px solid var(--border)" }} />
                  {/* Cells stretch to span the card in 2 rows, so a full container
                      always looks full regardless of its pallet count. */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateRows: "repeat(2, 18px)",
                      gridAutoFlow: "column",
                      gridTemplateColumns: `repeat(${Math.max(1, Math.ceil((cells.length + empties) / 2))}, minmax(0, 1fr))`,
                      gap: 2,
                      padding: 6,
                    }}
                  >
                    {cells.map((cell, k) => (
                      <div key={k} title={cell.item} style={{ height: 18, borderRadius: 2, background: cell.color }} />
                    ))}
                    {Array.from({ length: empties }, (_, k) => (
                      <div
                        key={`e${k}`}
                        style={{
                          height: 18,
                          borderRadius: 2,
                          border: "1px dashed var(--faint)",
                          background: "repeating-linear-gradient(135deg, var(--faint) 0 2px, transparent 2px 6px)",
                          boxSizing: "border-box",
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ height: 6, background: full ? "var(--c-green)" : "var(--faint)", opacity: full ? 0.45 : 0.6 }} />
                </div>
                <div className="mono dim" style={{ fontSize: "var(--t-xs)", padding: "0 2px", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                  {isDropTarget && dragLine ? (
                    // Live fit hint while dragging — how many of the dragged item this card takes.
                    <span style={{ color: "var(--c-amber)", fontWeight: 600 }}>
                      can take {fmt(fitBoxesIn(dragLine, i))} boxes of {dragLine.item}
                    </span>
                  ) : mode === "boxes" ? (
                    <span>
                      {fmt(cells.length)} / {fmt(lineOf(c.segs[0]?.idx)?.palletsPerContainer || cells.length)} pallets · {fmt(boxesIn)} boxes · {round1(tonnesIn(c)).toFixed(1)} t
                      {!full && (
                        <span style={{ color: "var(--c-amber)" }}> · {mixed ? `${100 - pct}% free` : `${fmt(Math.max(0, c.capBoxes - boxesIn))} free`}</span>
                      )}
                    </span>
                  ) : (
                    <>
                      <span>{round1(tonnesIn(c)).toFixed(1)} /</span>
                      <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
                        <NumberInput
                          value={c.capTons}
                          onChange={(e) => setCap(i, e.target.value)}
                          disabled={!canSave}
                          style={{ width: 46, textAlign: "right", padding: "1px 4px", height: 20 }}
                          aria-label={`Container ${i + 1} ton capacity`}
                        />
                      </span>
                      <span>
                        t · {fmt(boxesIn)} boxes
                        {capByIdx[i] != null && <span style={{ color: "var(--accent)" }}> · custom</span>}
                        {!full && (
                          <span style={{ color: "var(--c-amber)" }}> · {mixed ? `${100 - pct}% free` : `${fmt(Math.max(0, c.capBoxes - boxesIn))} free`}</span>
                        )}
                      </span>
                    </>
                  )}
                </div>
                <div style={{ height: 2, borderRadius: 2, background: active ? "var(--accent)" : "transparent" }} />
              </div>
            );
          })}
          {nContainers === 0 && (
            <div className="muted" style={{ padding: 8 }}>
              Add quantities (or fix the flagged items above) to see containers.
            </div>
          )}
        </div>

        {nContainers > 0 && selContainer && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1.1fr) minmax(320px, 1fr)", borderTop: "1px solid var(--border)" }}>
            {/* Inside the selected container */}
            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, borderRight: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span className="dim" style={{ fontSize: "var(--t-xs)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Inside C{sel + 1}
                </span>
                <span className="mono dim" style={{ fontSize: "var(--t-sm)" }}>
                  {mode === "boxes"
                    ? `${fmt(cellsOf(selContainer).length)} / ${fmt(lineOf(selContainer.segs[0]?.idx)?.palletsPerContainer || cellsOf(selContainer).length)} pallets`
                    : `${round1(tonnesIn(selContainer)).toFixed(1)} / ${fmt(selContainer.capTons)} t`}
                </span>
              </div>
              {selContainer.segs.map((s, i) => {
                const l = lineOf(s.idx);
                if (!l) return null;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: l.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: "var(--t-md)" }}>{l.item}</span>
                    <span className="mono dim" style={{ fontSize: "var(--t-sm)" }}>
                      {Math.ceil(s.boxes / l.boxesPerPallet)} pallet{Math.ceil(s.boxes / l.boxesPerPallet) === 1 ? "" : "s"}
                    </span>
                    <span className="mono" style={{ fontSize: "var(--t-sm)", fontWeight: 600, width: 96, textAlign: "right" }}>
                      {fmt(s.boxes)} boxes
                    </span>
                    {canSave && nContainers > 1 && (
                      <button className="btn" style={{ whiteSpace: "nowrap" }} onClick={() => openMove(sel, l.key)} title={`Move boxes of ${l.item} into another container`}>
                        ⇄ Move
                      </button>
                    )}
                  </div>
                );
              })}
              {selContainer.fill < 1 - EPS && (() => {
                const freeBoxes = Math.floor((1 - selContainer.fill) * selContainer.capBoxes + EPS);
                const freeTonnes = selContainer.capTons - tonnesIn(selContainer);
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, border: "1px dashed var(--dim)", flexShrink: 0 }} />
                    <span className="dim" style={{ flex: 1, fontSize: "var(--t-md)" }}>Free space</span>
                    <span className="mono dim" style={{ fontSize: "var(--t-sm)" }}>
                      {selContainer.segs.length > 1
                        ? `${Math.max(0, 100 - Math.round(selContainer.fill * 100))}% free`
                        : `${round1(Math.max(0, freeTonnes)).toFixed(1)} t · ${fmt(freeBoxes)} boxes free`}
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Adjust the load */}
            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span className="dim" style={{ fontSize: "var(--t-xs)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Adjust C{sel + 1}
                </span>
              </div>
              {trim && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid color-mix(in oklab, var(--c-red) 35%, transparent)", background: "color-mix(in oklab, var(--c-red) 5%, transparent)", borderRadius: 6 }}>
                  <span className="mono" style={{ fontSize: 17, fontWeight: 600, color: "var(--c-red)" }}>−</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                    <span style={{ fontSize: "var(--t-md)", fontWeight: 600 }}>{trim.headline}</span>
                    <span className="dim" style={{ fontSize: "var(--t-sm)" }}>{trim.detail}</span>
                  </div>
                  {canSave && (
                    <button className="hbtn" style={{ whiteSpace: "nowrap" }} onClick={trim.apply}>Apply</button>
                  )}
                </div>
              )}
              {add && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid color-mix(in oklab, var(--c-blue) 35%, transparent)", background: "color-mix(in oklab, var(--c-blue) 5%, transparent)", borderRadius: 6 }}>
                  <span className="mono" style={{ fontSize: 17, fontWeight: 600, color: "var(--c-blue)" }}>+</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                    <span style={{ fontSize: "var(--t-md)", fontWeight: 600 }}>{add.headline}</span>
                    <span className="dim" style={{ fontSize: "var(--t-sm)" }}>{add.detail}</span>
                  </div>
                  {canSave && (
                    <button className="hbtn" style={{ whiteSpace: "nowrap" }} onClick={add.apply}>Apply</button>
                  )}
                </div>
              )}
              {moveIns.map((mv, k) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid color-mix(in oklab, var(--c-violet) 35%, transparent)", background: "color-mix(in oklab, var(--c-violet) 5%, transparent)", borderRadius: 6 }}>
                  <span className="mono" style={{ fontSize: 17, fontWeight: 600, color: "var(--c-violet)" }}>⇄</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                    <span style={{ fontSize: "var(--t-md)", fontWeight: 600 }}>{mv.headline}</span>
                    <span className="dim" style={{ fontSize: "var(--t-sm)" }}>{mv.detail}</span>
                  </div>
                  {canSave && (
                    <button className="hbtn" style={{ whiteSpace: "nowrap" }} onClick={mv.apply}>Apply</button>
                  )}
                </div>
              ))}
              {balanced && (
                <div style={{ padding: "10px 12px", border: "1px solid var(--c-green)", borderRadius: 6, color: "var(--c-green)", fontWeight: 600, fontSize: "var(--t-md)" }}>
                  Load is balanced — every container ships full{containers.some((c) => c.fill > 1 + EPS) ? " (some overridden beyond 100%)" : ""}.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Move prompt — target + quantity + fit hint; opened by ⇄ Move or by dropping a card on another. */}
      {movePrompt && promptSeg && promptLine && (
        <div className="modal-backdrop">
          <div ref={promptRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="df-head">
              <div className="ico"><Icon name="truck" size={18} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>Move boxes</div>
                <div className="dim" style={{ fontSize: "var(--t-sm)" }}>{promptLine.item} · from C{movePrompt.from + 1}</div>
              </div>
              <button className="btn x" onClick={() => setMovePrompt(null)} title="Close" tabIndex={-1}>✕</button>
            </div>
            <div className="df-body">
              <label className="form-field">
                <span className="lbl">Into container</span>
                <Combobox
                  value={String(movePrompt.to)}
                  options={promptTargets}
                  onChange={(v) => {
                    const to = Number(v);
                    const fit = fitBoxesIn(promptLine, to);
                    setMovePrompt({ ...movePrompt, to, over: movePrompt.over || fit < 1 });
                    setMoveCount(fit < 1 ? promptSeg.boxes : Math.min(promptSeg.boxes, fit));
                  }}
                  ariaLabel="Target container"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Boxes to move</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="number"
                    min={1}
                    max={maxMove}
                    value={effMove}
                    onChange={(e) => setMoveCount(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                    style={{ width: 100, textAlign: "right" }}
                  />
                  <span className="dim" style={{ fontSize: "var(--t-sm)" }}>of {fmt(promptSeg.boxes)}</span>
                </span>
              </label>
              <div style={{ fontSize: "var(--t-sm)", marginTop: 4, fontWeight: 600, color: promptFit < promptSeg.boxes ? "var(--c-amber)" : "var(--c-green)" }}>
                C{movePrompt.to + 1} can take {fmt(promptFit)} boxes of {promptLine.item}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: "var(--t-sm)", cursor: "pointer" }}>
                <input type="checkbox" checked={!!movePrompt.over} onChange={(e) => setMovePrompt({ ...movePrompt, over: e.target.checked })} style={{ margin: 0 }} />
                Override — fill beyond 100%
              </label>
              {movePrompt.over && effMove > promptFit && (
                <div style={{ fontSize: "var(--t-sm)", marginTop: 4, color: "var(--c-red)", fontWeight: 600 }}>
                  C{movePrompt.to + 1} will exceed 100% — planning anyway
                </div>
              )}
            </div>
            <div className="df-foot">
              <div style={{ flex: 1 }} />
              <button className="btn" onClick={() => setMovePrompt(null)}>Cancel</button>
              <button className="hbtn primary" disabled={effMove < 1} onClick={confirmMove}>
                <Icon name="check" size={13} /> Move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Quote wrapper — /quotes/:id/containerise. Save persists the full
   line set + plan to the quote (update-quote-with-items, wholesale). ---- */
export function PlanContainerisation() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [pallets, setPallets] = useState<PalletRow[]>(() => cachedPallets() ?? []);
  const [loading, setLoading] = useState(() => cachedQuotes() == null);
  const [saving, setSaving] = useState(false);

  const quote = useMemo(() => quotes.find((q) => q.id === id) ?? null, [quotes, id]);

  const load = async () => {
    const [q, p] = await Promise.all([listQuotes(), listPallets()]);
    setLoading(false);
    if (q.ok) setQuotes(q.quotes);
    if (p.ok) setPallets(p.pallets);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !quote) {
    return <div className="muted mono" style={{ padding: 24 }}>Loading quote…</div>;
  }
  if (!quote) {
    return (
      <div>
        <div className="page-head">
          <div>
            <div className="title">Quote not found</div>
            <div className="sub">No quote matches this link.</div>
          </div>
          <div className="right">
            <button className="hbtn" onClick={() => navigate("/quotes")}>
              <Icon name="chev-l" size={13} /> Back to Quotes
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ContainerisePlanner
      docNo={quote.quoteNo}
      statusChip={{ cls: STATUS_CHIP[quote.status], label: STATUS_LABEL[quote.status] }}
      customer={quote.customer}
      partyCode={quote.partyCode}
      subtitleExtras={[quote.quoteDate || "", quote.portOfDischarge || ""]}
      closeTo={`/quotes/${quote.id}`}
      seedLines={(() => {
        // Reopen on the saved plan's row groups (boxes + pallet per group) so a
        // cloned split (300+200) survives re-seed; Ordered rides the first row.
        const groups = planRowGroups(parseContainerPlan(quote.containerPlan));
        return quote.lines.flatMap<Omit<DraftLine, "key">>((l) => {
          const base = { item: l.item, rate: l.rate, discount: l.discount, description: l.description || "" };
          const gs = groups.get(l.item);
          if (!gs?.length) return [{ ...base, qty: l.qty, palletId: "", ordered: l.qty }];
          return gs.map((g, k) => ({ ...base, qty: g.qty, palletId: g.palletId, group: g.group, over: g.over, ordered: k === 0 ? l.qty : undefined }));
        });
      })()}
      seedKey={`${quote.id}:${quote.modifiedTime}`}
      savedPlan={quote.containerPlan || ""}
      pallets={pallets}
      canSave={can("quotes", "edit")}
      saving={saving}
      saveTitle="Save the items and plan to the quote"
      linesDirty={(draft) => {
        // Compare what save would persist (rows merged by item) — a reseeded
        // multi-row split merges back to quote.lines exactly, so it's clean.
        const merged = mergeByItem(draft.filter((l) => l.item && l.qty > 0));
        return (
          merged.length !== quote.lines.length ||
          merged.some((l, i) => {
            const o = quote.lines[i];
            return !o || o.item !== l.item || o.qty !== l.qty || o.rate !== l.rate || (o.discount || 0) !== (l.discount || 0);
          })
        );
      }}
      onSave={async (planJson, valid) => {
        setSaving(true);
        const input = quoteToInput(quote);
        // Merge by item: a design split across pallets/containers (400+100) stays
        // ONE quote line (500) — the split lives only in the container plan JSON.
        input.lines = mergeByItem(valid);
        input.container_plan = planJson; // publish the plan for SO detail + dispatch board
        const res = await updateQuoteWithItems(quote.id, input);
        setSaving(false);
        if (!res.ok) {
          toast.error(res.error || "Save failed");
          return;
        }
        toast.success(`Quote ${quote.quoteNo} updated`);
        invalidateQuotes();
        await load();
      }}
    />
  );
}

/* ---- SO wrapper — /orders/:id/containerise (id = SalesOrder ROWID). Lines
   seed from the SO's OrderItems (edits are session-local packing inputs; the
   Ordered/Remaining columns keep them honest) and Save persists ONLY the
   plan JSON onto the SalesOrder — lines and status are never rewritten. ---- */
export function PlanSoContainerisation({ soId, embedded }: { soId?: string; embedded?: boolean } = {}) {
  const { id: routeId = "" } = useParams();
  const id = soId || routeId;
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>(() => cachedOrders() ?? []);
  const [pallets, setPallets] = useState<PalletRow[]>(() => cachedPallets() ?? []);
  const [loading, setLoading] = useState(() => cachedOrders() == null);
  const [saving, setSaving] = useState(false);

  const items = useMemo(() => orders.filter((o) => o.salesOrderId === id), [orders, id]);
  const head = items[0] ?? null;

  const load = async () => {
    const [o, p] = await Promise.all([listOrders(), listPallets()]);
    setLoading(false);
    if (o.ok) setOrders(o.orders);
    if (p.ok) setPallets(p.pallets);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !head) {
    return <div className="muted mono" style={{ padding: 24 }}>Loading order…</div>;
  }
  if (!head) {
    return (
      <div>
        <div className="page-head">
          <div>
            <div className="title">Sales order not found</div>
            <div className="sub">No sales order matches this link.</div>
          </div>
          <div className="right">
            <button className="hbtn" onClick={() => navigate("/orders")}>
              <Icon name="chev-l" size={13} /> Back to Sales Orders
            </button>
          </div>
        </div>
      </div>
    );
  }

  const soStatus = head.status || "Confirmed";
  return (
    <ContainerisePlanner
      docNo={head.orderNumber || head.poNumber}
      statusChip={{ cls: SO_STATUS_CHIP[soStatus] || "q-draft", label: soStatusLabel(soStatus) }}
      customer={head.party}
      partyCode={head.partyCode}
      subtitleExtras={[head.orderDate || "", head.portOfDischarge || ""]}
      closeTo={`/orders/${id}`}
      embedded={embedded}
      seedLines={(() => {
        // Reopen on the saved plan's row groups (boxes + pallet per group), not
        // the raw OrderItems — otherwise every mount/save re-seed reverts the
        // user's plan edits and collapses a cloned split back into one row.
        // ponytail: a merged container reseeds with its lines in OrderItem order, so the planJson may differ in line order from the saved one and show "Save" once
        const plan = parseContainerPlan(head.containerPlan);
        const groups = planRowGroups(plan);
        const emitted = new Set<string>();
        const out = items.flatMap<Omit<DraftLine, "key">>((o) => {
          const item = o.design || o.designName; // o.design hydrates as unique_name || design_name — must match itemOptions keys
          const base = { item, rate: o.rate || 0, discount: o.discount || 0, description: o.description || "" };
          const gs = groups.get(item);
          if (!gs?.length) return [{ ...base, qty: plan ? 0 : o.orderQty, palletId: o.palletId || "", ordered: o.orderQty }];
          if (emitted.has(item)) return [];
          emitted.add(item);
          return gs.map((g, k) => ({ ...base, qty: g.qty, palletId: g.palletId || o.palletId || "", group: g.group, over: g.over, ordered: k === 0 ? o.orderQty : undefined }));
        });
        // Planner-added designs that live only in the plan (no OrderItem) used
        // to drop silently on reopen — seed them as reference-less rows.
        for (const [design, gs] of groups) {
          if (emitted.has(design)) continue;
          for (const g of gs) out.push({ item: design, qty: g.qty, rate: 0, discount: 0, description: "", palletId: g.palletId, group: g.group, over: g.over, ordered: undefined });
        }
        return out;
      })()}
      seedKey={`${id}:${head.modifiedTime}`}
      savedPlan={head.containerPlan || ""}
      pallets={pallets}
      canSave={can("orders", "edit")}
      saving={saving}
      saveTitle="Save the container plan to the sales order"
      onSave={async (planJson) => {
        setSaving(true);
        const res = await update("SalesOrder", id, { container_plan: planJson });
        setSaving(false);
        if (!res.ok) {
          toast.error(res.error || "Save failed");
          return;
        }
        toast.success(`Order ${head.orderNumber || head.poNumber} plan saved`);
        invalidateOrders();
        await load();
      }}
    />
  );
}
