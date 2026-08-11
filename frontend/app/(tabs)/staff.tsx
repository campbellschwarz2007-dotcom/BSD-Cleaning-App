import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { Avatar, EmptyState, Loading } from "@/src/components/ui";

type Person = {
  id: string;
  name: string;
  role: "cleaner" | "teacher";
  has_pin?: boolean;
  created_at?: string;
};

type Confirm = { kind: "reset" | "remove"; person: Person } | null;

export default function StaffScreen() {
  const insets = useSafeAreaInsets();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [cleaners, teachers] = await Promise.all([
      api.users("cleaner"),
      api.users("teacher"),
    ]);
    const merged = [...cleaners, ...teachers].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    setPeople(merged);
  }, []);

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

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "reset") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await api.resetPin(confirm.person.id);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        await api.deleteUser(confirm.person.id);
      }
      await load();
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const renderItem = ({ item }: { item: Person }) => (
    <View style={styles.row} testID={`staff-${item.id}`}>
      <Avatar name={item.name} />
      <View style={styles.rowBody}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.tag, item.role === "teacher" && styles.tagTeacher]}>
            <Text style={styles.tagText}>{item.role}</Text>
          </View>
          <View style={styles.pinDot}>
            <Ionicons
              name={item.has_pin ? "lock-closed" : "lock-open"}
              size={12}
              color={item.has_pin ? colors.success : colors.warning}
            />
            <Text style={styles.pinText}>
              {item.has_pin ? "PIN set" : "No PIN"}
            </Text>
          </View>
        </View>
      </View>
      <Pressable
        testID={`reset-pin-${item.id}`}
        onPress={() => setConfirm({ kind: "reset", person: item })}
        style={styles.iconBtn}
        hitSlop={8}
      >
        <Ionicons name="key-outline" size={20} color={colors.brandPrimary} />
      </Pressable>
      <Pressable
        testID={`remove-user-${item.id}`}
        onPress={() => setConfirm({ kind: "remove", person: item })}
        style={styles.iconBtn}
        hitSlop={8}
      >
        <Ionicons name="trash-outline" size={20} color={colors.error} />
      </Pressable>
    </View>
  );

  const isRemove = confirm?.kind === "remove";

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Staff</Text>
        <Text style={styles.count}>{people.length}</Text>
      </View>

      {loading ? (
        <Loading label="Loading staff…" />
      ) : (
        <FlatList
          data={people}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} />
          }
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListHeaderComponent={
            <Text style={styles.hint}>
              Everyone who has signed in as a cleaner or teacher. Reset a PIN if
              someone is locked out, or remove people who have left.
            </Text>
          }
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title="No staff yet"
              subtitle="People appear here after they sign in by name."
            />
          }
        />
      )}

      <Modal
        visible={confirm !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirm(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setConfirm(null)} />
          <View style={styles.dialog}>
            <View
              style={[styles.dialogIcon, isRemove && { backgroundColor: "#FDE8E8" }]}
            >
              <Ionicons
                name={isRemove ? "trash" : "key"}
                size={24}
                color={isRemove ? colors.error : colors.brandPrimary}
              />
            </View>
            <Text style={styles.dialogTitle}>
              {isRemove ? "Remove person" : "Reset PIN"}
            </Text>
            <Text style={styles.dialogBody}>
              {isRemove
                ? `Remove ${confirm?.person.name} from the app? This deletes their account.`
                : `Clear ${confirm?.person.name}'s PIN? They'll create a new one the next time they sign in.`}
            </Text>
            <View style={styles.dialogBtns}>
              <Pressable
                testID="confirm-cancel"
                onPress={() => setConfirm(null)}
                style={[styles.dialogBtn, styles.cancelBtn]}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="confirm-ok"
                disabled={busy}
                onPress={runConfirm}
                style={[
                  styles.dialogBtn,
                  { backgroundColor: isRemove ? colors.error : colors.brandPrimary },
                  busy && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.okText}>
                  {isRemove ? "Remove" : "Reset PIN"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  count: { fontSize: 16, fontWeight: "700", color: colors.muted },
  hint: {
    fontSize: 13,
    color: colors.muted,
    padding: spacing.lg,
    paddingBottom: spacing.sm,
    lineHeight: 18,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowBody: { flex: 1 },
  name: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 },
  tag: {
    backgroundColor: colors.brandSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  tagTeacher: { backgroundColor: colors.surfaceSecondary },
  tagText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.onBrandSecondary,
    textTransform: "capitalize",
  },
  pinDot: { flexDirection: "row", alignItems: "center", gap: 4 },
  pinText: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  sep: { height: 1, backgroundColor: colors.divider, marginLeft: 72 },
  modalRoot: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  dialog: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "center",
  },
  dialogIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  dialogTitle: { fontSize: 19, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.xs },
  dialogBody: {
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  dialogBtns: { flexDirection: "row", gap: spacing.sm, alignSelf: "stretch" },
  dialogBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: radius.md,
    alignItems: "center",
  },
  cancelBtn: { backgroundColor: colors.surfaceSecondary },
  cancelText: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  okText: { fontSize: 15, fontWeight: "700", color: "#fff" },
});
