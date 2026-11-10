# Project brief: Orbit Watch

**User:** the operations lead of a 66-satellite communications constellation in low Earth orbit (real public orbits of Iridium NEXT: 80 objects incl. spares, 6 orbital planes, ~777 km).
**Decision:** which satellites need a collision-avoidance maneuver in the next 30 days, and where to spend a limited fuel budget.

## Three connected questions
| Level | Question | Answered by |
| --- | --- | --- |
| 1 Overview: what is happening | Is our collision risk rising, and how many maneuvers will we likely need this month? | close approaches per satellite, high-risk share, expected collisions, maneuvers, vs previous 30 days |
| 2 Diagnosis: where / why | Which orbital planes, altitude bands and debris clouds drive the risk? | risk by plane, by object type and debris family, over time |
| 3 Records: what to investigate | Which specific close approaches need action now, and what is the evidence? | one satellite's events: time of closest approach, miss distance, Pc, status, both orbits on the globe |

## Two approaches considered
| | A: compute real close approaches | B: real orbits + seeded synthetic events (chosen) |
| --- | --- | --- |
| Method | propagate ~3,700 objects with SGP4 and search pairs for 120 days | real orbits and object population; events generated with a fixed seed, rate proportional to real crowding |
| Minimum data | GP elements + covariance (not public) | GP elements (public, CelesTrak) |
| Trust | totals hard to verify, Pc still needs invented covariance | every KPI reconciles to a known generator |
| Effort | hours of compute, risky in class time | minutes, fully reproducible |

**Why B:** public data has no covariance, so real probabilities cannot be computed honestly either way. B keeps geometry and population real, labels events synthetic, and lets every number be verified.
**Scope choice:** dropped an "operator / country" dimension and a per-object "launch cost" view, because neither changes the maneuver decision. The 3D globe stays as the overview hero because location and orbit plane are what an operator reasons with.
