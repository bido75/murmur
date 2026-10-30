// The settings save state machine: optimistic update, rollback on failure.
// Pure: tested under Node so the rollback cannot silently regress.

export type SaveState = "idle" | "saving" | "saved" | "error";

/** The effective default recording type. Field mode overrides, never overwrites. */
export function effectiveDefaultTemplate<
  S extends { fieldMode: boolean; defaultTemplate: T },
  T extends string,
>(s: S): T {
  return s.fieldMode ? ("site_walk" as T) : s.defaultTemplate;
}

export type SaveEvent<S> =
  | { type: "change"; patch: Partial<S> }
  | { type: "saveOk" }
  | { type: "saveFail" };

export type SettingsUiState<S> = {
  settings: S;
  /** The settings as last successfully persisted, for rollback. */
  saved: S;
  saveState: SaveState;
};

export function initSettingsUi<S>(settings: S): SettingsUiState<S> {
  return { settings, saved: settings, saveState: "idle" };
}

/**
 * Apply a save event. On change the optimistic value is shown and the state
 * moves to "saving"; on failure the control rolls back to the last persisted
 * value so the UI matches what the server actually has.
 */
export function reduceSave<S>(
  state: SettingsUiState<S>,
  event: SaveEvent<S>,
): SettingsUiState<S> {
  switch (event.type) {
    case "change": {
      const settings = { ...state.settings, ...event.patch };
      return { ...state, settings, saveState: "saving" };
    }
    case "saveOk":
      return { ...state, saved: state.settings, saveState: "saved" };
    case "saveFail":
      // Roll back so the UI matches what was actually saved.
      return { ...state, settings: state.saved, saveState: "error" };
  }
}