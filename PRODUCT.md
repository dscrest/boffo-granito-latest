# Product

## Register

product

## Users

The OCTFIS / BOFFO export operations team: sales staff raising quotes and master orders, production and QC coordinators updating stage quantities, logistics staff palletizing, loading containers and issuing invoices, and an admin managing masters (items, pallets, customers, users). Desktop-first, used all day as the system of record for tile export orders. Non-technical users; some work from warehouse laptops.

## Product Purpose

BOFFO Order OS tracks tile export orders end-to-end: quote → master order → production → QC → palletization → container loading → invoice, backed by Zoho Catalyst. It replaces spreadsheets and scattered WhatsApp updates with one live pipeline, so anyone can answer "where is this order?" in seconds. Success = every stage quantity recorded at the source, and management reading the dashboard instead of asking people.

## Brand Personality

Efficient, calm, trustworthy. A quiet operational tool: data first, low visual noise, nothing fights for attention. Confidence comes from accuracy and speed, not decoration.

## Anti-references

- Cluttered legacy ERP (Tally-style walls of fields, cramped tables, popup mazes).
- Flashy marketing SaaS (gradients, oversized heroes, decorative dashboards).
- Generic AI-generated look (interchangeable card grids, purple gradients, uniform spacing with no hierarchy).

## Design Principles

1. **The grid is the product** — list pages are where work happens; pagination, sorting, filtering and column control must be uniform and dependable (see .claude/memory/grid-ux-standard.md).
2. **One source of truth per fact** — a count, status or total appears in exactly one place per screen; no repetition between header, toolbar and footer.
3. **Real numbers only** — never show placeholder/static figures as if live; an honest "—" beats a fake KPI.
4. **Masters feed processes** — pick-list values always come from the DB masters, never hardcoded lists.
5. **Every action confirms** — writes show progress and land in the audit log; users should never wonder whether a save happened.

## Accessibility & Inclusion

WCAG AA basics: ≥4.5:1 text contrast, full keyboard operability for primary flows, visible focus states. No screen-reader-specific requirements known, but don't design against them.
