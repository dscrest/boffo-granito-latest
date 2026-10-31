/* ============================================================
   Box labels (CR-502) — typed wrapper over two tables:
   - CustomerItemCode: the customer's OWN barcode (EAN-13) + item name per item.
   - LabelTemplate: one sticker a customer needs (layout + size + its texts as JSON);
     customer blank = house template, offered for every customer.
   Server guards (13 digits + check digit, one row per customer × item, one item per
   customer × barcode) live in functions/data-ops (assertItemCode).
   ============================================================ */
import { insert, listAll, remove, update, type DSRow } from "@/lib/dataOps";

const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);

export interface ItemCode {
  id: string;
  customerId: string;
  designId: string;
  barcode: string;
  /** The customer's name for the item ("" = print our design name). */
  customerItemName: string;
}

export type LabelLayoutKey = "barcode-strip" | "batch-strip" | "compliance";

export interface LabelTemplate {
  id: string;
  name: string;
  /** "" = house template (every customer). */
  customerId: string;
  layout: LabelLayoutKey;
  widthMm: number;
  heightMm: number;
  texts: Record<string, string>;
  active: boolean;
}

const toCode = (r: DSRow): ItemCode => ({
  id: str(r.ROWID),
  customerId: str(r.customer),
  designId: str(r.design),
  barcode: str(r.barcode),
  customerItemName: str(r.customer_item_name),
});

function parseTexts(v: unknown): Record<string, string> {
  try {
    const o = JSON.parse(str(v) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

const toTemplate = (r: DSRow): LabelTemplate => ({
  id: str(r.ROWID),
  name: str(r.name),
  customerId: str(r.customer),
  layout: (str(r.layout) || "barcode-strip") as LabelLayoutKey,
  widthMm: num(r.width_mm),
  heightMm: num(r.height_mm),
  texts: parseTexts(r.texts),
  active: r.active !== false && str(r.active) !== "false",
});

/** One customer's codes, or every customer's when `customerId` is omitted (print modal). */
export async function listItemCodes(customerId?: string): Promise<{ ok: boolean; rows: ItemCode[]; error?: string }> {
  const res = await listAll("CustomerItemCode", customerId ? { where: `customer = ${customerId.replace(/\D/g, "")}` } : {});
  return { ok: res.ok, rows: (res.rows || []).map(toCode), error: res.error };
}

export function saveItemCode(input: Omit<ItemCode, "id">, id?: string) {
  const row = { customer: input.customerId, design: input.designId, barcode: input.barcode.trim(), customer_item_name: input.customerItemName.trim() };
  return id ? update("CustomerItemCode", id, row) : insert("CustomerItemCode", row);
}

export const removeItemCode = (id: string, reason: string) => remove("CustomerItemCode", id, reason);

export async function listTemplates(): Promise<{ ok: boolean; rows: LabelTemplate[]; error?: string }> {
  const res = await listAll("LabelTemplate");
  return { ok: res.ok, rows: (res.rows || []).map(toTemplate).sort((a, b) => a.name.localeCompare(b.name)), error: res.error };
}

export function saveTemplate(t: Omit<LabelTemplate, "id">, id?: string) {
  const row = {
    name: t.name.trim(),
    customer: t.customerId || null,
    layout: t.layout,
    width_mm: t.widthMm,
    height_mm: t.heightMm,
    texts: JSON.stringify(t.texts),
    active: t.active,
  };
  return id ? update("LabelTemplate", id, row) : insert("LabelTemplate", row);
}

export const removeTemplate = (id: string, reason: string) => remove("LabelTemplate", id, reason);

/** Templates a print for `customerId` offers: that customer's own + the house ones. */
export const templatesFor = (all: LabelTemplate[], customerId: string) =>
  all.filter((t) => t.active && (!t.customerId || t.customerId === customerId));
