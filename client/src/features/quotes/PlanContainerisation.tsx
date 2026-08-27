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
     boxWeightKg) from the format's per-box weight (snapshotted from
     the Size master).
   Packing is strictly item-wise, in line order (line 1
   first): every container starts with a single item, so raising an
   item's quantity refills its own partial container before opening a
   new one — it never spills into another item's container on its own.
   On top of that auto-pack the user can MOVE boxes between containers
   (drag a card onto another, or the Adjust panel's Move suggestions),
   which may mix items in one container; fill is then fractional —
   each item's boxes against its own capacity, as on the dispatch
   board. Moves are session-only: reopening the page re-packs.

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
import { listPallets, cachedPallets, type PalletRow } from "@/features/masters/palletsApi";
import type { DesignRow } from "@/features/masters/designsApi";
import { cachedOrders, invalidateOrders, listOrders, soStatusLabel, SO_STATUS_CHIP } from "@/features/orders/ordersApi";
import { STATUS_CHIP, STATUS_LABEL, quoteToInput } from "./QuotesTable";
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

// Leading dimension of a size string ("300x600 - GVT…" → "300") — same
// matcher as PalPlanForm's per-line pallet-size filtering.
const widthOf = (s: string) => String(s || "").match(/^\s*(\d+)/)?.[1] ?? "";

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
/** A manual "move N boxes of a line from container A to B", layered on the auto-pack. */
interface BoxMove {
  key: string; // DraftLine key
  from: number; // container positions in the compacted list the user saw
  to: number;
  boxes: number;
}
interface PackedContainer {
  segs: Seg[]; // one seg per item; >1 after manual moves (mixed container)
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
  docNo, statusChip, customer, partyCode, subtitleExtras, closeTo,
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
  // Manual box moves (session-only) + drag/prompt state for the move flow.
  const [moves, setMoves] = useState<BoxMove[]>([]);
  const [dragFrom, setDragFrom] = useState<number | null>(null); // dragged container position
  const [overIdx, setOverIdx] = useState<number | null>(null); // drop-target highlight
  const [movePrompt, setMovePrompt] = useState<{ from: number; to: number } | null>(null);
  const [moveCount, setMoveCount] = useState(0);
  const promptRef = useModalA11y(() => setMovePrompt(null));

  const keySeq = useRef(0);
  const nextKey = () => `L${keySeq.current++}`;

  // Re-seed editable lines + ton capacity whenever the underlying document changes.
  useEffect(() => {
    setDraftLines(seedLines.map((l) => ({ ...l, key: nextKey() })));
    const saved = parseContainerPlan(savedPlan);
    // Saved plans reopen in their own mode; pre-mode plans were weight-packed.
    setMode(saved ? (saved.mode ?? "weight") : "boxes");
    setMoves([]);
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
      const base = { key: dl.key, idx, item: dl.item, qty: Math.max(0, dl.qty), rate: dl.rate, ordered: dl.ordered, color };
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

      // Pallet specs offered = exact size match, else same size WIDTH (PalPlanForm rule).
      const w = widthOf(d.sizeLabel);
      const exact = pallets.filter((p) => p.sizeId && p.sizeId === d.sizeId);
      const wide = pallets.filter((p) => !exact.includes(p) && (!p.sizeId || !w || widthOf(p.sizeLabel) === w));
      const opts = [...exact, ...wide].filter((p) => p.boxesPerPallet > 0);
      const palletOptions = opts.map((p) => ({ value: p.id, label: p.name }));
      if (opts.length === 0) return fail("no Pallet format for this size", { designId: d.id, boxWeightKg: d.boxWeightKg, tonnes: base.qty * (d.boxWeightKg || 0) / 1000 });

      const chosen = opts.find((p) => p.id === dl.palletId) || opts[0];
      const boxWeightKg = chosen.boxWeightKg || d.boxWeightKg;
      const tonnes = base.qty * boxWeightKg / 1000;
      const capacityBoxes =
        mode === "boxes"
          ? chosen.totalBoxesPerContainer
          : boxWeightKg > 0 ? Math.floor(tonKg / boxWeightKg) : 0;
      if (capacityBoxes < 1) {
        const reason =
          mode === "boxes"
            ? `no pallets/container on Pallet format “${chosen.name}”`
            : boxWeightKg > 0 ? "box heavier than container capacity" : "no box weight — set it on the Size/Item master";
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
     item's box weight. Manual moves are then applied on top — moving boxes
     into another container mixes items there, and fill becomes fractional
     (each line's boxes / that line's own capacity). Stale moves (positions or
     lines that no longer exist, or targets without room) are clamped/skipped
     so line edits degrade gracefully instead of hard-resetting. ---- */
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

    // Baseline: strictly item-wise, line order.
    let list: { segs: Seg[] }[] = [];
    for (const l of lines) {
      let left = l.qty;
      while (left > 0) {
        const capBoxes = lineCapIn(l, list.length);
        if (capBoxes < 1) break;
        const take = Math.min(left, capBoxes);
        list.push({ segs: [{ idx: l.idx, boxes: take }] });
        left -= take;
      }
    }

    // Layer manual moves on top. Positions refer to the compacted list the
    // user saw when the move was made, so compact after every application.
    for (const m of moves) {
      const l = lines.find((x) => x.key === m.key);
      const src = list[m.from];
      const dst = list[m.to];
      if (!l || !src || !dst || m.from === m.to) continue;
      const seg = src.segs.find((s) => s.idx === l.idx);
      if (!seg) continue;
      const room = Math.floor((1 - fillOf(dst, m.to)) * lineCapIn(l, m.to) + EPS);
      const take = Math.min(m.boxes, seg.boxes, Math.max(0, room));
      if (take < 1) continue;
      seg.boxes -= take;
      src.segs = src.segs.filter((s) => s.boxes > 0);
      const dseg = dst.segs.find((s) => s.idx === l.idx);
      if (dseg) dseg.boxes += take;
      else dst.segs.push({ idx: l.idx, boxes: take });
      list = list.filter((c) => c.segs.length > 0);
    }

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
  }, [lines, mode, tonCapacity, capByIdx, moves]);

  // Remaining to plan per line — ordered boxes not yet moved into the Boxes
  // (plan) column: max(0, ordered − qty). New lines (no ordered) contribute 0.
  const totalRemaining = rows.reduce((s, l) => s + (l.ordered == null ? 0 : Math.max(0, l.ordered - l.qty)), 0);

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
  // Dragging a card moves its last seg's item (the movable one on mixed cards).
  const movableSegOf = (i: number) => containers[i]?.segs[containers[i].segs.length - 1];
  const dragLine = dragFrom != null ? lineOf(movableSegOf(dragFrom)?.idx) : undefined;
  const onDropCard = (to: number) => {
    const from = dragFrom;
    setDragFrom(null);
    setOverIdx(null);
    if (from == null || from === to) return;
    const seg = movableSegOf(from);
    const l = seg ? lineOf(seg.idx) : undefined;
    if (!seg || !l) return;
    const fit = fitBoxesIn(l, to);
    if (fit < 1) {
      toast.error(`C${to + 1} has no room for ${l.item}`);
      return;
    }
    setMoveCount(Math.min(seg.boxes, fit));
    setMovePrompt({ from, to });
  };
  const promptSeg = movePrompt ? movableSegOf(movePrompt.from) : undefined;
  const promptLine = promptSeg ? lineOf(promptSeg.idx) : undefined;
  const promptFit = movePrompt && promptLine ? fitBoxesIn(promptLine, movePrompt.to) : 0;
  const maxMove = promptSeg ? Math.min(promptSeg.boxes, promptFit) : 0;
  const effMove = Math.max(0, Math.min(moveCount, maxMove));
  const confirmMove = () => {
    if (!movePrompt || !promptLine || effMove < 1) return;
    setMoves((ms) => [...ms, { key: promptLine.key, from: movePrompt.from, to: movePrompt.to, boxes: effMove }]);
    setSelected(movePrompt.to);
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
          fillPct: Math.min(100, Math.round(c.fill * 100)),
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
  const cellsOf = (c: PackedContainer) => {
    const cells: { color: string; item: string }[] = [];
    for (const s of c.segs) {
      const l = lineOf(s.idx);
      if (!l) continue;
      const n = Math.max(1, Math.ceil(s.boxes / l.boxesPerPallet));
      for (let k = 0; k < n; k++) cells.push({ color: l.color, item: l.item });
    }
    return cells;
  };
  /** Empty (hatched) cells = the container's box-capacity, in pallet units, minus used. */
  const emptyCellsOf = (c: PackedContainer, used: number) => {
    if (c.fill >= 1 - EPS) return 0;
    const l = lineOf(c.segs[0]?.idx);
    if (!l) return 0;
    const capCells = Math.max(used, mode === "boxes" ? l.palletsPerContainer : Math.ceil(c.capBoxes / l.boxesPerPallet));
    return Math.max(0, capCells - used);
  };

  /* ---- line editing ---- */
  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setDraftLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setDraftLines((ls) => ls.filter((l) => l.key !== key));
  const addLine = () =>
    setDraftLines((ls) => [...ls, { key: nextKey(), item: "", qty: 1, rate: 0, discount: 0, description: "", palletId: "" }]);
  const setQtyByIdx = (idx: number, raw: string) => {
    const r = rows[idx];
    if (r) setLine(r.key, { qty: Math.max(0, Number(raw) || 0) });
  };
  // Mode switch re-packs under different capacities — manual moves don't carry over.
  const switchMode = (m: "boxes" | "weight") => {
    setMode(m);
    setMoves([]);
  };
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
        apply: () => setMoves((ms) => [...ms, { key: cand.l.key, from: cand.from, to: sel, boxes: cand.n }]),
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
          <button className="btn x" onClick={() => navigate(closeTo)} title="Close">
            <Icon name="x" size={13} />
          </button>
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

      {/* Items — edit item / quantity / rate / pallet; add or remove lines. */}
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
                <th className="num" style={{ textAlign: "right", width: 110 }}>Rate</th>
                <th style={{ minWidth: 220 }}>Pallet Type</th>
                <th className="num" style={{ textAlign: "right" }}>Ready Pallets</th>
                <th style={{ width: 34 }} />
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
                  <td className="num mono dim">{l.ordered == null ? "—" : fmt(Math.max(0, l.ordered - l.qty))}</td>
                  <td className="num mono" style={{ fontWeight: 600 }}>{l.boxWeightKg > 0 ? `${round1(l.tonnes).toFixed(1)} t` : "—"}</td>
                  <td className="num">
                    <NumberInput
                      value={l.rate}
                      onChange={(e) => setLine(l.key, { rate: Math.max(0, Number(e.target.value) || 0) })}
                      disabled={!canSave}
                      placeholder="0"
                      style={{ width: 100, textAlign: "right" }}
                      aria-label={`${l.item || "item"} rate`}
                    />
                  </td>
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
                  <td>
                    <button className="btn ord-rm" onClick={() => removeLine(l.key)} title="Remove line" disabled={!canSave} tabIndex={-1}>✕</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted" style={{ textAlign: "center", padding: 18 }}>No items yet — add one below.</td>
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
                <td /><td />
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
            const pct = Math.min(100, Math.round(c.fill * 100));
            const full = c.fill >= 1 - EPS;
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
                  <span className="mono" style={{ fontSize: "var(--t-sm)", fontWeight: 600, color: full ? "var(--c-green)" : "var(--c-amber)" }}>{pct}%</span>
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
                  Load is balanced — every container ships full.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Move prompt — quantity + fit hint, opened by dropping a card on another. */}
      {movePrompt && promptSeg && promptLine && (
        <div className="modal-backdrop">
          <div ref={promptRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="df-head">
              <div className="ico"><Icon name="truck" size={18} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>Move into C{movePrompt.to + 1}</div>
                <div className="dim" style={{ fontSize: "var(--t-sm)" }}>{promptLine.item} · from C{movePrompt.from + 1}</div>
              </div>
              <button className="btn x" onClick={() => setMovePrompt(null)} title="Close" tabIndex={-1}>✕</button>
            </div>
            <div className="df-body">
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
      seedLines={quote.lines.map((l) => ({
        item: l.item,
        qty: l.qty,
        rate: l.rate,
        discount: l.discount,
        description: l.description || "",
        palletId: "",
        ordered: l.qty,
      }))}
      seedKey={`${quote.id}:${quote.modifiedTime}`}
      savedPlan={quote.containerPlan || ""}
      pallets={pallets}
      canSave={can("quotes", "edit")}
      saving={saving}
      saveTitle="Save the items and plan to the quote"
      linesDirty={(draft) =>
        draft.length !== quote.lines.length ||
        draft.some((l, i) => {
          const o = quote.lines[i];
          return !o || o.item !== l.item || o.qty !== l.qty || o.rate !== l.rate || (o.discount || 0) !== (l.discount || 0);
        })
      }
      onSave={async (planJson, valid) => {
        setSaving(true);
        const input = quoteToInput(quote);
        input.lines = valid.map((l) => ({ item: l.item, qty: l.qty, rate: l.rate, discount: l.discount || 0, description: l.description || "" }));
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
export function PlanSoContainerisation() {
  const { id = "" } = useParams();
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
      seedLines={items.map((o) => ({
        item: o.designName,
        qty: o.orderQty,
        rate: o.rate || 0,
        discount: o.discount || 0,
        description: o.description || "",
        palletId: o.palletId || "",
        ordered: o.orderQty,
      }))}
      seedKey={`${id}:${head.modifiedTime}`}
      savedPlan={head.containerPlan || ""}
      pallets={pallets}
      canSave={can("orders", "edit")}
      saving={saving}
      saveTitle="Save the container plan to the sales order"
      onSave={async (planJson) => {
        setSaving(true);
        const res = await update("SalesOrder", id, { container_plan: planJson.slice(0, 10000) });
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
