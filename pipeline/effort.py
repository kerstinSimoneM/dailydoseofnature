"""Effort-normalized likelihood helpers used when building a release data pack."""

from collections.abc import Mapping


def shrunk_lifts(
    species_counts: Mapping[str, int],
    effort_counts: Mapping[str, int],
    *,
    kappa: float = 10,
    low_confidence_below: int = 30,
) -> dict[str, dict[str, float | int | bool]]:
    """Return smoothed species-vs-effort lift by bucket.

    Buckets omitted from either mapping are treated as zero. No species observations
    are fabricated: the shrinkage prior is the share of all-taxa observer effort.
    """
    total_effort = sum(effort_counts.values())
    if total_effort <= 0:
        return {}
    total_species = sum(species_counts.values())
    result: dict[str, dict[str, float | int | bool]] = {}

    for bucket, effort in effort_counts.items():
        if effort < 0 or species_counts.get(bucket, 0) < 0:
            raise ValueError("Observation and effort counts must be non-negative")
        effort_share = effort / total_effort
        shrunk_share = (species_counts.get(bucket, 0) + kappa * effort_share) / (total_species + kappa)
        lift = min(5.0, max(0.2, shrunk_share / effort_share)) if effort_share else 1.0
        result[bucket] = {
            "support": total_species,
            "lift": lift,
            "low_confidence": total_species < low_confidence_below,
        }

    return result


def cell_rates(
    species_counts: Mapping[str, int],
    effort_counts: Mapping[str, int],
    parent_rates: Mapping[str, float],
    *,
    kappa: float = 20,
    low_effort_below: int = 20,
) -> dict[str, dict[str, float | int | bool]]:
    """Calculate empirical-Bayes cell rates with parent-cell backoff.

    A uniform species share across all observed records yields the same rate in
    high- and low-effort cells instead of rewarding observer density.
    """
    result: dict[str, dict[str, float | int | bool]] = {}
    for cell, effort in effort_counts.items():
        species_count = species_counts.get(cell, 0)
        if effort < 0 or species_count < 0:
            raise ValueError("Observation and effort counts must be non-negative")
        parent_rate = parent_rates.get(cell, 0.0)
        rate = (species_count + kappa * parent_rate) / (effort + kappa)
        result[cell] = {
            "rate": rate,
            "effort": effort,
            "low_effort": effort < low_effort_below,
        }
    return result
