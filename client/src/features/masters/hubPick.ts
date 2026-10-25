/* CR-436: which Masters sub-tab + master the URL selects. Pure, so hubPick.check.ts can run it.
   ?g= wins; else the group owning ?m= (legacy /masters?m=finish links); else the first visible group. */
export function hubPick<G extends { key: string; masters: { key: string }[] }>(
  groups: G[],
  g: string | null,
  m: string | null,
): { group: G; master: G["masters"][number] } | null {
  const group = groups.find((x) => x.key === g) ?? groups.find((x) => x.masters.some((y) => y.key === m)) ?? groups[0];
  const master = group?.masters.find((x) => x.key === m) ?? group?.masters[0];
  return group && master ? { group, master } : null;
}
