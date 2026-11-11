# Block 02 · Level 1 Executive overview: paste text

Live app: https://orbit-watch-rosy.vercel.app · Code: https://github.com/Nickk753/orbit-watch

## Ex1 · Co-design the overview and app structure
**Upload:** ex1_wireframes.png, ex1_navigation_map.png

**Reasoning & evidence**
- Asked AI for two overview layouts from the approved brief and KPI contract, then compared their reading order.
- **Chosen, A (3D globe + decision panel):** the order is scope, then the decision line ("9 high-risk approaches on 8 satellites await a decision"), then 4 KPIs against the last 30 days, then the globe to show where.
- **Charts:** the weekly bars answer "is risk rising?" and the source bars answer "who causes it?". Both sit one click away in the Charts tab.
- **Rejected, B (classic KPI grid + 2D map):** everything gets equal weight, so there is no clear decision. Polar orbits are also hard to read on a flat map.
- **Navigation:** Overview → 2 diagnostic views (risk by plane and satellite, risk by source and time) → one close-approach record. The Top risks list is a shortcut straight to the record.

## Ex2 · Build the executive overview
**Upload:** ex2_overview_default.png, ex2_metric_definitions.png, ex2_before_after.jpg
**Link:** https://orbit-watch-rosy.vercel.app

**Reasoning & evidence**
- **Prompt excerpt:** "Build the chosen wireframe in Vite + globe.gl using the approved Supabase model. Every KPI comes from kpi_summary(). Show period, units, comparison and freshness, label synthetic data, and add metric definitions."
- **Data:** all 4 KPIs come from the database function `kpi_summary()`. Each one is compared with the previous 30 days using the same filters, and no target was invented.
- **On screen:** the period with its dates, units on every KPI, the comparison line, "Data as of Nov 10 2026: real orbits, synthetic close approaches", and a "What these numbers mean" section with the definitions.
- **Design improvement:** the long scrolling panel (charts competing with the KPIs) became tabs, so the decision and KPIs come first (before/after).

## Ex3 · Make filters and comparisons trustworthy
**Upload:** ex2_overview_default.png (default), ex3_filtered_plane5_payload.png, ex3_kpi_check.png, ex3_empty_state.png

**Reasoning & evidence**
- **Filters:** period (next or last 30 days), plane (1–6), and a new filter for the other object (debris, payload or rocket body).
- **Visible state:** "Showing" chips list the active filters, Reset filters clears them, and every card, chart, list and the globe use the same scope.
- **Fixed scope gap:** the maneuver KPI ignored the object filter. I fixed the SQL (migration 004), and the fleet-wide numbers are unchanged.
- **KPI check:** for next 30 days, plane 5 and payload, I recalculated all 4 KPIs and their comparisons in Python straight from the source CSVs. **All 8 values match the screen.**
- **Empty state:** plane 1 with rocket body has 0 events. The app shows "No close approaches match these filters" with a hint instead of misleading zeros.

## Ex4 · Polish and test the overview experience
**Upload:** ex2_overview_default.png (desktop), ex4_narrow_panel.png (390 px phone), ex4_before_after.jpg, ex4_keyboard_focus.png, ex4_loading.png, ex4_error.png

**Checks actually performed (Playwright, 11 Nov 2026)**
- ✅ **Keyboard:** Tab moves period → plane → object → tabs → definitions → link. Enter opens tabs and a Top risks row. The focus ring is visible.
- ✅ **Chart alternative:** each chart has a one-line text summary plus a "Show data table" section.
- ✅ **Narrow screen (390 px):** no horizontal scroll (0 px overflow) and no overlapping controls.
- ✅ **Loading:** with database responses delayed by 4 s, the spinner and "Loading orbits and close approaches…" show.
- ✅ **Error:** with the database forced to return HTTP 503, the error message and Try again button show.
- **Bug found and fixed:** Try again did nothing on a first-load failure. After the fix it reloads the data.
- **Other fixes from the critique:**
  - Fast filter changes could show stale KPIs. They now keep only the latest answer.
  - The legend is more compact on phones.
