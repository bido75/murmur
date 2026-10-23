// The speech model panel on the home screen.
//
// It says plainly what the model is for, what it costs to download, and whether the
// recording is made on this computer or sent to the server.
import { h, type Child } from "./dom";
import {
  cancelSpeechModel,
  installSpeechModel,
  loadSpeechPreference,
  loadSpeechStatus,
  removeSpeechModel,
  saveSpeechPreference,
  speech,
} from "./speech";

/** The panel. `rerender` puts the rest of the screen back the way it was. */
export function speechPanel(rerender: () => void): Child[] {
  const status = speech.status;
  const ready = Boolean(status?.ready);
  const engineReady = Boolean(status?.engineAvailable);

  const refresh = async () => {
    await loadSpeechStatus();
    rerender();
  };

  return [
    h(
      "div",
      { class: "card" },
      h("strong", {}, "Transcribe on this computer"),
      h(
        "p",
        { class: "muted" },
        status
          ? `${status.label}. ${status.note}`
          : "The audio is transcribed here and never leaves this computer.",
      ),
      h(
        "label",
        { class: "row" },
        h("input", {
          type: "checkbox",
          checked: speech.local,
          disabled: !ready || !engineReady,
          onchange: (e: Event) => {
            speech.local = (e.target as HTMLInputElement).checked;
            saveSpeechPreference(speech.local);
            rerender();
          },
        }),
        h(
          "span",
          {},
          ready && engineReady
            ? "Make new recordings on this computer"
            : "Install the speech model to use this",
        ),
      ),
      status && !engineReady && status.engineReason
        ? h("p", { class: "muted" }, status.engineReason)
        : null,
      speech.installing && speech.progress
        ? h(
            "div",
            {},
            h(
              "p",
              { class: "muted" },
              `${speech.progress.stage === "verifying" ? "Checking" : "Downloading"} — ${speech.progress.percent}%`,
            ),
            h(
              "div",
              { class: "meter" },
              h("div", { style: `width: ${speech.progress.percent}%` }),
            ),
          )
        : null,
      speech.error ? h("div", { class: "banner" }, speech.error) : null,
      status && !ready && !speech.installing
        ? h(
            "button",
            {
              class: "ghost",
              onclick: () =>
                void installSpeechModel().then(refresh),
            },
            `Download the speech model (${status.sizeMb} MB)`,
          )
        : null,
      status && ready
        ? h(
            "button",
            {
              class: "ghost",
              onclick: () =>
                void removeSpeechModel().then(refresh),
            },
            "Remove the speech model",
          )
        : null,
      speech.installing
        ? h(
            "button",
            {
              class: "ghost",
              onclick: () => void cancelSpeechModel().then(refresh),
            },
            "Stop the download",
          )
        : null,
      ready
        ? h(
            "p",
            { class: "muted" },
            "When this is on, the audio stays on this computer. Only the words are sent, so the notes can be written.",
          )
        : null,
    ),
  ];
}

/** Load the model status when the app starts. */
export async function initSpeech(): Promise<void> {
  speech.local = loadSpeechPreference();
  await loadSpeechStatus();
}
