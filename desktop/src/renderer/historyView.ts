// The dictation history panel.
//
// What was said, and when. It stays on this computer.
import { h, type Child } from "./dom";
import { howMade, timeAgo, words } from "./historyPanel";
import type { HistoryEntry } from "./dictation";

/** The history, as it is shown. */
export type HistoryState = {
  entries: HistoryEntry[];
  loading: boolean;
  query: string;
};

export const historyState: HistoryState = {
  entries: [],
  loading: false,
  query: "",
};

/** The panel. `rerender` puts the rest of the screen back the way it was. */
export function historyPanel(rerender: () => void): Child[] {
  const h2 = (s: string) => h("h2", {}, s);
  const entries = historyState.entries;
  return [
    h(
      "div",
      { class: "card" },
      h("strong", {}, "Dictation history"),
      h(
        "p",
        { class: "muted" },
        "What you have dictated. It stays on this computer and is not uploaded.",
      ),
      h(
        "div",
        { class: "row" },
        h("input", {
          type: "text",
          placeholder: "Search",
          value: historyState.query,
          oninput: (e: Event) => {
            historyState.query = (e.target as HTMLInputElement).value;
            rerender();
          },
        }),
        h(
          "button",
          {
            class: "ghost",
            onclick: () => {
              historyState.query = "";
              void historyLoad().then(rerender);
            },
          },
          "Clear the search",
        ),
        h(
          "button",
          {
            class: "ghost",
            onclick: () => {
              if (!entries.length) return;
              void historyClear().then(rerender);
            },
          },
          "Clear the history",
        ),
      ),
      entries.length === 0
        ? h("p", { class: "muted" }, "Nothing dictated yet.")
        : h(
            "div",
            { class: "list" },
            ...entries.map((e) =>
              h(
                "div",
                { class: "card item" },
                h(
                  "div",
                  { style: "flex:1; min-width:0" },
                  h("div", {}, e.text),
                  h(
                    "p",
                    { class: "muted" },
                    `${timeAgo(e.at)} · ${words(e)} words · ${howMade(e)} · ${(e.tookMs / 1000).toFixed(1)}s`,
                  ),
                ),
                h(
                  "button",
                  {
                    class: "ghost",
                    title: "Copy",
                    onclick: () => {
                      void historyCopy(e.id).then(rerender);
                    },
                  },
                  "Copy",
                ),
                h(
                  "button",
                  {
                    class: "ghost",
                    title: "Delete",
                    onclick: () => {
                      void historyRemove(e.id).then(rerender);
                    },
                  },
                  "✕",
                ),
              ),
            ),
          ),
    ),
  ];
}

// The calls the panel makes. They are set by the window when it starts.
let historyLoad: () => Promise<HistoryEntry[]> = async () => [];
let historyCopy: (id: string) => Promise<void> = async () => {};
let historyRemove: (id: string) => Promise<void> = async () => {};
let historyClear: () => Promise<void> = async () => {};

/** Give the panel its ways of reaching the history. */
export function setHistoryActions(actions: {
  load: () => Promise<HistoryEntry[]>;
  copy: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
}): void {
  historyLoad = actions.load;
  historyCopy = actions.copy;
  historyRemove = actions.remove;
  historyClear = actions.clear;
}
