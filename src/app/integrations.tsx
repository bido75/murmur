import * as ExpoLinking from "expo-linking";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, ScrollView, TextInput, View } from "react-native";
import { ActionMenu } from "@/components/ActionMenu";
import { Button, Card, T } from "@/components/ui";
import {
  connectAvailable,
  connectIntegration,
  disconnectIntegration,
  integrationTargets,
  listIntegrations,
  procoreAvailable,
  setIntegrationTarget,
  startConnect,
  startProcoreConnect,
  type OAuthConn,
} from "@/lib/api";
import { confirm, isWeb, notify } from "@/lib/dialog";
import { radius, space, useTheme } from "@/lib/theme";
import { PROVIDER_LABELS, type ConnKey, type Integration } from "@/lib/types";

type TokenConn =
  | "linear"
  | "asana"
  | "jira"
  | "monday"
  | "clickup"
  | "trello"
  | "hubspot"
  | "notion";
type Kind = TokenConn | OAuthConn | "procore";

/** Where to make a token, and what the card says the connection does. */
const HELP: Record<TokenConn, { where: string; url: string }> = {
  linear: {
    where: "Linear → Settings → Security & access → Personal API keys",
    url: "https://linear.app/settings/account/security",
  },
  asana: {
    where: "Asana developer console → Personal access tokens",
    url: "https://app.asana.com/0/my-apps",
  },
  jira: {
    where: "Atlassian account → Security → API tokens",
    url: "https://id.atlassian.com/manage-profile/security/api-tokens",
  },
  monday: {
    where: "monday.com → your picture → Developers → My access tokens",
    url: "https://monday.com/developers/apps",
  },
  clickup: {
    where: "ClickUp → Settings → Apps → API token",
    url: "https://app.clickup.com/settings/apps",
  },
  trello: {
    where:
      "Trello Power-Up admin → your Power-Up → API key, then “Token” next to it",
    url: "https://trello.com/power-ups/admin",
  },
  hubspot: {
    where:
      "HubSpot → Development → Legacy apps → Create legacy app → Private (give it contacts read, notes and tasks write; copy the access token on the Auth tab)",
    url: "https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview",
  },
  notion: {
    where:
      "Notion → Settings → Connections → Develop or manage integrations (internal). Then open the page notes should go under → ••• → Connections → add it",
    url: "https://www.notion.so/profile/integrations",
  },
};

const ABOUT: Partial<Record<Kind, string>> = {
  procore:
    "Tasks become punch items (with the photo taken when they were said). Site walks can add their daily log to the project’s Daily Log.",
  slack:
    "Post a summary with next steps to one channel you choose — by hand from a recording, or automatically.",
  notion:
    "Each recording becomes a page under the page you choose, with tasks as to-dos.",
  google_docs:
    "Notes become a Google Doc in your Drive. Murmur can only see files it creates.",
  onenote:
    "Notes become a page in your default OneNote notebook, with tasks as to-do tags.",
  hubspot:
    "Log meetings as notes on contacts (found by attendee email) and send tasks as HubSpot tasks.",
  salesforce:
    "Log meetings as completed activities on the matching contact or lead, and send tasks as Salesforce tasks.",
};

const TARGET_WORD: Partial<Record<Kind, string>> = {
  linear: "team",
  monday: "board",
  clickup: "list",
  trello: "list",
  notion: "page",
};

const TRACKER_KINDS: TokenConn[] = [
  "linear",
  "asana",
  "jira",
  "monday",
  "clickup",
  "trello",
];
const NOTE_KINDS: Kind[] = ["slack", "notion", "google_docs", "onenote"];
const CRM_KINDS: Kind[] = ["hubspot", "salesforce"];
const OAUTH: OAuthConn[] = ["slack", "salesforce", "google_docs", "onenote"];
const isOAuth = (k: Kind): k is OAuthConn => (OAUTH as string[]).includes(k);
const label = (k: Kind) => PROVIDER_LABELS[k as ConnKey];

function returnUrl() {
  return isWeb
    ? `${window.location.origin}/integrations`
    : ExpoLinking.createURL("integrations");
}

export default function Integrations() {
  const [items, setItems] = useState<Integration[]>([]);
  const [hasProcore, setHasProcore] = useState(false);
  const [signIns, setSignIns] = useState<OAuthConn[]>([]);
  const params = useLocalSearchParams<{
    procore?: string;
    connected?: string;
  }>();

  const load = useCallback(async () => {
    try {
      setItems(await listIntegrations());
    } catch (e) {
      notify("Couldn't load connections", (e as Error).message);
    }
  }, []);

  useEffect(() => {
    listIntegrations()
      .then(setItems)
      .catch((e) => notify("Couldn't load connections", (e as Error).message));
    procoreAvailable().then(setHasProcore);
    connectAvailable().then(setSignIns);
  }, []);

  // Back from a provider's sign-in page.
  useEffect(() => {
    if (params.procore === "connected")
      notify(
        "Procore connected",
        "Now choose which Procore project punch items and daily logs go to.",
      );
    if (params.procore === "failed")
      notify(
        "Couldn't connect Procore",
        "Please try again. If it keeps failing, check the app is installed for your Procore company.",
      );
  }, [params.procore]);
  useEffect(() => {
    if (!params.connected) return;
    const [p, status] = params.connected.split(":");
    const name = PROVIDER_LABELS[p as ConnKey] ?? "The app";
    if (status === "ok")
      notify(
        `${name} connected`,
        p === "slack"
          ? "Notes can now be posted to the channel you picked."
          : undefined,
      );
    else if (status === "failed")
      notify(`Couldn't connect ${name}`, "Please try again.");
  }, [params.connected]);

  const find = (k: Kind) => items.find((i) => i.provider === k);
  const show = (k: Kind) =>
    !!find(k) ||
    (k === "procore" ? hasProcore : isOAuth(k) ? signIns.includes(k) : true);
  const card = (k: Kind) =>
    show(k) ? (
      <ConnCard key={k} kind={k} integration={find(k)} onChange={load} />
    ) : null;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <T muted>
        Tokens and sign-ins are stored on the server and never shown again in
        the app. Only tasks you’ve confirmed are sent, each with the quote it
        came from.
      </T>
      <T size={20} weight="700">
        Task trackers
      </T>
      {card("procore")}
      {TRACKER_KINDS.map(card)}
      <T size={20} weight="700">
        Send notes to
      </T>
      {NOTE_KINDS.map(card)}
      <T size={20} weight="700">
        CRM
      </T>
      {CRM_KINDS.map(card)}
    </ScrollView>
  );
}

function ConnCard({
  kind,
  integration,
  onChange,
}: {
  kind: Kind;
  integration?: Integration;
  onChange: () => void;
}) {
  const t = useTheme();
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [site, setSite] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<{ id: string; name: string }[] | null>(
    null,
  );
  const [open, setOpen] = useState(false); // token form stays folded until asked for

  const input = {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface,
    color: t.ink,
    borderRadius: radius.md,
    padding: space.md,
    fontSize: 16,
  } as const;
  const word = TARGET_WORD[kind] ?? "project";
  // HubSpot, Salesforce, Slack (channel picked at sign-in), Google Docs and OneNote need no destination here.
  const needsTarget = ![
    "hubspot",
    "salesforce",
    "slack",
    "google_docs",
    "onenote",
  ].includes(kind);

  async function connect() {
    setBusy(true);
    try {
      const extra =
        kind === "jira"
          ? { email: email.trim(), site: site.trim() }
          : kind === "trello"
            ? { key: key.trim() }
            : {};
      await connectIntegration(kind as ConnKey, token.trim(), extra);
      setToken("");
      setKey("");
      onChange();
      if (needsTarget) await pickTarget();
    } catch (e) {
      notify(`Couldn't connect ${label(kind)}`, (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pickTarget() {
    setBusy(true);
    try {
      const list = await integrationTargets(kind as ConnKey);
      if (!list.length) {
        notify(
          "Nothing to choose",
          kind === "notion"
            ? "No pages are shared with this integration yet. In Notion, open a page → ••• → Connections → add your integration."
            : `No ${word}s were found for this account.`,
        );
      } else setTargets(list);
    } catch (e) {
      notify("Couldn't load destinations", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function signIn() {
    setBusy(true);
    try {
      const url =
        kind === "procore"
          ? await startProcoreConnect(returnUrl())
          : await startConnect(kind as OAuthConn, returnUrl());
      if (isWeb) window.location.assign(url);
      else await Linking.openURL(url);
    } catch (e) {
      notify(`Couldn't start ${label(kind)} sign-in`, (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const ok = await confirm(
      `Disconnect ${label(kind)}?`,
      "The saved connection is deleted. Anything already sent stays where it is.",
      "Disconnect",
      true,
    );
    if (!ok) return;
    await disconnectIntegration(kind as ConnKey).catch((e) =>
      notify("Couldn't disconnect", (e as Error).message),
    );
    onChange();
  }

  const destLine =
    kind === "slack"
      ? "Posts to"
      : kind === "notion"
        ? "Pages go under"
        : needsTarget
          ? "Tasks go to"
          : null;

  return (
    <Card style={{ gap: space.md }}>
      <T size={18} weight="700">
        {label(kind)}
      </T>
      {ABOUT[kind] && (
        <T muted size={14}>
          {ABOUT[kind]}
        </T>
      )}
      {integration ? (
        <>
          <T muted size={14}>
            Connected
            {integration.config.account
              ? ` as ${integration.config.account}`
              : ""}
          </T>
          {destLine && (
            <T size={15}>
              {destLine}:{" "}
              <T size={15} weight="600">
                {integration.config.target?.name ?? "not chosen yet"}
              </T>
            </T>
          )}
          <View style={{ flexDirection: "row", gap: space.sm }}>
            {needsTarget && (
              <Button
                label={integration.config.target ? "Change" : `Choose ${word}`}
                kind="secondary"
                loading={busy}
                onPress={pickTarget}
                style={{ flex: 1 }}
              />
            )}
            {kind === "slack" && (
              <Button
                label="Change channel"
                kind="secondary"
                loading={busy}
                onPress={signIn}
                style={{ flex: 1 }}
              />
            )}
            <Button
              label="Disconnect"
              kind="ghost"
              onPress={disconnect}
              style={{ flex: 1 }}
            />
          </View>
        </>
      ) : kind === "procore" || isOAuth(kind) ? (
        <Button
          label={`Connect with ${label(kind)}`}
          onPress={signIn}
          loading={busy}
        />
      ) : !open ? (
        <Button
          label={`Connect ${label(kind)}`}
          kind="secondary"
          onPress={() => setOpen(true)}
        />
      ) : (
        <>
          <T muted size={14}>
            Create a token in {HELP[kind].where}.
          </T>
          <Button
            label={`Open ${label(kind)} token page`}
            kind="ghost"
            onPress={() => void Linking.openURL(HELP[kind].url)}
          />
          {kind === "jira" && (
            <>
              <TextInput
                value={site}
                onChangeText={setSite}
                placeholder="yourcompany.atlassian.net"
                placeholderTextColor={t.muted}
                autoCapitalize="none"
                style={input}
                accessibilityLabel="Jira site"
              />
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Email for that Atlassian account"
                placeholderTextColor={t.muted}
                autoCapitalize="none"
                keyboardType="email-address"
                style={input}
                accessibilityLabel="Atlassian email"
              />
            </>
          )}
          {kind === "trello" && (
            <TextInput
              value={key}
              onChangeText={setKey}
              placeholder="API key"
              placeholderTextColor={t.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={input}
              accessibilityLabel="Trello API key"
            />
          )}
          <TextInput
            value={token}
            onChangeText={setToken}
            placeholder="Paste token"
            placeholderTextColor={t.muted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={input}
            accessibilityLabel={`${label(kind)} token`}
          />
          <Button
            label="Connect"
            onPress={connect}
            loading={busy}
            disabled={
              !token.trim() ||
              (kind === "jira" && (!email.includes("@") || !site.trim())) ||
              (kind === "trello" && !key.trim())
            }
          />
        </>
      )}
      <ActionMenu
        visible={!!targets}
        title={
          kind === "notion"
            ? "Put notes under which page?"
            : kind === "procore"
              ? "Which Procore project?"
              : `Send tasks to which ${word}?`
        }
        onClose={() => setTargets(null)}
        actions={(targets ?? []).map((tg) => ({
          label: tg.name,
          onPress: () =>
            void setIntegrationTarget(kind as ConnKey, tg)
              .then(onChange)
              .catch((e) => notify("Couldn't save", (e as Error).message)),
        }))}
      />
    </Card>
  );
}
