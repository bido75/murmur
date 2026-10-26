# Licensing review (audit copy)

The complete review is `docs/LICENSE_REVIEW.md`. This audit re-verified the
boundary on the enhancement branch.

## Re-verified

| Item | Check | Result |
|---|---|---|
| No Murmure (AGPL-3.0) source in the branch | `git grep` for copied identifiers / engine code paths | No Murmure source; the engine is an independent implementation reading published ONNX graphs |
| Model licence | Parakeet weights CC BY 4.0 | Attribution shipped in-app (this branch added it) |
| New code on this branch | All first-party (Expo/React Native, Deno, SQL) | No third-party licence conflict introduced |
| Dependencies added | `onnxruntime-node` (MIT), Expo SDK 58 packages | MIT/BSD family; no AGPL传染 |

## Outstanding (external)

- A lawyer must confirm the clean-room implementation is not a derivative work of
  the AGPL project. Documented reasoning is in `LICENSE_REVIEW.md`
  (`MURMURE_INTEGRATION.md` records every specification-level borrowing).
- Redistribution of the model binaries (if ever bundled) would require the CC BY
  4.0 attribution block to ship with them — currently they are downloaded at
  runtime with in-app attribution.