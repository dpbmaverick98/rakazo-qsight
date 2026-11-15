import { useLingui } from "@lingui/react/macro";
import { Stack, useNavigation, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, Text, TextInput } from "react-native";
import { NativeActionButton } from "../components/native-action-button";
import { cancelHeaderOptions } from "../components/sheet-header";
import { selectSpace } from "../lib/api-server";
import { setupClient } from "../lib/client-setup";
import { hapticSuccess } from "../lib/haptics";
import { native, useMobileTokens } from "../lib/native";
import { refreshOrganizations } from "../lib/organizations";
import { useSave } from "../lib/query";
import { isSearchInboxSession, searchInboxSession } from "../lib/search-inbox";
import { useSideInsets } from "../lib/side-insets";
import { errorText } from "../lib/user-error";

export default function NewSpace() {
  const sideInsets = useSideInsets();
  const { t } = useLingui();
  const tokens = useMobileTokens();
  const router = useRouter();
  const navigation = useNavigation();
  const [name, setName] = useState("");
  const save = useSave({
    save: async (value: string) => {
      const askedIn = searchInboxSession();
      const result = await setupClient(value);
      return { result, askedIn };
    },
    onSaved: async ({ result, askedIn }) => {
      if (!navigation.isFocused() || !isSearchInboxSession(askedIn)) return;
      hapticSuccess();
      void refreshOrganizations();
      if (!(await selectSpace(result.spaceId))) {
        Alert.alert(t`Client created`, t`It could not be opened. Try again from the sidebar.`);
        router.dismissAll();
        router.replace("/");
        return;
      }
      if (!navigation.isFocused() || !isSearchInboxSession(askedIn)) return;
      router.dismissAll();
      router.replace({
        pathname: "/client-setup",
        params: { spaceId: result.spaceId, status: result.status },
      });
    },
  });
  const pending = save.pending;
  const error = save.error
    ? errorText(save.error, t`Could not finish client setup. Try again.`)
    : null;
  function create() {
    if (name.trim() && !pending) save.run(name.trim());
  }

  return (
    <>
      <Stack.Screen options={cancelHeaderOptions(t`Cancel`, () => router.back())} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={[{ flex: 1, backgroundColor: tokens.background }, sideInsets]}
        contentContainerStyle={{ padding: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>{t`Client name`}</Text>
        <TextInput
          accessibilityLabel={t`Client name`}
          editable={!pending}
          autoFocus
          value={name}
          maxLength={60}
          onChangeText={(value) => {
            setName(value);
            save.reset();
          }}
          onSubmitEditing={() => void create()}
          placeholder={t`Client name`}
          placeholderTextColor={tokens.mutedForeground}
          returnKeyType="done"
          style={{
            marginTop: 8,
            backgroundColor: native.fill,
            borderRadius: 11,
            padding: 14,
            color: tokens.foreground,
            fontSize: 16,
          }}
        />
        {error ? (
          <Text accessibilityRole="alert" style={{ color: tokens.destructive, marginTop: 14 }}>
            {error}
          </Text>
        ) : null}
        <NativeActionButton
          disabled={!name.trim() || pending}
          label={pending ? t`Setting up…` : t`Add client`}
          onPress={() => void create()}
          style={{ marginTop: 20 }}
        />
      </ScrollView>
    </>
  );
}
