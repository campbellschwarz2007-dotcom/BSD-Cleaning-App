import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  Pressable,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import dayjs from "dayjs";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, shadow } from "@/src/theme";
import { EmptyState, Loading } from "@/src/components/ui";

export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [visits, setVisits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const v = await api.visits({ teacher_id: user.id });
    const today = dayjs().startOf("day");
    const upcoming = v
      .filter((x: any) => dayjs(x.date).startOf("day").diff(today, "day") >= 0)
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
    setVisits(upcoming);
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

  const cancel = async (v: any) => {
    Haptics.selectionAsync();
    await api.addVisit(v.room_id, v.date); // toggles the booking off
    await load();
  };

  // group visits by date into SectionList sections
  const map: Record<string, any[]> = {};
  visits.forEach((v) => {
    (map[v.date] = map[v.date] || []).push(v);
  });
  const sections = Object.keys(map)
    .sort()
    .map((date) => ({ title: date, data: map[date] }));

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View>
          <Text style={styles.title}>My Calendar</Text>
          <Text style={styles.subtitle}>Rooms you're coming in to use</Text>
        </View>
        <Ionicons name="calendar" size={28} color={colors.brandPrimary} />
      </View>

      {loading ? (
        <Loading label="Loading your calendar…" />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>
              {dayjs(section.title).format("dddd, MMMM D")}
            </Text>
          )}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`visit-card-${item.id}`}>
              <View style={styles.roomDot}>
                <Ionicons name="school" size={18} color={colors.status_teacher_in} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.roomName}>{item.room_name || "Room"}</Text>
                <Text style={styles.meta}>Marked as Teacher In</Text>
              </View>
              <Pressable
                testID={`cancel-visit-${item.id}`}
                onPress={() => cancel(item)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </View>
          )}
          ListHeaderComponent={
            <View style={styles.tip}>
              <Ionicons name="information-circle" size={18} color={colors.brandPrimary} />
              <Text style={styles.tipText}>
                To book a room, open it on the Floor Plan and pick a day at least 3 days ahead.
              </Text>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="calendar-outline"
              title="No upcoming days"
              subtitle="Book a room from the Floor Plan to see it here."
              style={{ marginTop: 40 }}
            />
          }
        />
      )}

      <Pressable
        testID="go-floorplan-btn"
        onPress={() => router.push("/(tabs)/floorplan")}
        style={[styles.fab, { bottom: insets.bottom + spacing.md }]}
      >
        <Ionicons name="map" size={20} color="#fff" />
        <Text style={styles.fabText}>Floor Plan</Text>
      </Pressable>
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
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 2 },
  tip: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    backgroundColor: colors.brandSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  tipText: { flex: 1, color: colors.onBrandSecondary, fontSize: 13, lineHeight: 18 },
  sectionHeader: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.brandPrimary,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  roomDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  roomName: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  meta: { fontSize: 13, color: colors.muted, marginTop: 1 },
  cancelBtn: {
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  cancelText: { color: colors.error, fontWeight: "700", fontSize: 13 },
  fab: {
    position: "absolute",
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: radius.pill,
    ...shadow.card,
  },
  fabText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
