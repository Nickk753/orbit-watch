# Source vs screen KPI check (Block 02, Ex3)

Filters: Next 30 days (10 Nov to 9 Dec 2026), plane 5, other object = Payload. Comparison: 11 Oct to 9 Nov, same filters.
Source: Python over `data/model/*.csv` (no database). Scope: 31 close approaches, 14 satellites, 2 high risk.

| KPI | Source | Screen | Source (prev) | Screen (prev) | Match |
|---|---|---|---|---|---|
| Close approaches per satellite (per 30 days) | 2.21 | 2.21 | 1.93 | 1.93 | yes |
| High-risk share (%) | 6.45 | 6.45 | 0.00 | 0.00 | yes |
| Avoidance maneuvers per satellite | 0.000 | 0.000 | 0.000 | 0.000 | yes |
| Expected collisions (sum of Pc) | 0.0006 | 0.0006 | 0.0001 | 0.0001 | yes |

Result: ALL MATCH.
