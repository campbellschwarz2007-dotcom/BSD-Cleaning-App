import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Linking,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { pickImageAsDataUri } from "@/src/utils/pickImage";
import { colors, radius, spacing, shadow } from "@/src/theme";
import { Avatar, EmptyState, Loading } from "@/src/components/ui";

export default function ContestScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [contest, setContest] = useState<any>(null);
  const [subs, setSubs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [pickedImage, setPickedImage] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);
  const [note, setNote] = useState("");

  const canSubmit = user?.role === "cleaner" || user?.role === "boss";

  const load = useCallback(async () => {
    if (!user) return;
    const data = await api.contest(user.id);
    setContest(data.contest);
    setSubs(data.submissions);
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

  const vote = async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // optimistic
    setSubs((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, has_voted: !s.has_voted, vote_count: s.vote_count + (s.has_voted ? -1 : 1) }
          : s
      )
    );
    try {
      await api.vote(id);
    } catch {
      await load();
    }
  };

  const pick = async () => {
    const res = await pickImageAsDataUri();
    if (!res) return;
    if ("error" in res) {
      setNote(res.error === "settings" ? "Photo access blocked. Open Settings." : "Couldn't access photos.");
      return;
    }
    setNote("");
    setPickedImage(res.dataUri);
  };

  const post = async () => {
    if (!pickedImage) return;
    setPosting(true);
    try {
      await api.submitContest({ image: pickedImage, caption: caption.trim() });
      setSubmitOpen(false);
      setPickedImage(null);
      setCaption("");
      await load();
    } finally {
      setPosting(false);
    }
  };

  const renderItem = ({ item, index }: { item: any; index: number }) => (
    <View style={styles.post} testID={`submission-${item.id}`}>
      <View style={styles.postHead}>
        <Avatar name={item.user_name} size={38} />
        <View style={{ flex: 1 }}>
          <Text style={styles.postAuthor}>{item.user_name}</Text>
          <Text style={styles.postDate}>{dayjs(item.created_at).format("MMM D, h:mm A")}</Text>
        </View>
        {index === 0 && item.vote_count > 0 && (
          <View style={styles.leaderBadge}>
            <Ionicons name="trophy" size={14} color="#fff" />
            <Text style={styles.leaderText}>Leading</Text>
          </View>
        )}
      </View>
      <View style={styles.imageWrap}>
        <Image source={{ uri: item.image }} style={styles.image} contentFit="cover" />
        {item.caption ? (
          <LinearGradient
            colors={["transparent", "rgba(28,28,30,0.85)"]}
            style={styles.scrim}
          >
            <Text style={styles.caption}>{item.caption}</Text>
          </LinearGradient>
        ) : null}
      </View>
      <View style={styles.postActions}>
        <Pressable
          testID={`vote-${item.id}`}
          onPress={() => vote(item.id)}
          style={[styles.voteBtn, item.has_voted && styles.voteBtnActive]}
        >
          <Ionicons
            name={item.has_voted ? "heart" : "heart-outline"}
            size={22}
            color={item.has_voted ? "#fff" : colors.brandPrimary}
          />
          <Text style={[styles.voteText, item.has_voted && { color: "#fff" }]}>
            {item.vote_count} {item.vote_count === 1 ? "vote" : "votes"}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View>
          <Text style={styles.title}>Photo Contest</Text>
          <Text style={styles.subtitle}>
            {contest?.theme || "Weekly Contest"}
          </Text>
        </View>
        <Ionicons name="trophy" size={28} color={colors.warning} />
      </View>

      {loading ? (
        <Loading label="Loading contest…" />
      ) : (
        <FlatList
          data={subs}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ListEmptyComponent={
            <EmptyState
              icon="images-outline"
              title="No submissions yet"
              subtitle={canSubmit ? "Be the first to submit a photo!" : "Check back soon to vote."}
              style={{ marginTop: 60 }}
            />
          }
        />
      )}

      {canSubmit && (
        <Pressable
          testID="submit-photo-fab"
          onPress={() => setSubmitOpen(true)}
          style={[styles.fab, { bottom: insets.bottom + spacing.md }]}
        >
          <Ionicons name="camera" size={22} color="#fff" />
          <Text style={styles.fabText}>Submit</Text>
        </Pressable>
      )}

      {/* Submit modal */}
      <Modal visible={submitOpen} transparent animationType="slide" onRequestClose={() => setSubmitOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalRoot}
        >
          <Pressable style={styles.backdrop} onPress={() => setSubmitOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Submit your photo</Text>

            <Pressable testID="pick-image-btn" onPress={pick} style={styles.pickArea}>
              {pickedImage ? (
                <Image source={{ uri: pickedImage }} style={styles.preview} contentFit="cover" />
              ) : (
                <View style={styles.pickPlaceholder}>
                  <Ionicons name="cloud-upload-outline" size={36} color={colors.muted} />
                  <Text style={styles.pickText}>Tap to choose a photo</Text>
                </View>
              )}
            </Pressable>

            <TextInput
              testID="caption-input"
              style={styles.captionInput}
              placeholder="Add a caption…"
              placeholderTextColor={colors.muted}
              value={caption}
              onChangeText={setCaption}
            />

            {note ? (
              <Pressable onPress={() => Linking.openSettings()}>
                <Text style={styles.note}>{note}</Text>
              </Pressable>
            ) : null}

            <Pressable
              testID="post-submission-btn"
              onPress={post}
              disabled={!pickedImage || posting}
              style={[styles.postBtn, (!pickedImage || posting) && { opacity: 0.5 }]}
            >
              {posting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.postBtnText}>Post to contest</Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface },
  subtitle: { fontSize: 14, color: colors.brandPrimary, fontWeight: "600", marginTop: 2 },
  post: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    overflow: "hidden",
    ...shadow.card,
  },
  postHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  postAuthor: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  postDate: { fontSize: 12, color: colors.muted },
  leaderBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.warning,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  leaderText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  imageWrap: { width: "100%", aspectRatio: 1, backgroundColor: colors.surfaceSecondary },
  image: { width: "100%", height: "100%" },
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.md,
    paddingTop: spacing.xl,
  },
  caption: { color: "#fff", fontSize: 15, fontWeight: "600" },
  postActions: { flexDirection: "row", padding: spacing.md },
  voteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1.5,
    borderColor: colors.brandPrimary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  voteBtnActive: { backgroundColor: colors.brandPrimary },
  voteText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 14 },
  fab: {
    position: "absolute",
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: radius.pill,
    ...shadow.card,
  },
  fabText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
    alignSelf: "center",
    marginBottom: spacing.lg,
  },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.lg },
  pickArea: {
    width: "100%",
    aspectRatio: 1.4,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surfaceSecondary,
    marginBottom: spacing.md,
  },
  preview: { width: "100%", height: "100%" },
  pickPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  pickText: { color: colors.muted, fontSize: 15 },
  captionInput: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.onSurface,
    marginBottom: spacing.md,
  },
  note: { color: colors.error, textAlign: "center", marginBottom: spacing.sm },
  postBtn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: "center",
  },
  postBtnText: { color: "#fff", fontWeight: "700", fontSize: 17 },
});
