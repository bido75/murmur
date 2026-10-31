import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ActionMenu, type MenuAction } from "@/components/ActionMenu";
import { SendToTracker } from "@/components/SendToTracker";
import { PhotoStrip, PhotoViewer, SiteLogView } from "@/components/SiteLog";
import { PromptModal, type Prompt } from "@/components/PromptModal";
import { PlayerBar } from "@/components/PlayerBar";
import { TaskRow } from "@/components/TaskRow";
import { TourAnchor } from "@/components/tour/TourAnchor";
import { useTourController } from "@/components/tour/TourProvider";
import { markFirstReadyOpened, markFirstTaskAction } from "@/lib/onboardingStore";
import { TimestampChip } from "@/components/TimestampChip";
import {
  Banner,
  Button,
  Card,
  Empty,
  Segmented,
  StatusPill,
  T,
} from "@/components/ui";
import {
  addComment,
  addToReel,
  createReel,
  listReels,
  ask,
  DESTINATIONS,
  exportNotes,
  type Destination,
  translateRecording,
  type Translation,
  audioUrl,
  cancelBot,
  consentResponses,
  createShareLink,
  currentUserId,
  deleteComment,
  listComments,
  setSpeakerName,
  shareUrl,
  updateSummary,
  updateUtteranceText,
  type Comment,
  deletePhoto,
  getBot,
  deleteRecording,
  getRecording,
  listIntegrations,
  listProjects,
  renameRecording,
  retryProcessing,
  sendSiteLogToProcore,
  setPhotoCaption,
  setRecordingProject,
  updateTask,
} from "@/lib/api";
import { confirm, isWeb, notify, shareOrCopy } from "@/lib/dialog";
import { APP_URL } from "@/lib/config";
import { findLanguage, TRANSLATION_LANGUAGES, photoMoment } from "@/lib/shared";
import { LanguagePickerSheet } from "@/components/LanguagePickerSheet";
import { queuePhoto, takePhoto } from "@/lib/photos";
import { clock, minutes, shortDate, speakerLabel } from "@/lib/format";
import { useRecordingPlayer } from "@/lib/player";
import { radius, space, useTheme } from "@/lib/theme";
import {
  CONSENT_LABELS,
  PROVIDER_LABELS,
  TEMPLATE_LABELS,
  type ConsentResponse,
  type Integration,
  type MeetingBot,
  type Photo,
  type Project,
  type Task,
} from "@/lib/types";

type Data = Awaited<ReturnType<typeof getRecording>>;
type Tab = "notes" | "transcript" | "tasks" | "ask";

export default function RecordingDetail() {
  // The tour provider lives at the root, so its controller works on this screen too.
  const { userId } = useTourController();
  const { id, t: atParam } = useLocalSearchParams<{ id: string; t?: string }>();
  const t = useTheme();
  const [data, setData] = useState<Data | null>(null);
  // Opened from search: start on the transcript at the moment the words were said.
  const focusMs = atParam != null && atParam !== "" ? Number(atParam) : null;
  const [tab, setTab] = useState<Tab>(focusMs != null ? "transcript" : "notes");
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [translation, setTranslation] = useState<Translation | null>(null);
  const [translating, setTranslating] = useState(false);
  const [langPicker, setLangPicker] = useState(false);
  const [title, setTitle] = useState("");
  const [menu, setMenu] = useState<{
    title?: string;
    actions: MenuAction[];
  } | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Photo | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  useEffect(() => {
    currentUserId().then(setMe);
    listIntegrations()
      .then(setIntegrations)
      .catch(() => setIntegrations([]));
  }, []);

  const [responses, setResponses] = useState<ConsentResponse[]>([]);
  const [bot, setBot] = useState<MeetingBot | null>(null);
  const load = useCallback(
    () =>
      getRecording(id)
        .then(async (d) => {
          setData(d);
          if (d.recording) setTitle((prev) => prev || d.recording!.title);
          setResponses(await consentResponses(id));
          setComments(await listComments(id));
          if (d.recording?.source === "bot") setBot(await getBot(id));
        })
        .catch((e) => notify("Couldn't load recording", (e as Error).message)),
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // "Open your notes" checklist activity: the first time a ready recording is opened.
  useEffect(() => {
    if (data?.recording?.status === "ready" && userId) void markFirstReadyOpened(userId);
  }, [data?.recording?.status, userId]);

  const status = data?.recording?.status;
  useEffect(() => {
    if (!status || ["ready", "failed", "cancelled"].includes(status)) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [status, load]);

  /** Play from a moment in the recording, across segment files. */
  const segments = useMemo(() => data?.segments ?? [], [data?.segments]);
  const utterances = useMemo(
    () => data?.transcript?.utterances ?? [],
    [data?.transcript?.utterances],
  );
  const player = useRecordingPlayer(
    segments,
    data?.recording?.duration_ms ?? 0,
    utterances,
  );
  const [following, setFollowing] = useState(true);

  function playAt(ms: number) {
    if (data?.recording?.audio_deleted_at) {
      notify(
        "Audio removed",
        "The audio was deleted by your retention setting. The transcript and notes are kept.",
      );
      return;
    }
    void player.seekToMs(ms, true);
  }

  useEffect(() => {
    if (player.error) notify("Can't play audio", player.error);
  }, [player.error]);

  async function setTask(task: Task, patch: Partial<Task>) {
    setData((d) =>
      d
        ? {
            ...d,
            tasks: d.tasks.map((x) =>
              x.id === task.id ? { ...x, ...patch } : x,
            ),
          }
        : d,
    );
    // A kept/dismissed/checked task counts as checklist activity.
    if ((patch.status || "needs_review" in patch) && userId)
      void markFirstTaskAction(userId);
    try {
      await updateTask(task.id, patch);
    } catch (e) {
      notify("Couldn't update task", (e as Error).message);
      void load();
    }
  }

  const guard = (fn: () => void | Promise<void>) => async () => {
    try {
      await fn();
    } catch (e) {
      notify("Something went wrong", (e as Error).message);
    }
  };

  async function chooseProject() {
    const rec = data?.recording;
    if (!rec) return;
    const projects: Project[] = await listProjects().catch(() => []);
    setMenu({
      title: "Move to project",
      actions: [
        {
          label: "No project",
          onPress: guard(async () => {
            await setRecordingProject(rec.id, null);
            await load();
          }),
        },
        ...projects.map((p) => ({
          label: p.id === rec.project_id ? `${p.name} âœ“` : p.name,
          onPress: guard(async () => {
            await setRecordingProject(rec.id, p.id);
            await load();
          }),
        })),
      ],
    });
  }

  async function addPhoto(source: "camera" | "library") {
    const rec = data?.recording;
    if (!rec) return;
    try {
      const shot = await takePhoto(source);
      if (!shot) return;
      // A library photo taken during the recording goes to its moment (from the photo's time).
      const at =
        source === "library"
          ? photoMoment(
              shot.takenAt ?? null,
              rec.created_at,
              rec.duration_ms ?? 0,
            )
          : null;
      await queuePhoto(rec.id, shot, at, at != null && rec.status === "ready");
      await load();
      if (at != null)
        notify(
          "Photo placed",
          `Taken ${clock(at)} into the recording, so it's linked to what was being said then.`,
        );
    } catch (e) {
      notify("Couldn't add the photo", (e as Error).message);
    }
  }

  const procore = integrations.find((i) => i.provider === "procore");
  const isOwnerNow =
    !!data?.recording &&
    (!data.recording.user_id || data.recording.user_id === me);

  function renameSpeaker(speaker: number) {
    if (!data?.transcript || !isOwnerNow) return;
    const names = data.transcript.speaker_names ?? {};
    setPrompt({
      title: `Who is ${speakerLabel(speaker, names)}?`,
      message:
        "Used everywhere in this recording. Re-run notes to use the name in tasks and owners too.",
      initial: names[String(speaker)] ?? "",
      placeholder: "Name",
      onSubmit: async (v) => {
        const next = await setSpeakerName(id, speaker, v, names);
        setData((d) =>
          d && d.transcript
            ? { ...d, transcript: { ...d.transcript, speaker_names: next } }
            : d,
        );
      },
    });
  }

  const base = APP_URL || (isWeb ? window.location.origin : "");

  /** Long-press on a transcript line. */
  function lineMenu(index: number) {
    const u = data?.transcript?.utterances?.[index];
    if (!u) return;
    const actions: MenuAction[] = [
      {
        label: `Play from ${clock(u.start_ms)}`,
        onPress: () => void playAt(u.start_ms),
      },
      {
        label: "Bookmark this moment",
        onPress: guard(async () => {
          await addComment(id, {
            kind: "bookmark",
            at_ms: u.start_ms,
            body: u.text.slice(0, 140),
          });
          setComments(await listComments(id));
        }),
      },
      {
        label: "Comment on this moment",
        onPress: () =>
          setPrompt({
            title: `Comment at ${clock(u.start_ms)}`,
            multiline: true,
            okLabel: "Post",
            onSubmit: async (v) => {
              if (v.trim()) {
                await addComment(id, {
                  kind: "comment",
                  at_ms: u.start_ms,
                  body: v.trim(),
                });
                setComments(await listComments(id));
              }
            },
          }),
      },
      {
        // Anyone who can read the recording can collect clips in their own reels.
        label: "Add to a highlight reel…",
        onPress: guard(async () => {
          const reels = await listReels();
          const mine = reels.filter((r) => r.user_id === me);
          const start = Math.max(0, u.start_ms - 2000);
          const clip = {
            recording_id: id,
            start_ms: start,
            end_ms: Math.max(u.end_ms + 3000, start + 15_000),
            title: u.text.slice(0, 80),
          };
          const add = async (reelId: string, name: string) => {
            await addToReel(reelId, clip);
            notify("Added", `Clip added to “${name}”.`);
          };
          setMenu({
            title: "Add this moment to",
            actions: [
              ...mine.map((r) => ({
                label: r.title,
                onPress: guard(() => add(r.id, r.title)),
              })),
              {
                label: "New reel…",
                onPress: () =>
                  setPrompt({
                    title: "Name the reel",
                    placeholder: "e.g. Client feedback, October",
                    okLabel: "Create",
                    onSubmit: async (v) => {
                      if (v.trim()) await add(await createReel(v), v.trim());
                    },
                  }),
              },
            ],
          });
        }),
      },
    ];
    if (isOwnerNow) {
      for (const secs of [30, 60, 120]) {
        actions.push({
          label: `Share a ${secs < 60 ? `${secs}-second` : `${secs / 60}-minute`} clip from here`,
          onPress: guard(async () => {
            if (!base)
              throw new Error(
                "Set EXPO_PUBLIC_APP_URL so clips have somewhere to open.",
              );
            const start = Math.max(0, u.start_ms - 2000);
            const token = await createShareLink(id, {
              clip_start_ms: start,
              clip_end_ms: start + secs * 1000,
              title: u.text.slice(0, 80),
            });
            await shareOrCopy(shareUrl(token, base), "Clip link copied");
          }),
        });
      }
      actions.push({
        label: "Fix the wording",
        onPress: () =>
          setPrompt({
            title: "Fix the transcript",
            message: "Corrections are kept if you re-run the notes.",
            initial: u.text,
            multiline: true,
            onSubmit: async (v) => {
              if (!v.trim() || !data?.transcript) return;
              const next = await updateUtteranceText(
                id,
                data.transcript.utterances,
                index,
                v,
              );
              setData((d) =>
                d && d.transcript
                  ? { ...d, transcript: { ...d.transcript, utterances: next } }
                  : d,
              );
            },
          }),
      });
      actions.push({
        label: `Rename ${speakerLabel(u.speaker, data?.transcript?.speaker_names ?? {})}`,
        onPress: () => renameSpeaker(u.speaker),
      });
    }
    setMenu({
      title: `${clock(u.start_ms)} · ${u.text.slice(0, 60)}`,
      actions,
    });
  }

  async function sendLog() {
    const rec = data?.recording;
    if (!rec) return;
    if (!procore?.config.target) {
      notify(
        "Choose a Procore project first",
        "Go to Settings â†’ Task trackers â†’ Procore and pick the project.",
      );
      return;
    }
    const ok = await confirm(
      "Add to Procore daily log?",
      `The site log (verified entries only) is added as a note in ${procore.config.target.name}'s daily log for the day it was recorded.`,
      "Add",
    );
    if (!ok) return;
    try {
      const res = await sendSiteLogToProcore(rec.id, rec.created_at);
      await load();
      notify(
        res.already ? "Already in Procore" : "Added to Procore",
        "Open it from the site log.",
      );
    } catch (e) {
      notify("Couldn't send to Procore", (e as Error).message);
    }
  }

  async function sendNotes(recId: string, d: Destination) {
    const run = async (emails: string[] = []) => {
      try {
        const r = await exportNotes(recId, d, emails);
        const where = PROVIDER_LABELS[d];
        const extra =
          d === "slack" && r.channel
            ? ` (${r.channel})`
            : r.linked != null
              ? ` · linked to ${r.linked} contact${r.linked === 1 ? "" : "s"}`
              : "";
        if (
          r.url &&
          (await confirm(`Sent to ${where}${extra}`, "Open it now?", "Open"))
        )
          void Linking.openURL(r.url);
        else if (!r.url) notify(`Sent to ${where}${extra}`);
      } catch (e) {
        notify(`Couldn't send to ${PROVIDER_LABELS[d]}`, (e as Error).message);
      }
    };
    if (d === "hubspot" || d === "salesforce") {
      // Contacts are matched by email; attendees from consent responses are suggested.
      const known = responses
        .map((r) => r.email)
        .filter((e): e is string => !!e);
      setPrompt({
        title: `Log in ${PROVIDER_LABELS[d]}`,
        message:
          "Attendee emails, separated by commas. The meeting is logged on matching contacts.",
        initial: known.join(", "),
        placeholder: "name@client.com",
        okLabel: "Log meeting",
        onSubmit: (v) => run(v.split(/[\s,;]+/).filter((e) => e.includes("@"))),
      });
    } else await run();
  }

  function openMenu() {
    const rec = data?.recording;
    if (!rec) return;
    // Teammates can read and export a shared recording; only its creator can change it.
    const isOwner = !rec.user_id || rec.user_id === me;
    const actions: MenuAction[] = [
      {
        label: "Make a deck",
        section: "AI tools",
        onPress: () =>
          router.push({ pathname: "/deck", params: { recordingId: rec.id } }),
      },
      {
        label: "Draft a follow-up email",
        section: "AI tools",
        onPress: () =>
          router.push({ pathname: "/followup", params: { id: rec.id } }),
      },
      {
        label: translation ? "Show original language" : "Translate…",
        section: "AI tools",
        onPress: () => {
          if (translation) return setTranslation(null);
          setLangPicker(true);
        },
      },
      {
        label: "Share, email or export",
        section: "Share & export",
        onPress: () =>
          router.push({ pathname: "/share", params: { id: rec.id } }),
      },
    ];
    if (rec.has_video && data?.segments.some((sg) => sg.storage_path)) {
      actions.push({
        label: "Watch screen recording",
        section: "Share & export",
        onPress: () =>
          setMenu({
            title: "Screen recording",
            actions: data!.segments
              .filter((sg) => sg.storage_path)
              .map((sg, i, all) => ({
                label: all.length > 1 ? `Part ${i + 1}` : "Open video",
                onPress: guard(async () => {
                  const url = await audioUrl(sg.storage_path!);
                  if (url) await Linking.openURL(url);
                }),
              })),
          }),
      });
    }
    const dests = DESTINATIONS.filter((d) =>
      integrations.some((i) => i.provider === d),
    );
    if (rec.status === "ready") {
      actions.push({
        section: "Send",
        label: dests.length ? "Send notes to…" : "Send notes to Slack, Notion…",
        onPress: () =>
          dests.length
            ? setMenu({
                title: "Send notes to",
                actions: dests.map((d) => ({
                  label: PROVIDER_LABELS[d],
                  onPress: () => void sendNotes(rec.id, d),
                })),
              })
            : router.push("/integrations"),
      });
    }
    if (isOwner) {
      if (!isWeb)
        actions.push({
          section: "Attachments",
          label: "Take a photo",
          onPress: () => void addPhoto("camera"),
        });
      actions.push({
        section: "Attachments",
        label: "Add a photo from library",
        onPress: () => void addPhoto("library"),
      });
      actions.push(
        {
          section: "Organize",
          label: "Move to project",
          onPress: () => void chooseProject(),
        },
        {
          section: "Organize",
          label: "Re-run notes",
          onPress: guard(async () => {
            await retryProcessing(rec.id);
            await load();
          }),
        },
        {
          section: "Delete",
          label: "Delete recording",
          destructive: true,
          onPress: guard(async () => {
            const ok = await confirm(
              "Delete this recording?",
              "The audio, transcript, notes and tasks are deleted permanently.",
              "Delete",
              true,
            );
            if (!ok) return;
            await deleteRecording(rec.id);
            router.back();
          }),
        },
      );
    }
    setMenu({ title: rec.title, actions });
  }

  // Translated view: same structure, translated words (quotes and times stay as said).
  const shown: Data | null =
    data && translation
      ? {
          ...data,
          summary:
            data.summary && translation.summary
              ? {
                  ...data.summary,
                  overview:
                    translation.summary.overview ?? data.summary.overview,
                  key_points:
                    translation.summary.key_points ?? data.summary.key_points,
                  open_questions:
                    translation.summary.open_questions ??
                    data.summary.open_questions,
                  decisions: data.summary.decisions.map((d, i) => ({
                    ...d,
                    text: translation.summary!.decisions?.[i] ?? d.text,
                  })),
                }
              : data.summary,
          tasks: data.tasks.map((tk) => ({
            ...tk,
            text: translation.tasks?.[tk.id] ?? tk.text,
          })),
          transcript:
            data.transcript && translation.utterances
              ? {
                  ...data.transcript,
                  utterances: data.transcript.utterances.map((u, i) => ({
                    ...u,
                    text: translation.utterances![i] ?? u.text,
                  })),
                }
              : data.transcript,
        }
      : data;
  const rec = data?.recording;
  const reviewCount =
    data?.tasks.filter((x) => x.needs_review && x.status === "open").length ??
    0;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: "",
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              {/* A visible labeled Export: the action new users could never find
                  behind the icon-only overflow. It opens the share/export screen. */}
              <Pressable
                onPress={() =>
                  rec?.id &&
                  router.push({ pathname: "/share", params: { id: rec.id } })
                }
                accessibilityRole="button"
                accessibilityLabel="Export or share this recording"
                hitSlop={8}
                style={{ paddingHorizontal: 8, paddingVertical: 10 }}
              >
                <T size={15} weight="700" style={{ color: t.accent }}>
                  Export
                </T>
              </Pressable>
              <Pressable
                onPress={openMenu}
                accessibilityRole="button"
                accessibilityLabel="More actions"
                hitSlop={8}
                style={{ paddingHorizontal: 8, paddingVertical: 10, minHeight: 48, justifyContent: "center" }}
              >
                <T size={15} weight="700" style={{ color: t.accent }}>
                  More
                </T>
              </Pressable>
            </View>
          ),
        }}
      />
      {!data ? null : !rec ? (
        <Empty
          title="Waiting to upload"
          body="This recording hasn't reached the server yet. It will upload automatically when you're online."
        />
      ) : (
        <>
          <View
            style={{
              paddingHorizontal: space.lg,
              gap: space.sm,
              paddingBottom: space.md,
            }}
          >
            <TextInput
              value={title}
              editable={!rec.user_id || rec.user_id === me}
              onChangeText={setTitle}
              onEndEditing={() =>
                title.trim() &&
                title !== rec.title &&
                void renameRecording(rec.id, title.trim())
              }
              style={{ color: t.ink, fontSize: 24, fontWeight: "700" }}
              accessibilityLabel="Recording title"
              multiline
              blurOnSubmit
            />
            <T muted size={13}>
              {shortDate(rec.created_at)} · {TEMPLATE_LABELS[rec.template]}
              {rec.duration_ms ? ` · ${minutes(rec.duration_ms)}` : ""}
            </T>
            {rec.status !== "ready" && (
              <TourAnchor id="status-pill">
                <StatusPill status={rec.status} />
              </TourAnchor>
            )}
            {bot &&
              !["done", "cancelled"].includes(bot.status) &&
              rec.status !== "ready" && (
                <Banner
                  text={
                    bot.status === "scheduled"
                      ? `Notetaker will join${bot.join_at ? ` at ${new Date(bot.join_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : " shortly"}.`
                      : (bot.status_detail ??
                        `Notetaker: ${bot.status.replace(/_/g, " ")}`)
                  }
                  action={
                    rec.user_id === me
                      ? {
                          label:
                            bot.status === "scheduled"
                              ? "Cancel"
                              : "Make it leave",
                          onPress: () =>
                            void cancelBot(rec.id)
                              .then(load)
                              .catch((e) =>
                                notify("Couldn't cancel", (e as Error).message),
                              ),
                        }
                      : undefined
                  }
                />
              )}
            {rec.audio_deleted_at && (
              <T muted size={13}>
                Audio removed by your retention setting; transcript and notes
                kept.
              </T>
            )}
            {translating && (
              <T muted size={13}>
                Translating…
              </T>
            )}
            {translation && (
              <Banner
                text={`Showing in ${TRANSLATION_LANGUAGES.find((l) => l.code === translation.lang)?.name ?? translation.lang}. Quotes stay in the original words.`}
                action={{
                  label: "Original",
                  onPress: () => setTranslation(null),
                }}
              />
            )}
            {rec.status === "failed" && (
              <Banner
                text={rec.error ?? "Processing failed."}
                action={
                  rec.user_id === me
                    ? {
                        label: "Retry",
                        onPress: () => void retryProcessing(rec.id).then(load),
                      }
                    : undefined
                }
              />
            )}
            <TourAnchor id="detail-tabs">
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { key: "notes", label: "Notes" },
                { key: "transcript", label: "Transcript" },
                {
                  key: "tasks",
                  label: reviewCount
                    ? `Tasks (${reviewCount}!)`
                    : `Tasks${data.tasks.length ? ` (${data.tasks.length})` : ""}`,
                },
                 { key: "ask", label: "Ask" },
               ]}
             />
             </TourAnchor>
           </View>

          <View style={{ flex: 1 }}>
            {tab === "notes" && (
              <Notes
                data={shown!}
                playAt={playAt}
                onOpenPhoto={setViewing}
                procore={
                  procore?.config.target
                    ? { target: procore.config.target.name, onSend: sendLog }
                    : null
                }
                responses={responses}
                canEdit={isOwnerNow}
                onSaved={load}
                comments={comments}
                onComment={async (body) => {
                  await addComment(id, { kind: "comment", at_ms: null, body });
                  setComments(await listComments(id));
                }}
                onDeleteComment={async (c) => {
                  await deleteComment(c.id).catch((e) =>
                    notify("Couldn't delete", (e as Error).message),
                  );
                  setComments(await listComments(id));
                }}
                me={me}
              />
            )}
            {tab === "transcript" && (
              <TranscriptView
                data={shown!}
                playAt={playAt}
                onOpenPhoto={setViewing}
                onLineMenu={lineMenu}
                onSpeaker={renameSpeaker}
                focusMs={focusMs}
                marks={
                  new Set(
                    comments
                      .filter((c) => c.at_ms != null)
                      .map((c) => c.at_ms!),
                  )
                }
                positionMs={player.positionMs}
                following={following}
                onUserScroll={() => setFollowing(false)}
              />
            )}
            {tab === "tasks" && (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{
                  paddingHorizontal: space.lg,
                  paddingBottom: space.xxl,
                }}
              >
                {data.tasks.some(
                  (x) => x.status === "open" && !x.needs_review,
                ) && <SendToTracker tasks={data.tasks} onDone={load} />}
                {data.tasks.length === 0 ? (
                  <Empty
                    title={
                      rec.status === "ready"
                        ? "No action items"
                        : "Tasks appear when notes are ready"
                    }
                  />
                ) : (
                  data.tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={() =>
                        setTask(task, {
                          status: task.status === "done" ? "open" : "done",
                        })
                      }
                      onAccept={() =>
                        setTask(task, {
                          needs_review: false,
                          kind: "commitment",
                        })
                      }
                      onDismiss={() => setTask(task, { status: "dismissed" })}
                      onQuotePress={
                        task.quote_ms != null
                          ? () => playAt(task.quote_ms!)
                          : undefined
                      }
                    />
                  ))
                )}
              </ScrollView>
            )}
            {tab === "ask" && <AskView recordingId={rec.id} />}
          </View>
          <PhotoViewer
            photo={viewing}
            onClose={() => setViewing(null)}
            onPlay={data.segments.length ? playAt : undefined}
            canEdit={!rec.user_id || rec.user_id === me}
            onCaption={(p, c) =>
              void setPhotoCaption(p.id, c)
                .then(load)
                .catch((e) =>
                  notify("Couldn't save caption", (e as Error).message),
                )
            }
            onDelete={async (p) => {
              const ok = await confirm(
                "Delete this photo?",
                "It is removed from the recording and any reports made later.",
                "Delete",
                true,
              );
              if (!ok) return;
              setViewing(null);
              await deletePhoto(p).catch((e) =>
                notify("Couldn't delete", (e as Error).message),
              );
              await load();
            }}
          />
          <ActionMenu
            visible={!!menu}
            title={menu?.title}
            actions={menu?.actions ?? []}
            onClose={() => setMenu(null)}
          />
          <PromptModal prompt={prompt} onClose={() => setPrompt(null)} />
          <LanguagePickerSheet
            visible={langPicker}
            title="Translate notes and transcript into"
            onClose={() => setLangPicker(false)}
            onPick={(code) => {
              const recId = data?.recording?.id;
              if (!recId) return;
              guard(async () => {
                setTranslating(true);
                try {
                  setTranslation(await translateRecording(recId, code, true));
                } finally {
                  setTranslating(false);
                }
              })();
            }}
          />
          {data.segments.length > 0 && !rec.audio_deleted_at && (
            <PlayerBar
              playing={player.playing}
              positionMs={player.positionMs}
              durationMs={player.durationMs}
              speed={player.speed}
              speaker={
                player.speaker != null
                  ? speakerLabel(
                      player.speaker,
                      data?.transcript?.speaker_names ?? {},
                    )
                  : null
              }
              following={following}
              onToggle={() => {
                setFollowing(true);
                player.toggle();
              }}
              onSeek={(ms) => void player.seekToMs(ms, player.playing)}
              onSkip={(delta) => player.skip(delta)}
              onSpeed={player.changeSpeed}
              onToggleFollow={() => setFollowing((f) => !f)}
            />
          )}
        </>
      )}
    </View>
  );
}

function Notes({
  data,
  playAt,
  onOpenPhoto,
  procore,
  responses,
  canEdit,
  onSaved,
  comments,
  onComment,
  onDeleteComment,
  me,
}: {
  data: Data;
  playAt: (ms: number) => void;
  onOpenPhoto: (p: Photo) => void;
  procore: { target: string; onSend: () => void } | null;
  responses: ConsentResponse[];
  canEdit: boolean;
  onSaved: () => void;
  comments: Comment[];
  onComment: (body: string) => Promise<void>;
  onDeleteComment: (c: Comment) => Promise<void>;
  me: string | null;
}) {
  const t = useTheme();
  const s = data.summary;
  const [editing, setEditing] = useState<{
    overview: string;
    key_points: string;
    open_questions: string;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const field = {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface,
    color: t.ink,
    borderRadius: radius.md,
    padding: space.md,
    fontSize: 16,
    textAlignVertical: "top" as const,
  };

  async function saveEdits() {
    if (!editing || !data.recording) return;
    setSaving(true);
    try {
      const lines = (x: string) =>
        x
          .split("\n")
          .map((l) => l.replace(/^[-•*]\s*/, "").trim())
          .filter(Boolean);
      await updateSummary(data.recording.id, {
        overview: editing.overview.trim(),
        key_points: lines(editing.key_points),
        open_questions: lines(editing.open_questions),
      });
      setEditing(null);
      onSaved();
    } catch (e) {
      notify("Couldn't save", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const photos = data.photos;
  if (!s) {
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, gap: space.xl }}
      >
        {photos.length > 0 && (
          <Section title={`Photos (${photos.length})`}>
            <PhotoStrip photos={photos} onOpen={onOpenPhoto} />
          </Section>
        )}
        <Empty
          title="Writing your notes…"
          body="This usually takes a minute or two after you stop."
        />
      </ScrollView>
    );
  }
  const sentTo = s.site_log_external?.procore?.url;
  if (editing) {
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: space.lg,
          gap: space.md,
          paddingBottom: space.xxl,
        }}
      >
        <T muted size={13} weight="600">
          SUMMARY
        </T>
        <TextInput
          value={editing.overview}
          onChangeText={(v) => setEditing({ ...editing, overview: v })}
          multiline
          style={[field, { minHeight: 100 }]}
          accessibilityLabel="Summary"
        />
        <T muted size={13} weight="600">
          KEY POINTS (one per line)
        </T>
        <TextInput
          value={editing.key_points}
          onChangeText={(v) => setEditing({ ...editing, key_points: v })}
          multiline
          style={[field, { minHeight: 140 }]}
          accessibilityLabel="Key points"
        />
        <T muted size={13} weight="600">
          OPEN QUESTIONS (one per line)
        </T>
        <TextInput
          value={editing.open_questions}
          onChangeText={(v) => setEditing({ ...editing, open_questions: v })}
          multiline
          style={[field, { minHeight: 80 }]}
          accessibilityLabel="Open questions"
        />
        <T muted size={12}>
          Decisions and tasks keep their quotes; edit tasks on the Tasks tab.
        </T>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button
            label="Cancel"
            kind="secondary"
            onPress={() => setEditing(null)}
            style={{ flex: 1 }}
          />
          <Button
            label="Save"
            onPress={saveEdits}
            loading={saving}
            style={{ flex: 1 }}
          />
        </View>
      </ScrollView>
    );
  }
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        padding: space.lg,
        gap: space.xl,
        paddingBottom: space.xxl,
      }}
    >
      {canEdit && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "flex-end",
            marginBottom: -space.md,
          }}
        >
          <Button
            label="Edit notes"
            kind="ghost"
            onPress={() =>
              setEditing({
                overview: s.overview ?? "",
                key_points: (s.key_points ?? []).join("\n"),
                open_questions: (s.open_questions ?? []).join("\n"),
              })
            }
          />
        </View>
      )}
      {!!s.overview && <T size={17}>{s.overview}</T>}
      {!!data.recording?.user_notes && (
        <Section title="Your notes">
          <T size={15}>{data.recording.user_notes}</T>
        </Section>
      )}
      {photos.length > 0 && (
        <Section title={`Photos (${photos.length})`}>
          <PhotoStrip photos={photos} onOpen={onOpenPhoto} />
        </Section>
      )}
      {s.site_log && (
        <Section title="Daily site log">
          <SiteLogView
            log={s.site_log}
            photos={photos}
            playAt={playAt}
            onOpenPhoto={onOpenPhoto}
          />
          {sentTo ? (
            <Button
              label="Open in Procore daily log â†—"
              kind="ghost"
              onPress={() => void Linking.openURL(sentTo)}
            />
          ) : procore ? (
            <Button
              label={`Add to ${procore.target} daily log`}
              kind="secondary"
              onPress={procore.onSend}
            />
          ) : null}
        </Section>
      )}
      {s.key_points.length > 0 && (
        <Section title="Key points">
          {s.key_points.map((p, i) => {
            const detail = (s.key_point_details ?? []).find(
              (d) => d.text === p,
            );
            const ms = detail?.verified ? detail.quote_ms : null;
            return (
              <View
                key={i}
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: space.xs,
                }}
              >
                <T style={{ flex: 1 }}>• {p}</T>
                {ms != null ? (
                  <TimestampChip ms={ms} onPress={() => playAt(ms)} />
                ) : null}
              </View>
            );
          })}
        </Section>
      )}
      {s.decisions.length > 0 && (
        <Section title="Decisions">
          {s.decisions.map((d, i) => {
            // Only a quote found in the transcript gets a chip; an unverified one
            // has no trustworthy moment to play.
            const ms = d.verified ? d.quote_ms : null;
            return (
              <Card key={i} style={{ gap: 4 }}>
                <T weight="600">{d.text}</T>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: space.xs,
                  }}
                >
                  <Pressable
                    disabled={d.quote_ms == null}
                    onPress={() => d.quote_ms != null && playAt(d.quote_ms)}
                    style={{ flex: 1 }}
                  >
                    <T muted size={13} style={{ fontStyle: "italic" }}>
                      “{d.quote}”
                      {d.verified ? "" : "  (not found in transcript)"}
                    </T>
                  </Pressable>
                  {ms != null ? (
                    <TimestampChip ms={ms} onPress={() => playAt(ms)} />
                  ) : null}
                </View>
              </Card>
            );
          })}
        </Section>
      )}
      {(s.task_updates ?? []).length > 0 && (
        <Section title="Earlier tasks discussed">
          {(s.task_updates ?? []).map((u, i) => {
            const ms = u.verified ? u.quote_ms : null;
            return (
              <Card key={i} style={{ gap: 4 }}>
                <T weight="600">
                  {u.status === "done"
                    ? "âœ“ Done: "
                    : u.status === "blocked"
                      ? "Blocked: "
                      : "In progress: "}
                  {u.text}
                </T>
                {u.note ? <T size={14}>{u.note}</T> : null}
                {u.quote ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: space.xs,
                    }}
                  >
                    <Pressable
                      disabled={u.quote_ms == null}
                      onPress={() => u.quote_ms != null && playAt(u.quote_ms)}
                      style={{ flex: 1 }}
                    >
                      <T muted size={13} style={{ fontStyle: "italic" }}>
                        “{u.quote}”
                        {u.verified
                          ? ""
                          : "  (not found in transcript, task left open)"}
                      </T>
                    </Pressable>
                    {ms != null ? (
                      <TimestampChip ms={ms} onPress={() => playAt(ms)} />
                    ) : null}
                  </View>
                ) : null}
              </Card>
            );
          })}
        </Section>
      )}
      {s.open_questions.length > 0 && (
        <Section title="Open questions">
          {s.open_questions.map((q, i) => (
            <T key={i}>• {q}</T>
          ))}
        </Section>
      )}
      <Section
        title={`Comments${comments.length ? ` (${comments.length})` : ""}`}
      >
        {comments.map((c) => (
          <View
            key={c.id}
            style={{ gap: 2, flexDirection: "row", alignItems: "flex-start" }}
          >
            <Pressable
              style={{ flex: 1 }}
              disabled={c.at_ms == null}
              onPress={() => c.at_ms != null && playAt(c.at_ms)}
            >
              <T size={14}>
                <T size={14} weight="600">
                  {c.kind === "bookmark" ? "â˜… " : ""}
                  {c.author_email?.split("@")[0] ?? "Someone"}
                </T>
                {c.at_ms != null ? (
                  <T muted size={12}>{`  ${clock(c.at_ms)}`}</T>
                ) : null}
              </T>
              {!!c.body && <T size={14}>{c.body}</T>}
            </Pressable>
            {(c.user_id === me || canEdit) && (
              <Pressable
                onPress={() => void onDeleteComment(c)}
                accessibilityLabel="Delete comment"
                hitSlop={8}
              >
                <T muted size={13}>
                  âœ•
                </T>
              </Pressable>
            )}
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a comment"
            placeholderTextColor={t.muted}
            style={[field, { flex: 1, paddingVertical: space.sm }]}
            accessibilityLabel="Add a comment"
          />
          <Button
            label="Post"
            kind="secondary"
            disabled={!draft.trim()}
            onPress={() =>
              void onComment(draft.trim()).then(() => setDraft(""))
            }
          />
        </View>
        <T muted size={12}>
          Press and hold a transcript line to bookmark or comment on that
          moment.
        </T>
      </Section>
      {responses.length > 0 && (
        <Section title={`Consent link answers (${responses.length})`}>
          {responses.map((r) => (
            <T
              key={r.id}
              size={14}
              style={{ color: r.decision === "decline" ? t.danger : t.ink }}
            >
              {r.decision === "agree" ? "âœ“ " : "âœ• "}
              {r.name}
              {r.email ? ` (${r.email})` : ""}{" "}
              {r.decision === "agree" ? "agreed" : "did not agree"}
            </T>
          ))}
          {responses.some((r) => r.decision === "decline") && (
            <T muted size={13}>
              Someone didn’t agree. Consider deleting their parts or the
              recording, and check the law where they are.
            </T>
          )}
        </Section>
      )}
      {data.recording?.consent_method && (
        <T muted size={12}>
          Recording notice: {CONSENT_LABELS[data.recording.consent_method]}
          {data.recording.consent_confirmed_at
            ? ` (${new Date(data.recording.consent_confirmed_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })})`
            : ""}
        </T>
      )}
      <T muted size={12} style={{ color: t.muted }}>
        AI-generated from the transcript. Check important details against the
        audio.
      </T>
    </ScrollView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <T muted size={13} weight="600">
        {title.toUpperCase()}
      </T>
      {children}
    </View>
  );
}

type Line =
  | {
      kind: "u";
      u: NonNullable<Data["transcript"]>["utterances"][number];
      prevSpeaker: number | null;
      idx: number;
    }
  | { kind: "p"; photos: Photo[] };

/** Utterances with the photos taken during them slotted in at the right moment. */
function withPhotos(
  u: NonNullable<Data["transcript"]>["utterances"],
  photos: Photo[],
): Line[] {
  const timed = photos
    .filter((p) => p.taken_ms != null)
    .sort((a, b) => a.taken_ms! - b.taken_ms!);
  const out: Line[] = [];
  let j = 0;
  let prev: number | null = null;
  for (const [idx, item] of u.entries()) {
    const group: Photo[] = [];
    while (j < timed.length && timed[j].taken_ms! < item.start_ms)
      group.push(timed[j++]);
    if (group.length) {
      out.push({ kind: "p", photos: group });
      prev = null; // repeat the speaker label after a photo
    }
    out.push({ kind: "u", u: item, prevSpeaker: prev, idx });
    prev = item.speaker;
  }
  if (j < timed.length) out.push({ kind: "p", photos: timed.slice(j) });
  return out;
}

function TranscriptView({
  data,
  playAt,
  onOpenPhoto,
  onLineMenu,
  onSpeaker,
  focusMs,
  marks,
  positionMs,
  following,
  onUserScroll,
}: {
  data: Data;
  playAt: (ms: number) => void;
  onOpenPhoto: (p: Photo) => void;
  onLineMenu: (index: number) => void;
  onSpeaker: (speaker: number) => void;
  focusMs: number | null;
  marks: Set<number>;
  positionMs: number;
  following: boolean;
  onUserScroll: () => void;
}) {
  const t = useTheme();
  const u = data.transcript?.utterances ?? [];
  const names = data.transcript?.speaker_names ?? {};
  const lines = withPhotos(u, data.photos);
  // The line containing the moment we were sent to (from search).
  const focusLine =
    focusMs == null
      ? -1
      : lines.findIndex(
          (l) =>
            l.kind === "u" &&
            l.u.start_ms <= focusMs &&
            l.u.end_ms >= focusMs - 1000,
        );
  // The line being spoken right now.
  const activeLine = useMemo(() => {
    if (positionMs <= 0) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.kind !== "u") continue;
      if (line.u.start_ms <= positionMs + 250) idx = i;
      else break;
    }
    return idx;
  }, [lines, positionMs]);
  const list = useRef<FlatList<Line>>(null);

  // Follow the audio: keep the line being spoken in view.
  useEffect(() => {
    if (!following || activeLine < 0) return;
    try {
      list.current?.scrollToIndex({
        index: activeLine,
        animated: true,
        viewPosition: 0.3,
      });
    } catch {
      // The line is not measured yet; the next update catches up.
    }
  }, [activeLine, following]);

  if (!u.length) return <Empty title="No transcript yet" />;
  return (
    <FlatList
      ref={list}
      style={{ flex: 1 }}
      data={lines}
      initialScrollIndex={focusLine > 0 ? focusLine : undefined}
      onScrollBeginDrag={onUserScroll}
      onScrollToIndexFailed={(info) => {
        // Lines have different heights, so an off-screen index cannot be measured: guess.
        list.current?.scrollToOffset({
          offset: info.index * 56,
          animated: true,
        });
      }}
      keyExtractor={(_, i) => String(i)}
      contentContainerStyle={{
        paddingHorizontal: space.lg,
        paddingBottom: space.xxl,
      }}
      renderItem={({ item: line }) => {
        if (line.kind === "p") {
          return (
            <View style={{ paddingVertical: space.sm }}>
              <PhotoStrip photos={line.photos} onOpen={onOpenPhoto} size={88} />
            </View>
          );
        }
        const item = line.u;
        const sameSpeaker = line.prevSpeaker === item.speaker;
        const focused = lines[focusLine] === line;
        const active = lines[activeLine] === line;
        return (
          <Pressable
            onPress={() => playAt(item.start_ms)}
            onLongPress={() => onLineMenu(line.idx)}
            accessibilityHint="Plays audio from here. Press and hold for more."
            style={{
              paddingVertical: 6,
              backgroundColor: active || focused ? t.accentSoft : "transparent",
              borderRadius: radius.sm,
              paddingHorizontal: active || focused ? space.sm : 0,
              borderLeftWidth: active ? 3 : 0,
              borderLeftColor: t.accent,
            }}
          >
            {!sameSpeaker && (
              <T
                size={13}
                weight="700"
                style={{ color: t.accent, marginTop: space.sm }}
              >
                <T size={13} weight="700" style={{ color: t.accent }}>
                  <Text
                    onPress={() => onSpeaker(item.speaker)}
                    accessibilityRole="button"
                    accessibilityHint="Rename this speaker"
                  >
                    {speakerLabel(item.speaker, names)}
                  </Text>
                </T>
                {"  "}
                <T muted size={12}>
                  {clock(item.start_ms)}
                </T>
              </T>
            )}
            {marks.has(item.start_ms) && (
              <TimestampChip ms={item.start_ms} onPress={() => playAt(item.start_ms)} />
            )}
            <T>
              {marks.has(item.start_ms) ? "â˜… " : ""}
              {item.text}
            </T>
          </Pressable>
        );
      }}
    />
  );
}

function AskView({ recordingId }: { recordingId: string }) {
  const t = useTheme();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);

  async function send() {
    const question = q.trim();
    if (!question) return;
    setBusy(true);
    setQ("");
    try {
      const res = await ask(question, recordingId);
      setHistory((h) => [...h, { q: question, a: res.answer }]);
    } catch (e) {
      setHistory((h) => [
        ...h,
        { q: question, a: `Sorry, that didn't work: ${(e as Error).message}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={100}
    >
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        {history.length === 0 && (
          <T muted>
            Ask anything about this recording, e.g. “What did we agree on
            pricing?”
          </T>
        )}
        {history.map((h, i) => (
          <View key={i} style={{ gap: space.sm }}>
            <T weight="600">{h.q}</T>
            <T>{h.a}</T>
          </View>
        ))}
      </ScrollView>
      <View
        style={[
          styles.askBar,
          { borderTopColor: t.border, backgroundColor: t.bg },
        ]}
      >
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Ask about this recording"
          placeholderTextColor={t.muted}
          onSubmitEditing={send}
          returnKeyType="send"
          style={[
            styles.askInput,
            { borderColor: t.border, backgroundColor: t.surface, color: t.ink },
          ]}
          accessibilityLabel="Question"
        />
        <Button
          label="Ask"
          onPress={send}
          loading={busy}
          disabled={!q.trim()}
          style={{ minHeight: 44 }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  askBar: {
    flexDirection: "row",
    gap: space.sm,
    padding: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  askInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: 16,
    minHeight: 44,
  },
});
