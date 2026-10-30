// The dictation settings.
//
// The shortcuts the user can change, how the words get to where they are typing, and
// whether the history is kept.
import { h, type Child } from "./dom";
import { ACTION_LABELS, type Shortcut, type ShortcutAction } from "../shared/shortcuts";

export type DictationSettingsState = {
  shortcuts: Shortcut[];
  insertMethod: "clipboard" | "paste" | "type";
  keepHistory: boolean;
  /** A shortcut that could not be taken, and why. */
  refused: string[];
};

export const dictationSettings: DictationSettingsState = {
  shortcuts: [],
  insertMethod: "paste",
  keepHistory: true,
  refused: [],
};

const ACTIONS: ShortcutAction[] = ["record", "cancel", "pasteLast", "history"];

/** The panel. `rerender` puts the rest of the screen back the way it was. */
export function dictationPanel(
  rerender: () => void,
  onChange: (shortcuts: Shortcut[]) => void,
): Child[] {
  const setBinding = (action: ShortcutAction, binding: string) => {
    onChange(
      dictationSettings.shortcuts.map((s) =>
        s.action === action ? { ...s, binding } : s,
      ),
    );
    rerender();
  };

  return [
    h(
      "div",
      { class: "card" },
      h("strong", {}, "Dictation"),
      h(
        "p",
        { class: "muted" },
        "Hold nothing down: press the shortcut to start, press it again to stop. The words are put where you are typing.",
      ),
      ...ACTIONS.map((action) => {
        const shortcut = dictationSettings.shortcuts.find((s) => s.action === action);
        if (!shortcut) return null;
        const refused = dictationSettings.refused.includes(shortcut.binding);
        return h(
          "label",
          { class: "row" },
          h("span", { style: "min-width:150px" }, ACTION_LABELS[action]),
          h("input", {
            type: "text",
            value: shortcut.binding,
            placeholder: "ctrl+space",
            style: refused ? "border-color:#D9472F" : "",
            onchange: (e: Event) =>
              setBinding(action, (e.target as HTMLInputElement).value),
          }),
        );
      }),
      dictationSettings.refused.length > 0
        ? h(
            "p",
            { class: "muted" },
            `Another program is using ${dictationSettings.refused.join(", ")}, so it could not be taken.`,
          )
        : null,
      h(
        "label",
        { class: "row" },
        h("span", { style: "min-width:150px" }, "Put the words"),
        h(
          "select",
          {
            "aria-label": "How the words are put in",
            onchange: (e: Event) => {
              dictationSettings.insertMethod = (
                e.target as HTMLSelectElement
              ).value as DictationSettingsState["insertMethod"];
              rerender();
            },
          },
          ...(
            [
              ["paste", "Paste them for me"],
              ["type", "Type them out"],
              ["clipboard", "Just put them on the clipboard"],
            ] as [string, string][]
          ).map(([v, l]) =>
            h("option", { value: v, selected: v === dictationSettings.insertMethod }, l),
          ),
        ),
      ),
      h(
        "label",
        { class: "row" },
        h("span", { style: "min-width:150px" }, "Keep the history"),
        h("input", {
          type: "checkbox",
          checked: dictationSettings.keepHistory,
          onchange: (e: Event) => {
            dictationSettings.keepHistory = (e.target as HTMLInputElement).checked;
            rerender();
          },
        }),
        h("span", { class: "muted" }, "on this computer only"),
      ),
    ),
  ];
}
