import Std

/-!
  # SpecSync closed-contract example

  Demonstrates the generator strategy for obligations that need no unfinished proofs:
  opaque function under contract + `trivial` smoke + `Nat.zero_le` nonnegativity.

  Open LLM postconditions that depend on an unimplemented body still use
  labeled SpecSync unproved markers in generated accept-path files
  (under `.specsync/`), not in this committed smoke library.
-/

/-- SpecSync: function under contract; body not synthesized from source. -/
opaque closedNatId (n : Nat) : Nat

/-- Always-closed smoke obligation for Lake/CI. -/
theorem closedNatId_specsync_smoke : True := trivial

/-- Closed: Nat results are nonnegative. -/
theorem closedNatId_result_nonneg (n : Nat) :
    closedNatId n >= 0 :=
  Nat.zero_le (closedNatId n)

/-- Closed: Nat parameters are nonnegative. -/
theorem closedNatId_param_n_nonneg (n : Nat) :
    n >= 0 :=
  Nat.zero_le n

/-- All checkable fragments above; umbrella is trivial. -/
theorem closedNatId_spec : True := trivial
