import React from "react";
import { View, Text, StyleSheet, ActivityIndicator, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  colors,
  radius,
  spacing,
  statusColor,
  statusLabel,
  statusTextColor,
} from "@/src/theme";

export function StatusPill({ status, small }: { status: string; small?: boolean }) {
  return (
    <View
      testID={`status-pill-${status}`}
      style={[
        styles.statusPill,
        { backgroundColor: statusColor(status) },
        small && { paddingVertical: 2, paddingHorizontal: 8 },
      ]}
    >
      <Text
        style={[
          styles.statusText,
          { color: statusTextColor(status), fontSize: small ? 11 : 12 },
        ]}
      >
        {statusLabel(status)}
      </Text>
    </View>
  );
}

export function ProgressBar({
  percent,
  color = colors.success,
  height = 10,
}: {
  percent: number;
  color?: string;
  height?: number;
}) {
  return (
    <View style={[styles.progressTrack, { height, borderRadius: height / 2 }]}>
      <View
        style={{
          width: `${Math.min(100, Math.max(0, percent))}%`,
          height: "100%",
          backgroundColor: color,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const initials = (name || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>{initials}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  subtitle,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.empty, style]} testID="empty-state">
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={34} color={colors.muted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.loading} testID="loading-state">
      <ActivityIndicator color={colors.brandPrimary} size="large" />
      {label ? <Text style={styles.loadingText}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  statusPill: {
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
    alignSelf: "flex-start",
  },
  statusText: { fontWeight: "700" },
  progressTrack: {
    backgroundColor: colors.surfaceTertiary,
    overflow: "hidden",
    width: "100%",
  },
  avatar: {
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.onBrandSecondary, fontWeight: "700" },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing["3xl"],
    paddingHorizontal: spacing.xl,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.onSurface,
    textAlign: "center",
  },
  emptySub: {
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  loadingText: { color: colors.muted, fontSize: 14 },
});
