#!/usr/bin/env python3
"""Re-derive CARS_PER_YEAR for src/lib/receipt/carsAdded.ts.

Bangalore car registrations from the RTO dataset: the 9 Bangalore urban RTOs,
registration classes Motor Car + Motor Cab + Maxi Cab, averaged over full years
2022-2025. Prints the constant baked into carsAdded.ts.

Usage: python3 scripts/deriveCarsPerYear.py
Requires pyarrow.
"""

import pyarrow.parquet as pq
import pyarrow.compute as pc
import pyarrow as pa
import collections
import os

PARQUET = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "assets", "vehicle-statistics.parquet")

BLR_RTOS = [
    "BENGALURU CENTRAL  RTO",
    "BENGALURU EAST  RTO",
    "BENGALURU WEST  RTO",
    "BENGALURU NORTH  RTO",
    "BENGALURU SOUTH  RTO",
    "ELECTRONIC CITY  RTO",
    "KRISHNARAJAPURAM  RTO",
    "YALAHANKA  RTO",
    "JNANABHARATHI  RTO",
]
CAR_CLASSES = ["-Motor Car", "-Motor Cab", "-Maxi Cab"]
FULL_YEARS = [2022, 2023, 2024, 2025]


def main() -> None:
    t = pq.read_table(PARQUET)
    f = pc.and_(
        pc.equal(t.column("Metric"), "Registration Class"),
        pc.is_in(t.column("RTO Name"), value_set=pa.array(BLR_RTOS)),
    )
    f = pc.and_(f, pc.is_in(t.column("Name"), value_set=pa.array(CAR_CLASSES)))
    s = t.filter(f)

    by_year = collections.defaultdict(int)
    for y, c in zip(s.column("Year").to_pylist(), s.column("Count").to_pylist()):
        by_year[y] += c

    for y in sorted(by_year):
        tag = " (partial)" if y not in FULL_YEARS else ""
        print(f"  {y}: {by_year[y]:>8}{tag}")

    avg = round(sum(by_year[y] for y in FULL_YEARS) / len(FULL_YEARS))
    print(f"\nCARS_PER_YEAR = {avg}   (~{avg / 365:.0f}/calendar-day)")


if __name__ == "__main__":
    main()
