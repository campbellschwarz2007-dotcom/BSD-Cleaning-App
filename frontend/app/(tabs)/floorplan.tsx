import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, statusColor, statusTextColor, shadow } from "@/src/theme";
import { Loading, EmptyState } from "@/src/components/ui";
import RoomSheet from "@/src/components/RoomSheet";

const BLUEPRINT =
  "https://images.unsplash.com/photo-1542621334-a254cf47733d?crop=entropy&cs=srgb&fm=jpg&q=70&w=800";

const LEGEND = [
  { s: "untouched", label: "Untouched" },
  { s: "teacher_in", label: "Teacher In" },
  { s: "in_progress", label: "In Progress" },
  { s: "completed", label: "Completed" },
];

export default function FloorPlanScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [buildings, setBuildings] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeRoom, setActiveRoom] = useState<any>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const isAdmin = user?.role === "admin";

  const loadBuildings = useCallback(async () => {
    const b = await api.buildings();
    setBuildings(b);
    setSelected((cur: any) => cur || b[0] || null);
    return b;
  }, []);

  const loadRooms = useCallback(async (buildingId: string) => {
    const r = await api.rooms(buildingId);
    setRooms(r);
  }, []);

  const init = useCallback(async () => {
    setLoading(true);
    try {
      const b = await loadBuildings();
      const first = selected || b[0];
      if (first) await loadRooms(first.id);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    init();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (selected) loadRooms(selected.id);
    }, [selected?.id])
  );

  useEffect(() => {
    if (selected) loadRooms(selected.id);
  }, [selected?.id]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await loadBuildings();
      if (selected) await loadRooms(selected.id);
    } finally {
      setRefreshing(false);
    }
  };

  const onChanged = useCallback(async () => {
    if (selected) {
      const r = await api.rooms(selected.id);
      setRooms(r);
      setActiveRoom((cur: any) => (cur ? r.find((x: any) => x.id === cur.id) || cur : cur));
    }
  }, [selected?.id]);

  const openRoom = (room: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveRoom(room);
    setSheetOpen(true);
  };

  const addRoom = async () => {
    if (!selected) return;
    const room = await api.createRoom({
      building_id: selected.id,
      name: "New Room",
      type: "room",
      x: 20,
      y: 20,
      width: 90,
      height: 46,
      status: "untouched",
    });
    await onChanged();
    setActiveRoom(room);
    setSheetOpen(true);
  };

  const canvasW = Math.max(
    340,
    ...rooms.map((r) => (r.x || 0) + (r.width || 90) + 20)
  );
  const canvasH = Math.max(
    460,
    ...rooms.map((r) => (r.y || 0) + (r.height || 46) + 20)
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hello}>Go Big Red</Text>
          <Pressable
            testID="building-picker-btn"
            style={styles.buildingBtn}
            onPress={() => setPickerOpen(true)}
          >
            <Text style={styles.buildingName} numberOfLines={1}>
              {selected?.name || "Select building"}
            </Text>
            <Ionicons name="chevron-down" size={18} color={colors.brandPrimary} />
          </Pressable>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{user?.role}</Text>
          </View>
          <Pressable testID="sign-out-btn" onPress={signOut} style={styles.iconBtn}>
            <Ionicons name="log-out-outline" size={22} color={colors.onSurface} />
          </Pressable>
        </View>
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        {LEGEND.map((l) => (
          <View key={l.s} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: statusColor(l.s) }]} />
            <Text style={styles.legendText}>{l.label}</Text>
          </View>
        ))}
      </View>

      {loading ? (
        <Loading label="Loading floor plan…" />
      ) : buildings.length === 0 ? (
        <EmptyState icon="business" title="No buildings yet" subtitle="Sign in as Admin to add one." />
      ) : (
        <ScrollView
          style={styles.flex}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={[styles.canvas, { width: canvasW, height: canvasH }]}>
              <Image source={{ uri: BLUEPRINT }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <View style={styles.canvasTint} />
              {rooms.map((room) => (
                <Pressable
                  key={room.id}
                  testID={`room-pin-${room.id}`}
                  onPress={() => openRoom(room)}
                  style={[
                    styles.pin,
                    {
                      left: room.x,
                      top: room.y,
                      width: room.width,
                      height: room.height,
                      backgroundColor: statusColor(room.status),
                    },
                  ]}
                >
                  <Text
                    numberOfLines={2}
                    style={[styles.pinText, { color: statusTextColor(room.status) }]}
                  >
                    {room.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <View style={{ height: 120 }} />
        </ScrollView>
      )}

      {/* Admin FABs */}
      {isAdmin && (
        <View style={[styles.fabWrap, { bottom: insets.bottom + spacing.md }]}>
          {editMode && (
            <Pressable testID="add-room-fab" onPress={addRoom} style={[styles.fab, styles.fabSecondary]}>
              <Ionicons name="add" size={24} color={colors.brandPrimary} />
            </Pressable>
          )}
          <Pressable
            testID="edit-mode-fab"
            onPress={() => {
              Haptics.selectionAsync();
              setEditMode((e) => !e);
            }}
            style={[styles.fab, editMode && { backgroundColor: colors.success }]}
          >
            <Ionicons name={editMode ? "checkmark" : "create"} size={24} color="#fff" />
          </Pressable>
        </View>
      )}

      {/* Building picker */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)}>
          <View style={[styles.pickerCard, { marginTop: insets.top + 60 }]}>
            <Text style={styles.pickerTitle}>Select building</Text>
            {buildings.map((b) => (
              <Pressable
                key={b.id}
                testID={`building-option-${b.id}`}
                onPress={() => {
                  setSelected(b);
                  setPickerOpen(false);
                }}
                style={styles.pickerRow}
              >
                <Ionicons
                  name={selected?.id === b.id ? "radio-button-on" : "radio-button-off"}
                  size={20}
                  color={colors.brandPrimary}
                />
                <Text style={styles.pickerRowText}>{b.name}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {user && (
        <RoomSheet
          room={activeRoom}
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onChanged={onChanged}
          editMode={editMode}
          user={user}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  hello: { fontSize: 13, color: colors.muted, fontWeight: "600" },
  buildingBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  buildingName: { fontSize: 24, fontWeight: "800", color: colors.onSurface, maxWidth: 220 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  roleBadge: {
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  roleBadgeText: { color: colors.onBrandSecondary, fontWeight: "700", fontSize: 12, textTransform: "capitalize" },
  iconBtn: { padding: 4 },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { fontSize: 12, color: colors.onSurfaceSecondary, fontWeight: "500" },
  canvas: {
    margin: spacing.lg,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: "#dfe3ea",
    ...shadow.card,
  },
  canvasTint: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255,255,255,0.35)" },
  pin: {
    position: "absolute",
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.7)",
    ...shadow.card,
  },
  pinText: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  fabWrap: { position: "absolute", right: spacing.lg, gap: spacing.md, alignItems: "center" },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  fabSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.25)", paddingHorizontal: spacing.lg },
  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadow.card,
  },
  pickerTitle: { fontSize: 13, fontWeight: "700", color: colors.muted, textTransform: "uppercase", padding: spacing.sm },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  pickerRowText: { fontSize: 16, color: colors.onSurface, fontWeight: "600" },
});
