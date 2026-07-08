/* ============================================================
   Design (Item) master — typed Data Store wrapper over lib/dataOps.

   The Design table (Catalyst) holds the item catalogue. size / finish /
   category / glaze / brand / grade are real ForeignKeys (each stores the
   parent lookup's ROWID). Every write is recorded server-side in
   OperationLog. Lookup key columns are NOT uniform: Size keys on `code`,
   the rest (Finish/Category/Glaze/Brand/Grade) key on `name`.
   ============================================================ */
import { list, listAll, insert, update, remove, type DSRow, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

/** A lookup choice for a FK picker: ROWID + human label. */
export interface LookupOption {
  id: string; // parent ROWID (the value stored in the FK column)
  label: string;
  seqCode?: string; // stored SKU segment short code (Size/Finish/Category/Glaze)
  widthMm?: number; // Size only: tile dimensions, used to auto-fill the form
  lengthMm?: number;
}

/* Whether to persist per-design width_mm/length_mm columns on the Design
   table. Flip to true once those decimal columns exist in Catalyst; while
   false the form still computes coverage from width/length (auto-filled
   from the Size lookup) and persists only coverage_sqm/coverage_sqft. */
export const PERSIST_DESIGN_DIMS = true;

/** All six FK lookup option lists, ready for the form selects. */
export interface DesignLookups {
  sizes: LookupOption[];
  finishes: LookupOption[];
  categories: LookupOption[];
  glazes: LookupOption[];
  brands: LookupOption[];
  grades: LookupOption[];
  // Party brands: PartyBrand master names ∪ legacy free-text values on designs.
  partyBrands: string[];
  // PartyBrand name → seq_code (SKU segment, appended only when a brand is set).
  partyBrandSeq: Record<string, string>;
}

/** One design image: File Store id + the original uploaded filename. */
export interface DesignImage {
  id: string;
  name: string;
}

export interface DesignRow {
  id: string; // ROWID
  designName: string;
  baseDesignName: string;
  uniqueName: string;
  sku: string;
  seqCode: string; // design short code — first SKU segment
  partyBrandName: string;
  collectionName: string;
  status: string;
  // FK ids ("" when unset) + resolved labels for display
  sizeId: string;
  sizeLabel: string;
  finishId: string;
  finishLabel: string;
  categoryId: string;
  categoryLabel: string;
  glazeId: string;
  glazeLabel: string;
  brandId: string;
  brandLabel: string;
  gradeId: string;
  gradeLabel: string;
  // specs / rates
  widthMm: number;
  lengthMm: number;
  pcsPerBox: number;
  boxWeightKg: number;
  coverageSqm: number;
  coverageSqft: number;
  randomFaces: number;
  ratePerSqft: number;
  ratePerSqmt: number;
  accountingStock: number;
  booksItemId: string;
  imageUrl: string;
  images: DesignImage[]; // #12: File Store images (id + original filename)
  createdTime: string; // Catalyst CREATEDTIME
  modifiedTime: string; // Catalyst MODIFIEDTIME
}

/* Per-lookup natural-key column (see schema gotchas). */
const LOOKUP_KEY: Record<string, string> = {
  Size: "code",
  Finish: "name",
  Category: "name",
  Glaze: "name",
  Brand: "name",
  Grade: "name",
};

function optionsOf(rows: DSRow[] | undefined, table: string): LookupOption[] {
  const key = LOOKUP_KEY[table];
  const withDims = table === "Size";
  return (rows || [])
    .map((r) => {
      const o: LookupOption = { id: String(r.ROWID), label: str(r[key]) || str(r.name) || String(r.ROWID) };
      o.seqCode = str(r.seq_code);
      if (withDims) {
        o.widthMm = num(r.width_mm);
        o.lengthMm = num(r.length_mm);
      }
      return o;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/* Stale-while-revalidate cache (lib/cache); mutations below invalidate. */
const cache = createListCache(fetchDesigns);

/** Last fetched designs, or null if never fetched this session. */
export function cachedDesigns(): DesignRow[] | null {
  return cache.cached()?.designs ?? null;
}
/** Subscribe to design-cache changes. Returns an unsubscribe fn. */
export function subscribeDesigns(cb: () => void): () => void {
  return cache.subscribe(cb);
}
/** Drop the cache so the next listDesigns() hits the network. */
export function invalidateDesigns(): void {
  cache.invalidate();
}

/** Patch one design in the cached snapshot in place — used by the item
    detail so status/image edits update only the selected item, no refetch. */
export function patchDesignCache(id: string, patch: Partial<DesignRow>): void {
  cache.patch((v) =>
    v.ok ? { ...v, designs: v.designs.map((d) => (d.id === id ? { ...d, ...patch } : d)) } : v,
  );
}

/** All designs (FK labels hydrated) + six lookup lists. Cached + deduped. */
export function listDesigns(): Promise<{
  ok: boolean;
  designs: DesignRow[];
  lookups: DesignLookups;
  error?: string;
}> {
  return cache.load();
}

async function fetchDesigns(): Promise<{
  ok: boolean;
  designs: DesignRow[];
  lookups: DesignLookups;
  error?: string;
}> {
  // listAll pages past ZCQL's 300-row cap; lookups project label columns only.
  const [designs, size, finish, category, glaze, brand, grade, partyBrand] = await Promise.all([
    listAll("Design", { order: "ROWID desc" }),
    list("Size", { limit: 300, columns: ["code", "width_mm", "length_mm", "seq_code"] }),
    list("Finish", { limit: 300, columns: ["name", "seq_code"] }),
    list("Category", { limit: 300, columns: ["name", "seq_code"] }),
    list("Glaze", { limit: 300, columns: ["name", "seq_code"] }),
    list("Brand", { limit: 300, columns: ["name", "seq_code"] }),
    list("Grade", { limit: 300, columns: ["name", "seq_code"] }),
    list("PartyBrand", { limit: 300, columns: ["name", "seq_code"] }),
  ]);

  const lookups: DesignLookups = {
    sizes: optionsOf(size.rows, "Size"),
    finishes: optionsOf(finish.rows, "Finish"),
    categories: optionsOf(category.rows, "Category"),
    glazes: optionsOf(glaze.rows, "Glaze"),
    brands: optionsOf(brand.rows, "Brand"),
    grades: optionsOf(grade.rows, "Grade"),
    partyBrands: [],
    partyBrandSeq: {},
  };

  if (!designs.ok) return { ok: false, designs: [], lookups, error: designs.error };

  const labelMap = (opts: LookupOption[]) => new Map(opts.map((o) => [o.id, o.label]));
  const sz = labelMap(lookups.sizes);
  const fn = labelMap(lookups.finishes);
  const ct = labelMap(lookups.categories);
  const gl = labelMap(lookups.glazes);
  const br = labelMap(lookups.brands);
  const gr = labelMap(lookups.grades);

  // PartyBrand name → seq_code (needed by the SKU fallback below and the form).
  for (const r of partyBrand.rows || []) {
    if (r.name) lookups.partyBrandSeq[str(r.name)] = str(r.seq_code);
  }

  /* Rows saved before the SKU formula (2026-07-04) have a blank `sku`
     column; derive it from the same seq_code segments so the grid /
     detail / search always show a SKU. Same order as DesignForm.computeSku:
     Short-Size-Finish-Category-Glaze-Brand-Grade[-PartyBrand], "00" unset. */
  const seqMap = (opts: LookupOption[]) => new Map(opts.map((o) => [o.id, o.seqCode || ""]));
  const seqs = [seqMap(lookups.sizes), seqMap(lookups.finishes), seqMap(lookups.categories), seqMap(lookups.glazes), seqMap(lookups.brands), seqMap(lookups.grades)];
  const fallbackSku = (d: DSRow, fkIds: string[]): string => {
    const code = (s?: string) => (s || "").trim() || "00";
    const parts = [code(str(d.seq_code)), ...fkIds.map((id, i) => code(seqs[i].get(id)))];
    const pb = str(d.party_brand_name).trim();
    if (pb) parts.push(code(lookups.partyBrandSeq[pb]));
    return parts.join("-");
  };

  const rows: DesignRow[] = (designs.rows || []).map((d) => {
    const sizeId = str(d.size);
    const finishId = str(d.finish);
    const categoryId = str(d.category);
    const glazeId = str(d.glaze);
    const brandId = str(d.brand);
    const gradeId = str(d.grade);
    return {
      id: String(d.ROWID),
      designName: str(d.design_name),
      baseDesignName: str(d.base_design_name),
      uniqueName: str(d.unique_name),
      sku: str(d.sku) || fallbackSku(d, [sizeId, finishId, categoryId, glazeId, brandId, gradeId]),
      seqCode: str(d.seq_code),
      partyBrandName: str(d.party_brand_name),
      collectionName: str(d.collection_name),
      status: str(d.status),
      sizeId,
      sizeLabel: sz.get(sizeId) || "",
      finishId,
      finishLabel: fn.get(finishId) || "",
      categoryId,
      categoryLabel: ct.get(categoryId) || "",
      glazeId,
      glazeLabel: gl.get(glazeId) || "",
      brandId,
      brandLabel: br.get(brandId) || "",
      gradeId,
      gradeLabel: gr.get(gradeId) || "",
      widthMm: num(d.width_mm),
      lengthMm: num(d.length_mm),
      pcsPerBox: num(d.pcs_per_box),
      boxWeightKg: num(d.box_weight_kg),
      coverageSqm: num(d.coverage_sqm),
      coverageSqft: num(d.coverage_sqft),
      randomFaces: num(d.random_faces),
      ratePerSqft: num(d.rate_per_sqft),
      ratePerSqmt: num(d.rate_per_sqmt),
      accountingStock: num(d.accounting_stock),
      booksItemId: str(d.books_item_id),
      imageUrl: str(d.image_url),
      images: parseImages(str(d.image_urls)),
      createdTime: str(d.CREATEDTIME),
      modifiedTime: str(d.MODIFIEDTIME),
    };
  });

  // Party Brand master names ∪ legacy free-text values still on designs.
  const masterBrands = (partyBrand.rows || []).map((r) => str(r.name)).filter(Boolean);
  lookups.partyBrands = [...new Set([...masterBrands, ...rows.map((r) => r.partyBrandName).filter(Boolean)])].sort(
    (a, b) => a.localeCompare(b),
  );

  return { ok: true, designs: rows, lookups };
}

export interface DesignInput {
  design_name: string;
  base_design_name: string;
  party_brand_name: string;
  collection_name: string;
  unique_name: string;
  sku: string;
  seq_code: string; // design short code — first SKU segment
  status: string;
  // FK ROWIDs ("" = leave unset / clear)
  size: string;
  finish: string;
  category: string;
  glaze: string;
  brand: string;
  grade: string;
  // specs / rates
  width_mm: number;
  length_mm: number;
  pcs_per_box: number;
  box_weight_kg: number;
  coverage_sqm: number;
  coverage_sqft: number;
  random_faces: number;
  rate_per_sqft: number;
  rate_per_sqmt: number;
  accounting_stock: number;
  image_url: string;
  image_urls: string; // #12: JSON array of File Store image ids
}

/** Parse the image_urls JSON column → DesignImage[]. Tolerant of the legacy
    format where entries were bare File Store id strings (name unknown → ""). */
function parseImages(raw: string): DesignImage[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .map((e) =>
        typeof e === "string"
          ? { id: e, name: "" }
          : { id: String((e as { id?: unknown }).id ?? ""), name: String((e as { name?: unknown }).name ?? "") },
      )
      .filter((x) => x.id);
  } catch {
    return [];
  }
}

const FK_KEYS = ["size", "finish", "category", "glaze", "brand", "grade"] as const;

/** Drop empty FKs so Catalyst doesn't reject a blank ForeignKey. */
function toPayload(input: DesignInput): Record<string, unknown> {
  const p: Record<string, unknown> = {
    design_name: input.design_name.trim(),
    base_design_name: input.base_design_name.trim(),
    party_brand_name: input.party_brand_name.trim(),
    collection_name: input.collection_name.trim(),
    unique_name: input.unique_name.trim(),
    sku: input.sku.trim(),
    seq_code: input.seq_code.trim(),
    status: input.status.trim(),
    pcs_per_box: input.pcs_per_box,
    box_weight_kg: input.box_weight_kg,
    ...(PERSIST_DESIGN_DIMS ? { width_mm: input.width_mm, length_mm: input.length_mm } : {}),
    coverage_sqm: input.coverage_sqm,
    coverage_sqft: input.coverage_sqft,
    random_faces: input.random_faces,
    rate_per_sqft: input.rate_per_sqft,
    rate_per_sqmt: input.rate_per_sqmt,
    accounting_stock: input.accounting_stock,
    image_url: input.image_url.trim(),
    image_urls: input.image_urls || "[]",
  };
  for (const k of FK_KEYS) if (input[k]) p[k] = input[k]; // FK only when chosen
  return p;
}

/* Mutations invalidate the cache so the next listDesigns() refetches. */
function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    return r;
  });
}

export function createDesign(input: DesignInput) {
  return bust(insert("Design", toPayload(input)));
}

export function updateDesign(rowid: string, input: DesignInput) {
  // On edit, send every FK so a cleared picker unsets the column (null).
  const patch = toPayload(input);
  for (const k of FK_KEYS) if (!input[k]) patch[k] = null;
  return bust(update("Design", rowid, patch));
}

export function deleteDesign(rowid: string) {
  return bust(remove("Design", rowid));
}

/* ---- Associate Pallets (DesignPallet many-to-many join) ---- */

/** Live pallet ROWIDs linked to a design via the DesignPallet join table. */
export async function getDesignPallets(designId: string): Promise<string[]> {
  if (!designId) return [];
  const res = await list("DesignPallet", { where: `design = ${designId}`, columns: ["pallet"] });
  if (!res.ok) return [];
  return (res.rows || []).map((r) => str(r.pallet)).filter(Boolean);
}

/** Reconcile a design's pallet links to exactly `palletIds` — insert the
    added pairs, soft-delete the dropped ones. Returns the first failure. */
export async function setDesignPallets(designId: string, palletIds: string[]): Promise<OpResult> {
  const res = await list("DesignPallet", { where: `design = ${designId}` });
  if (!res.ok) return res;
  const existing = res.rows || [];
  const want = new Set(palletIds);
  const have = new Set(existing.map((r) => str(r.pallet)));
  const ops: Promise<OpResult>[] = [];
  for (const r of existing) if (!want.has(str(r.pallet))) ops.push(remove("DesignPallet", String(r.ROWID)));
  for (const pid of want) if (!have.has(pid)) ops.push(insert("DesignPallet", { design: designId, pallet: pid }));
  const results = await Promise.all(ops);
  return results.find((r) => !r.ok) || { ok: true };
}

/* ---- Bulk ops (client-side fan-out; each row logged in OperationLog) ---- */

export interface BulkResult {
  ok: boolean;
  done: number;
  failed: number;
  firstError?: string;
}

async function fanOut(rowids: string[], fn: (id: string) => Promise<OpResult>): Promise<BulkResult> {
  const results = await Promise.all(rowids.map(fn));
  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    done: results.length - failed.length,
    failed: failed.length,
    firstError: failed[0]?.error,
  };
}

/** Apply a partial patch (already column-named) to every selected design. */
export function bulkUpdateDesigns(rowids: string[], patch: Record<string, unknown>): Promise<BulkResult> {
  return bust(fanOut(rowids, (id) => update("Design", id, patch)));
}

export function bulkDeleteDesigns(rowids: string[]): Promise<BulkResult> {
  return bust(fanOut(rowids, (id) => remove("Design", id)));
}
