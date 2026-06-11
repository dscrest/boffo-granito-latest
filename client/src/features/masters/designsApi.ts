/* ============================================================
   Design (Item) master — typed Data Store wrapper over lib/dataOps.

   The Design table (Catalyst) holds the item catalogue. size / finish /
   category / glaze / brand / grade are real ForeignKeys (each stores the
   parent lookup's ROWID). Every write is recorded server-side in
   OperationLog. Lookup key columns are NOT uniform: Size keys on `code`,
   the rest (Finish/Category/Glaze/Brand/Grade) key on `name`.
   ============================================================ */
import { list, insert, update, remove, type DSRow, type OpResult } from "@/lib/dataOps";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

/** A lookup choice for a FK picker: ROWID + human label. */
export interface LookupOption {
  id: string; // parent ROWID (the value stored in the FK column)
  label: string;
}

/** All six FK lookup option lists, ready for the form selects. */
export interface DesignLookups {
  sizes: LookupOption[];
  finishes: LookupOption[];
  categories: LookupOption[];
  glazes: LookupOption[];
  brands: LookupOption[];
  grades: LookupOption[];
}

export interface DesignRow {
  id: string; // ROWID
  designName: string;
  baseDesignName: string;
  uniqueName: string;
  sku: string;
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
  pcsPerBox: number;
  boxWeightKg: number;
  coverageSqm: number;
  coverageSqft: number;
  randomFaces: number;
  ratePerSqft: number;
  ratePerSqmt: number;
  productOwner: string;
  accountingStock: number;
  booksItemId: string;
  imageUrl: string;
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
  return (rows || [])
    .map((r) => ({ id: String(r.ROWID), label: str(r[key]) || str(r.name) || String(r.ROWID) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Fetch all designs (FK labels hydrated) + the six lookup option lists. */
export async function listDesigns(): Promise<{
  ok: boolean;
  designs: DesignRow[];
  lookups: DesignLookups;
  error?: string;
}> {
  // ZCQL caps LIMIT at 300 rows/query. (Pagination TODO past 300.)
  const [designs, size, finish, category, glaze, brand, grade] = await Promise.all([
    list("Design", { order: "ROWID desc", limit: 300 }),
    list("Size", { limit: 300 }),
    list("Finish", { limit: 300 }),
    list("Category", { limit: 300 }),
    list("Glaze", { limit: 300 }),
    list("Brand", { limit: 300 }),
    list("Grade", { limit: 300 }),
  ]);

  const lookups: DesignLookups = {
    sizes: optionsOf(size.rows, "Size"),
    finishes: optionsOf(finish.rows, "Finish"),
    categories: optionsOf(category.rows, "Category"),
    glazes: optionsOf(glaze.rows, "Glaze"),
    brands: optionsOf(brand.rows, "Brand"),
    grades: optionsOf(grade.rows, "Grade"),
  };

  if (!designs.ok) return { ok: false, designs: [], lookups, error: designs.error };

  const labelMap = (opts: LookupOption[]) => new Map(opts.map((o) => [o.id, o.label]));
  const sz = labelMap(lookups.sizes);
  const fn = labelMap(lookups.finishes);
  const ct = labelMap(lookups.categories);
  const gl = labelMap(lookups.glazes);
  const br = labelMap(lookups.brands);
  const gr = labelMap(lookups.grades);

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
      sku: str(d.sku),
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
      pcsPerBox: num(d.pcs_per_box),
      boxWeightKg: num(d.box_weight_kg),
      coverageSqm: num(d.coverage_sqm),
      coverageSqft: num(d.coverage_sqft),
      randomFaces: num(d.random_faces),
      ratePerSqft: num(d.rate_per_sqft),
      ratePerSqmt: num(d.rate_per_sqmt),
      productOwner: str(d.product_owner),
      accountingStock: num(d.accounting_stock),
      booksItemId: str(d.books_item_id),
      imageUrl: str(d.image_url),
    };
  });

  return { ok: true, designs: rows, lookups };
}

export interface DesignInput {
  design_name: string;
  base_design_name: string;
  party_brand_name: string;
  collection_name: string;
  unique_name: string;
  sku: string;
  status: string;
  // FK ROWIDs ("" = leave unset / clear)
  size: string;
  finish: string;
  category: string;
  glaze: string;
  brand: string;
  grade: string;
  // specs / rates
  pcs_per_box: number;
  box_weight_kg: number;
  coverage_sqm: number;
  coverage_sqft: number;
  random_faces: number;
  rate_per_sqft: number;
  rate_per_sqmt: number;
  product_owner: string;
  accounting_stock: number;
  image_url: string;
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
    status: input.status.trim(),
    pcs_per_box: input.pcs_per_box,
    box_weight_kg: input.box_weight_kg,
    coverage_sqm: input.coverage_sqm,
    coverage_sqft: input.coverage_sqft,
    random_faces: input.random_faces,
    rate_per_sqft: input.rate_per_sqft,
    rate_per_sqmt: input.rate_per_sqmt,
    product_owner: input.product_owner.trim(),
    accounting_stock: input.accounting_stock,
    image_url: input.image_url.trim(),
  };
  for (const k of FK_KEYS) if (input[k]) p[k] = input[k]; // FK only when chosen
  return p;
}

export function createDesign(input: DesignInput) {
  return insert("Design", toPayload(input));
}

export function updateDesign(rowid: string, input: DesignInput) {
  // On edit, send every FK so a cleared picker unsets the column (null).
  const patch = toPayload(input);
  for (const k of FK_KEYS) if (!input[k]) patch[k] = null;
  return update("Design", rowid, patch);
}

export function deleteDesign(rowid: string) {
  return remove("Design", rowid);
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
  return fanOut(rowids, (id) => update("Design", id, patch));
}

export function bulkDeleteDesigns(rowids: string[]): Promise<BulkResult> {
  return fanOut(rowids, (id) => remove("Design", id));
}
