import { useLingui } from "@lingui/react/macro";
import { Stack, useIsFocused, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text } from "react-native";
import { NativeActionButton } from "../components/native-action-button";
import { SettingsGroup, SettingsRow } from "../components/settings-group";
import { cancelHeaderOptions } from "../components/sheet-header";
import { selectedSpaceId } from "../lib/api";
import { selectSpace } from "../lib/api-server";
import { clientNavigationQuery, setupClient } from "../lib/client-setup";
import { useMobileTokens } from "../lib/native";
import { useSave } from "../lib/query";
import { useRosterSignals } from "../lib/roster-signals";
import { useScreenQuery } from "../lib/screen-query";
import { isSearchInboxSession, searchInboxSession } from "../lib/search-inbox";
import { useSideInsets } from "../lib/side-insets";
import { errorText } from "../lib/user-error";

/** Native fallback until building/project navigation is available. IDs come only from the server. */
export default function ClientSetupScreen() {
  const { spaceId: targetSpaceId, status } = useLocalSearchParams<{
    spaceId?: string;
    status?: string;
  }>();
  const spaceId = targetSpaceId ?? selectedSpaceId() ?? "";
  const { t } = useLingui();
  const tokens = useMobileTokens();
  const sideInsets = useSideInsets();
  const router = useRouter();
  const focused = useIsFocused();
  const screen = useNavigation();
  const [selectionReady, setSelectionReady] = useState(selectedSpaceId() === spaceId);
  const [selectionError, setSelectionError] = useState<Error | null>(null);
  const [selectionAttempt, setSelectionAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    const session = searchInboxSession();
    setSelectionReady(false);
    setSelectionError(null);
    if (!spaceId) {
      setSelectionError(new Error(t`Client setup unavailable`));
      return;
    }
    void selectSpace(spaceId).then(
      (ok) => {
        if (!current || !isSearchInboxSession(session)) return;
        if (ok) setSelectionReady(true);
        else setSelectionError(new Error(t`Could not switch spaces`));
      },
      (error) => {
        if (current && isSearchInboxSession(session))
          setSelectionError(new Error(errorText(error)));
      },
    );
    return () => {
      current = false;
    };
  }, [spaceId, selectionAttempt, t]);
  const read = clientNavigationQuery(spaceId);
  const navigation = useScreenQuery(read, { enabled: !!spaceId && selectionReady });
  useRosterSignals(
    () => navigation.refetch({ cancelRefetch: false }),
    focused && !!spaceId && selectionReady,
  );
  const data = navigation.data;
  const [setupStatus, setSetupStatus] = useState(status);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<Error | null>(null);
  async function openBot(botId: string) {
    if (opening) return;
    setOpening(true);
    setOpenError(null);
    const session = searchInboxSession();
    try {
      if (!(await selectSpace(spaceId))) throw new Error(t`Could not switch spaces`);
      if (!screen.isFocused() || !isSearchInboxSession(session)) return;
      router.push({ pathname: "/thread", params: { botId, name: "PM" } });
    } catch (error) {
      setOpenError(new Error(errorText(error)));
    } finally {
      setOpening(false);
    }
  }
  const resume = useSave({
    save: () => setupClient(data!.client.name, spaceId),
    stale: [read.queryKey],
    onSaved: (result) => setSetupStatus(result.status),
  });
  const bots = data
    ? [
        ...data.setupBotIds.map((id) => ({ id, detail: undefined })),
        ...data.buildings.flatMap((building) =>
          building.projects.flatMap((project) =>
            project.botIds.map((id) => ({ id, detail: `${building.name} / ${project.name}` })),
          ),
        ),
      ]
    : [];
  const error = selectionError ?? navigation.error ?? openError ?? resume.error;
  const missing = setupStatus === "mcp_missing" && Boolean(data?.setupBotIds.length);
  return (
    <>
      <Stack.Screen
        options={{
          title: t`Continue setup`,
          ...cancelHeaderOptions(t`Close`, () =>
            router.canGoBack() ? router.back() : router.replace("/"),
          ),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={[{ flex: 1, backgroundColor: tokens.background }, sideInsets]}
        contentContainerStyle={{ padding: 24, gap: 16 }}
      >
        {navigation.isPending && !selectionError ? (
          <ActivityIndicator accessibilityLabel={t`Loading client…`} />
        ) : null}
        {data ? (
          <Text style={{ color: tokens.foreground, fontSize: 20 }}>{data.client.name}</Text>
        ) : null}
        {missing ? (
          <Text
            style={{ color: tokens.mutedForeground }}
          >{t`Connect your setup tools in Settings, then retry.`}</Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={{ color: tokens.destructive }}>
            {errorText(error, t`Client setup unavailable`)}
          </Text>
        ) : null}
        {navigation.isError || selectionError ? (
          <NativeActionButton
            label={t`Retry`}
            onPress={() =>
              selectionError ? setSelectionAttempt((value) => value + 1) : void navigation.refetch()
            }
          />
        ) : null}
        <SettingsGroup>
          {bots.map((bot) => (
            <SettingsRow
              key={bot.id}
              title={t`Open PM`}
              detail={bot.detail}
              chevron="right"
              onPress={() => void openBot(bot.id)}
              disabled={opening}
            />
          ))}
          {setupStatus !== "ready" && data?.setupBotIds.length ? (
            <SettingsRow
              title={t`Retry setup`}
              onPress={() => resume.run()}
              disabled={resume.pending}
            />
          ) : null}
          <SettingsRow
            title={t`Archived chats`}
            chevron="right"
            onPress={() => router.push("/archived-bots")}
          />
        </SettingsGroup>
      </ScrollView>
    </>
  );
}
