import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import dayjs from "dayjs";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing } from "@/src/theme";
import { Loading } from "@/src/components/ui";

export default function ConversationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { id, title } = useLocalSearchParams<{ id: string; title: string }>();
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const listRef = useRef<FlatList>(null);
  const timer = useRef<any>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const m = await api.messages(id);
    setMessages(m);
  }, [id]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
    timer.current = setInterval(load, 3000);
    return () => clearInterval(timer.current);
  }, [load]);

  const send = async () => {
    if (!text.trim()) return;
    const t = text.trim();
    setText("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await api.sendMessage(id, t);
    await load();
    listRef.current?.scrollToEnd({ animated: true });
  };

  const completeTask = async (taskId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await api.completeTask(taskId);
    await load();
  };
  const redoTask = async (taskId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await api.redoTask(taskId);
    await load();
  };

  const renderMessage = ({ item }: { item: any }) => {
    const mine = item.sender_id === user?.id;

    if (item.task) {
      const t = item.task;
      return (
        <View style={[styles.taskCard, mine ? styles.taskMine : styles.taskTheirs]}>
          <View style={styles.taskHead}>
            <Ionicons name="clipboard" size={16} color={colors.brandPrimary} />
            <Text style={styles.taskLabel}>TASK</Text>
          </View>
          <Text style={styles.taskTitle}>{t.title}</Text>
          {t.room_name ? <Text style={styles.taskRoom}>{t.room_name}</Text> : null}
          <Text style={styles.taskStatus}>
            {t.status === "completed"
              ? `✓ Completed by ${t.completed_by_name}`
              : t.status === "redo"
              ? "↺ Redo requested"
              : "Pending"}
          </Text>
          {user?.role === "cleaner" && t.status !== "completed" && (
            <Pressable
              testID={`chat-complete-${t.id}`}
              onPress={() => completeTask(t.id)}
              style={styles.taskAction}
            >
              <Text style={styles.taskActionText}>Mark Done</Text>
            </Pressable>
          )}
          {(user?.role === "boss" || user?.role === "admin") && t.status === "completed" && (
            <Pressable
              testID={`chat-redo-${t.id}`}
              onPress={() => redoTask(t.id)}
              style={[styles.taskAction, { backgroundColor: colors.warning }]}
            >
              <Text style={[styles.taskActionText, { color: "#111" }]}>Request Redo</Text>
            </Pressable>
          )}
        </View>
      );
    }

    return (
      <View style={[styles.bubbleRow, mine ? styles.rowRight : styles.rowLeft]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {!mine && <Text style={styles.sender}>{item.sender_name}</Text>}
          <Text style={[styles.msgText, mine && { color: "#fff" }]}>{item.text}</Text>
          <Text style={[styles.msgTime, mine && { color: "rgba(255,255,255,0.75)" }]}>
            {dayjs(item.created_at).format("h:mm A")}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="chat-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.brandPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title || "Chat"}
        </Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <Loading />
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
        >
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(i) => i.id}
            renderItem={renderMessage}
            contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.lg }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />
          <View style={[styles.inputBar, { paddingBottom: insets.bottom || spacing.sm }]}>
            <TextInput
              testID="chat-input"
              style={styles.input}
              placeholder="Message"
              placeholderTextColor={colors.muted}
              value={text}
              onChangeText={setText}
              multiline
            />
            <Pressable
              testID="chat-send"
              onPress={send}
              disabled={!text.trim()}
              style={[styles.sendBtn, !text.trim() && { opacity: 0.4 }]}
            >
              <Ionicons name="arrow-up" size={22} color="#fff" />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 34, alignItems: "flex-start" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: colors.onSurface },
  bubbleRow: { marginVertical: 3, flexDirection: "row" },
  rowRight: { justifyContent: "flex-end" },
  rowLeft: { justifyContent: "flex-start" },
  bubble: { maxWidth: "78%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  bubbleMine: { backgroundColor: colors.brandPrimary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  sender: { fontSize: 12, fontWeight: "700", color: colors.brandPrimary, marginBottom: 2 },
  msgText: { fontSize: 15, color: colors.onSurface },
  msgTime: { fontSize: 10, color: colors.muted, marginTop: 3, alignSelf: "flex-end" },
  taskCard: {
    maxWidth: "82%",
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
    marginVertical: 4,
    borderWidth: 1.5,
    borderColor: colors.brandTertiary,
  },
  taskMine: { alignSelf: "flex-end" },
  taskTheirs: { alignSelf: "flex-start" },
  taskHead: { flexDirection: "row", alignItems: "center", gap: 4 },
  taskLabel: { fontSize: 11, fontWeight: "800", color: colors.brandPrimary, letterSpacing: 0.5 },
  taskTitle: { fontSize: 16, fontWeight: "700", color: colors.onSurface, marginTop: 4 },
  taskRoom: { fontSize: 13, color: colors.muted, marginTop: 1 },
  taskStatus: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 6, fontWeight: "600" },
  taskAction: {
    backgroundColor: colors.success,
    borderRadius: radius.pill,
    paddingVertical: 8,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  taskActionText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    color: colors.onSurface,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
});
