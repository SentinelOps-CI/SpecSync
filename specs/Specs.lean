import Std
import Specs.ClosedNatContract

/-!
  Root module for the `Specs` library (`lake build`).

  - Committed modules under `specs/Specs/` must stay Std-only and lake-buildable.
  - Accept-path Lean for target repos is written under `.specsync/` (not this tree).
  - This library intentionally has **zero** `sorry` so soft/strict gates have a clean baseline.
-/

theorem specsync_smoke : True := trivial
