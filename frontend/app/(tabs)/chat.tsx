import React, { useCallback, useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import dayjs from "dayjs";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, shadow } from "@/src/theme";
import { Avatar, EmptyState, Loading } from "@/src/components/ui";

export default function ChatListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [convos, setConvos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<any>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const c = await api.conversations(user.id);
    setConvos(c);
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        try {
          await load();
        } finally {
          setLoading(false);
        }
      })();
      timer.current = setInterval(load, 5000);
      return () => clearInterval(timer.current);
    }, [load])
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    const isAll = item.type === "all";
    const preview = item.last_message
      ? `${item.last_message.sender_name?.split(" ")[0] || ""}: ${item.last_message.text}`
      : "No messages yet";
    return (
      <Pressable
        testID={`convo-${item.id}`}
        style={styles.row}
        onPress={() =>
          router.push({
            pathname: "/chat/[id]",
            params: { id: item.id, title: item.display_name },
          })
        }
      >
        {isAll ? (
          <View style={styles.allBadge}>
            <Ionicons name="megaphone" size={22} color="#fff" />
          </View>
        ) : (
          <Avatar name={item.display_name} />
        )}
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={styles.name} numberOfLines={1}>
              {item.display_name}
            </Text>
            {item.last_message && (
              <Text style={styles.time}>
                {dayjs(item.last_message.created_at).format("h:mm A")}
              </Text>
            )}
          </View>
          <Text style={styles.preview} numberOfLines={1}>
            {preview}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Chats</Text>
        <Pressable
          testID="new-chat-btn"
          onPress={() => router.push("/new-chat")}
          style={styles.newBtn}
        >
          <Ionicons name="create-outline" size={24} color={colors.brandPrimary} />
        </Pressable>
      </View>

      {loading ? (
        <Loading label="Loading chats…" />
      ) : (
        <FlatList
          data={convos}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            <EmptyState
              icon="chatbubbles-outline"
              title="No conversations yet"
              subtitle="Tap the pencil to start a chat."
            />
          }
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
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 30, fontWeight: "800", color: colors.onSurface },
  newBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, gap: spacing.md },
  allBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 16, fontWeight: "700", color: colors.onSurface, flex: 1 },
  time: { fontSize: 12, color: colors.muted, marginLeft: spacing.sm },
  preview: { fontSize: 14, color: colors.muted, marginTop: 2 },
  sep: { height: 1, backgroundColor: colors.divider, marginLeft: 72 },
});
