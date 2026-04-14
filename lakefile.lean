import Lake
open Lake DSL

/-- Root Lake package for SpecSync: CI runs `lake build` on `specs/`. -/
package «specsync» where
  version := v!"0.1.0"

@[default_target]
lean_lib «Specs» where
  srcDir := "specs"
