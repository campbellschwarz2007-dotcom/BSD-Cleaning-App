import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import dayjs from "dayjs";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, shadow } from "@/src/theme";
import { Loading, ProgressBar } from "@/src/components/ui";

function StatLine({ label, data }: { label: string; data: any }) {
  if (!data || data.total === 0) return null;
  return (
    <View style={styles.statLine}>
      <View style={styles.statLineHead}>
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={styles.statValue}>
          {data.completed}/{data.total}
        </Text>
      </View>
      <ProgressBar percent={data.percent} height={8} />
    </View>
  );
}

export default function NumbersScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dateInput, setDateInput] = useState("");
  const isAdmin = user?.role === "admin";
  const isBossOrAdmin = user?.role === "boss" || user?.role === "admin";

  const load = useCallback(async () => {
    const d = await api.numbers();
    setData(d);
    setDateInput(d.school_start_date ? d.school_start_date.slice(0, 10) : "");
    if (user?.role === "boss" || user?.role === "admin") {
      const s = await api.taskSummary();
      setSummary(s);
    }
  }, [user?.role]);

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
    }, [])
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const saveDate = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return;
    await api.updateSettings({ school_start_date: dateInput });
    setEditing(false);
    await load();
  };

  if (loading) return <Loading label="Crunching numbers…" />;

  const buildings = data?.buildings || [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={{ height: insets.top + spacing.md }} />
      <Text style={styles.pageTitle}>Numbers</Text>

      {/* Countdown hero */}
      <LinearGradient colors={[colors.brandPrimary, "#B01126"]} style={styles.hero}>
        <Text style={styles.heroLabel}>WEEKDAYS UNTIL SCHOOL STARTS</Text>
        <Text style={styles.heroNumber} testID="countdown-number">
          {data?.countdown_weekdays ?? "—"}
        </Text>
        <Text style={styles.heroDate}>
          {data?.school_start_date
            ? `Starts ${dayjs(data.school_start_date).format("dddd, MMMM D")}`
            : "No start date set"}
        </Text>

        {isAdmin && !editing && (
          <Pressable testID="edit-date-btn" onPress={() => setEditing(true)} style={styles.heroEdit}>
            <Ionicons name="calendar" size={16} color="#fff" />
            <Text style={styles.heroEditText}>Set date</Text>
          </Pressable>
        )}
        {isAdmin && editing && (
          <View style={styles.dateRow}>
            <TextInput
              testID="date-input"
              style={styles.dateInput}
              value={dateInput}
              onChangeText={setDateInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="rgba(255,255,255,0.6)"
              autoCapitalize="none"
            />
            <Pressable testID="save-date-btn" onPress={saveDate} style={styles.dateSave}>
              <Text style={styles.dateSaveText}>Save</Text>
            </Pressable>
          </View>
        )}
      </LinearGradient>

      {/* Boss / Admin: Today's Digest */}
      {isBossOrAdmin && summary && (
        <View style={styles.card} testID="daily-digest">
          <View style={styles.cardHead}>
            <Text style={styles.buildingName}>Today's Digest</Text>
            <Ionicons name="today" size={22} color={colors.brandPrimary} />
          </View>
          <View style={styles.digestRow}>
            <View style={styles.digestStat}>
              <Text style={[styles.digestNum, { color: colors.success }]}>
                {summary.completed_today.length}
              </Text>
              <Text style={styles.digestLabel}>Done today</Text>
            </View>
            <View style={styles.digestStat}>
              <Text style={[styles.digestNum, { color: colors.info }]}>
                {summary.totals.pending}
              </Text>
              <Text style={styles.digestLabel}>Pending</Text>
            </View>
            <View style={styles.digestStat}>
              <Text style={[styles.digestNum, { color: colors.warning }]}>
                {summary.totals.redo}
              </Text>
              <Text style={styles.digestLabel}>Redo</Text>
            </View>
          </View>
          <View style={styles.divider} />
          {summary.completed_today.length === 0 ? (
            <Text style={styles.overallMeta}>No tasks completed yet today.</Text>
          ) : (
            summary.completed_today.map((t: any) => (
              <View key={t.id} style={styles.digestItem} testID={`digest-item-${t.id}`}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.digestTitle}>{t.title}</Text>
                  <Text style={styles.digestMeta}>
                    {[t.room_name, t.completed_by_name].filter(Boolean).join(" · ")}
                    {t.completed_at ? ` · ${dayjs(t.completed_at).format("h:mm A")}` : ""}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      )}

      {/* Per-building progress */}
      <Text style={styles.sectionHeader}>Cleaning progress</Text>
      {buildings.map((b: any) => (
        <View key={b.id} style={styles.card} testID={`building-card-${b.id}`}>
          <View style={styles.cardHead}>
            <Text style={styles.buildingName}>{b.name}</Text>
            <View style={styles.percentBadge}>
              <Text style={styles.percentText}>{b.overall.percent}%</Text>
            </View>
          </View>
          <ProgressBar percent={b.overall.percent} height={12} />
          <Text style={styles.overallMeta}>
            {b.overall.completed} of {b.overall.total} areas completed
          </Text>
          <View style={styles.divider} />
          <StatLine label="Rooms" data={b.rooms} />
          <StatLine label="Hallways" data={b.hallways} />
          <StatLine label="Stairs" data={b.stairs} />
          <StatLine label="Entryways" data={b.entryways} />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  pageTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: colors.onSurface,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  hero: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    ...shadow.card,
  },
  heroLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
  },
  heroNumber: { color: "#fff", fontSize: 88, fontWeight: "800", lineHeight: 96 },
  heroDate: { color: "rgba(255,255,255,0.9)", fontSize: 15, fontWeight: "600" },
  heroEdit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.md,
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  heroEditText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  dateRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, width: "100%" },
  dateInput: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: "#fff",
    fontSize: 15,
  },
  dateSave: {
    backgroundColor: "#fff",
    borderRadius: radius.md,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  dateSaveText: { color: colors.brandPrimary, fontWeight: "700" },
  sectionHeader: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  buildingName: { fontSize: 19, fontWeight: "800", color: colors.onSurface },
  percentBadge: {
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  percentText: { color: colors.onBrandSecondary, fontWeight: "800", fontSize: 14 },
  overallMeta: { fontSize: 13, color: colors.muted, marginTop: 6 },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.md },
  statLine: { marginBottom: spacing.md },
  statLineHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  statLabel: { fontSize: 14, color: colors.onSurfaceSecondary, fontWeight: "600" },
  statValue: { fontSize: 14, color: colors.muted, fontWeight: "600" },
  digestRow: { flexDirection: "row", gap: spacing.sm },
  digestStat: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  digestNum: { fontSize: 26, fontWeight: "800" },
  digestLabel: { fontSize: 12, color: colors.muted, fontWeight: "600", marginTop: 2 },
  digestItem: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  digestTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  digestMeta: { fontSize: 12, color: colors.muted, marginTop: 1 },
});
