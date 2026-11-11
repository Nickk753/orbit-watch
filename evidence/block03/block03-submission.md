# Block 03 · Level 2 Diagnostic views: paste text

Link for every box: https://orbit-watch-rosy.vercel.app

## Ex1 · Design two complementary investigations
Upload: ex1_wireframes_and_question_map.png, ex1_navigation_plan.png
```
Overview finding: elevated-risk close approaches rise 133 → 168 next 30 days while all close approaches stay flat (1,258 → 1,245).
View A "Where is the risk concentrated?": plane → satellite, elevated per satellite vs share of satellites.
View B "What might explain the change?": 3 time windows × debris source, closer vs more approaches.
Both inherit the overview filters, compare with the previous period and lead to one close-approach record. The data cannot prove causes (synthetic events).
```

## Ex2 · View A: locate the pattern
Upload: ex2_viewA_default.png, ex2_viewA_plane1_list.png, ex2_viewA_plane1_record.png
```
Same KPI definitions as the overview. Planes ranked by elevated-risk close approaches per satellite (count and satellites shown).
Pattern: plane 1 has 34 of 168 (20%) with 16% of satellites, 1.25× its share (last 30 days: 18).
Check: planes add up to 1,245 close approaches = kpi_summary() ✓. Fleet rate = 168 ÷ 80 = 2.10, from totals, not averaged.
Click plane 1 → its 13 satellites (zeros shown) → riskiest record.
```

## Ex3 · View B: test an explanation
Upload: ex3_viewB_default.png, ex3_viewB_annotation.png
```
Comparison: elevated 133 → 168 (+26%) while all close approaches 1,258 → 1,245 (−1%); share under 500 m 6.0% → 6.9%.
Hypothesis: the rise comes from closer approaches, not more of them (Fengyun-1C adds the most, +23).
Against: the month before had 157, so vs that it is only +7%; the rate rose for all 4 sources, so not one debris cloud. Events are synthetic and 3 windows are too few. Association, not cause.
```

## Ex4 · Connect the analytical journey
Upload: ex4_journey_4_steps.jpg, ex4_expected_vs_observed.png, ex4_narrow_both_views.jpg, ex4_before_after_empty.jpg
```
Overview → View A → record → back → View B → browser back. Filters and all 4 KPIs stayed identical (expected values from Python, 8/8 pass).
Breadcrumbs, Back button, browser back and Reset work. View-specific choices (plane, source) are labelled and don't change the overview.
Empty selection (plane 1 + rocket body) showed "NaN%"; fixed with a clear message.
Phone 390 px: no sideways scroll; keyboard reaches and selects plane rows.
```
