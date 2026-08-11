import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing } from "@/src/theme";
import { Avatar, Loading } from "@/src/components/ui";

export default function NewChatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [cleaners, bosses] = await Promise.all([
          api.users("cleaner"),
          api.users("boss"),
        ]);
        const all = [...cleaners, ...bosses].filter((u) => u.id !== user?.id);
        setUsers(all);
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.id]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const start = async () => {
    if (selected.length === 0) return;
    const isGroup = selected.length > 1;
    const convo = await api.createConversation({
      type: isGroup ? "group" : "dm",
      name: isGroup ? groupName.trim() || "Group Chat" : null,
      participants: selected,
    });
    router.replace({
      pathname: "/chat/[id]",
      params: {
        id: convo.id,
        title: isGroup
          ? convo.name
          : users.find((u) => u.id === selected[0])?.name || "Chat",
      },
    });
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="new-chat-cancel" onPress={() => router.back()}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>New Chat</Text>
        <Pressable
          testID="new-chat-start"
          onPress={start}
          disabled={selected.length === 0}
        >
          <Text style={[styles.start, selected.length === 0 && { opacity: 0.4 }]}>Start</Text>
        </Pressable>
      </View>

      {selected.length > 1 && (
        <TextInput
          testID="group-name-input"
          style={styles.groupInput}
          placeholder="Group name"
          placeholderTextColor={colors.muted}
          value={groupName}
          onChangeText={setGroupName}
        />
      )}

      {loading ? (
        <Loading />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => {
            const on = selected.includes(item.id);
            return (
              <Pressable
                testID={`user-${item.id}`}
                style={styles.row}
                onPress={() => toggle(item.id)}
              >
                <Avatar name={item.name} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.role}>{item.role}</Text>
                </View>
                <Ionicons
                  name={on ? "checkmark-circle" : "ellipse-outline"}
                  size={24}
                  color={on ? colors.brandPrimary : colors.borderStrong}
                />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cancel: { fontSize: 16, color: colors.muted },
  title: { fontSize: 17, fontWeight: "700", color: colors.onSurface },
  start: { fontSize: 16, color: colors.brandPrimary, fontWeight: "700" },
  groupInput: {
    backgroundColor: colors.surfaceSecondary,
    margin: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.onSurface,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  name: { fontSize: 16, fontWeight: "600", color: colors.onSurface },
  role: { fontSize: 13, color: colors.muted, textTransform: "capitalize" },
  sep: { height: 1, backgroundColor: colors.divider, marginLeft: 72 },
});
