/* ============================================================
   Code 128 (CR-502 follow-up) — the customer's barcode is whatever they
   give us (any length, letters allowed), so arbitrary codes print as
   Code 128; a code that is a valid EAN-13 still prints as EAN (ean13.ts).
   Pure + dependency-free; the check runs under plain Node.
   ponytail: subsets B (text) and C (even-length digits) only — no mid-code
   subset switching; good enough for item codes, swap in bwip-js if a customer
   sends control characters.
   ============================================================ */

/** Element widths (bar,space,…) for values 0…106; 106 = Stop (7 elements). */
const W = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const START_C = 105;
const STOP = 106;

/** Why a typed barcode is refused ("" = fine): Code 128 B covers printable ASCII only. */
export function barcodeProblem(s: string): string {
  if (!s) return "";
  if (!/^[\x20-\x7e]+$/.test(s)) return "Only letters, digits and plain punctuation can be printed as a barcode";
  if (s.length > 100) return "A barcode can be at most 100 characters";
  return "";
}

/** Symbol values for the text: subset C when it is an even run of digits, else subset B. */
export function code128Values(text: string): number[] {
  if (barcodeProblem(text) || !text) throw new Error(`Cannot encode as Code 128: ${text}`);
  const vals: number[] = [];
  if (/^\d+$/.test(text) && text.length % 2 === 0) {
    vals.push(START_C);
    for (let i = 0; i < text.length; i += 2) vals.push(Number(text.slice(i, i + 2)));
  } else {
    vals.push(START_B);
    for (const ch of text) vals.push(ch.charCodeAt(0) - 32);
  }
  let sum = vals[0];
  for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103, STOP);
  return vals;
}

/** The module string ("1" = bar) of the whole symbol, no quiet zone. */
export function code128Modules(text: string): string {
  let out = "";
  for (const v of code128Values(text)) {
    const w = W[v];
    for (let i = 0; i < w.length; i++) out += (i % 2 ? "0" : "1").repeat(Number(w[i]));
  }
  return out;
}

/** Every pattern is 11 modules (Stop 13) with 3 bars + 3 spaces — guards the table against typos. */
export function code128TableOk(): boolean {
  return W.every((w, i) => {
    const sum = [...w].reduce((n, c) => n + Number(c), 0);
    return i === STOP ? w.length === 7 && sum === 13 : w.length === 6 && sum === 11;
  });
}
