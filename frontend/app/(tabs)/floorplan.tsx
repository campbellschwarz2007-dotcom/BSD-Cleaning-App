import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  TextInput,
  Linking,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { pickImageAsDataUri } from "@/src/utils/pickImage";
import { colors, radius, spacing, statusColor, shadow } from "@/src/theme";
import { Loading, EmptyState } from "@/src/components/ui";
import RoomSheet from "@/src/components/RoomSheet";
import FloorCanvas from "@/src/components/FloorCanvas";

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
  const [floors, setFloors] = useState<any[]>([]);
  const [selectedFloor, setSelectedFloor] = useState<any>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [activeRoom, setActiveRoom] = useState<any>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [note, setNote] = useState("");
  const [bNameDraft, setBNameDraft] = useState("");

  useEffect(() => {
    setBNameDraft(selected?.name || "");
  }, [selected?.id, selected?.name, manageOpen]);

  const isAdmin = user?.role === "admin";

  const loadBuildings = useCallback(async () => {
    const b = await api.buildings();
    setBuildings(b);
    setSelected((cur: any) => (cur && b.find((x: any) => x.id === cur.id)) || b[0] || null);
    return b;
  }, []);

  const loadFloors = useCallback(async (buildingId: string) => {
    const f = await api.floors(buildingId);
    setFloors(f);
    setSelectedFloor((cur: any) => (cur && f.find((x: any) => x.id === cur.id)) || f[0] || null);
    return f;
  }, []);

  const loadRooms = useCallback(async (floorId: string) => {
    const r = await api.rooms({ floorId });
    setRooms(r);
  }, []);

  const init = useCallback(async () => {
    setLoading(true);
    try {
      const b = await loadBuildings();
      const first = b[0];
      if (first) {
        const f = await loadFloors(first.id);
        if (f[0]) await loadRooms(f[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    if (selected) loadFloors(selected.id);
  }, [selected?.id]);

  useEffect(() => {
    if (selectedFloor) loadRooms(selectedFloor.id);
  }, [selectedFloor?.id]);

  useFocusEffect(
    useCallback(() => {
      if (selectedFloor) loadRooms(selectedFloor.id);
    }, [selectedFloor?.id])
  );

  const refresh = async () => {
    await loadBuildings();
    if (selected) await loadFloors(selected.id);
    if (selectedFloor) await loadRooms(selectedFloor.id);
  };

  const onChanged = useCallback(async () => {
    if (selectedFloor) {
      const r = await api.rooms({ floorId: selectedFloor.id });
      setRooms(r);
      setActiveRoom((cur: any) => (cur ? r.find((x: any) => x.id === cur.id) || cur : cur));
    }
  }, [selectedFloor?.id]);

  const openRoom = (room: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveRoom(room);
    setSheetOpen(true);
  };

  const addRoom = async () => {
    if (!selected || !selectedFloor) return;
    const room = await api.createRoom({
      building_id: selected.id,
      floor_id: selectedFloor.id,
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

  const saveRoomLayout = useCallback(
    async (roomId: string, patch: { x: number; y: number; width: number; height: number }) => {
      await api.updateRoom(roomId, patch);
      await onChanged();
    },
    [onChanged]
  );

  // ---- Admin building & floor management ----
  const renameBuilding = async (name: string) => {
    if (!selected || !name.trim()) return;
    await api.updateBuilding(selected.id, { name: name.trim() });
    await loadBuildings();
  };
  const addBuilding = async () => {
    const b = await api.createBuilding({ name: "New Building" });
    await api.createFloor({ building_id: b.id, name: "1st Floor" });
    await loadBuildings();
    setSelected(b);
  };
  const deleteBuilding = async () => {
    if (!selected || buildings.length <= 1) {
      setNote("Keep at least one building.");
      return;
    }
    await api.deleteBuilding(selected.id);
    const b = await loadBuildings();
    setSelected(b[0] || null);
  };
  const addFloor = async () => {
    if (!selected) return;
    const f = await api.createFloor({
      building_id: selected.id,
      name: `Floor ${floors.length + 1}`,
    });
    await loadFloors(selected.id);
    setSelectedFloor(f);
  };
  const renameFloor = async (floorId: string, name: string) => {
    if (!name.trim()) return;
    await api.updateFloor(floorId, { name: name.trim() });
    if (selected) await loadFloors(selected.id);
  };
  const deleteFloor = async (floorId: string) => {
    if (floors.length <= 1) {
      setNote("Keep at least one floor.");
      return;
    }
    await api.deleteFloor(floorId);
    if (selected) {
      const f = await loadFloors(selected.id);
      setSelectedFloor(f[0] || null);
    }
  };
  const uploadBlueprint = async () => {
    if (!selectedFloor) return;
    const res = await pickImageAsDataUri();
    if (!res) return;
    if ("error" in res) {
      setNote(res.error === "settings" ? "Photo access blocked. Open Settings." : "Couldn't access photos.");
      return;
    }
    setNote("");
    await api.updateFloor(selectedFloor.id, { blueprint_image: res.dataUri });
    if (selected) await loadFloors(selected.id);
  };

  const canvasUri = selectedFloor?.blueprint_image || BLUEPRINT;

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
          {isAdmin && (
            <Pressable
              testID="manage-building-btn"
              onPress={() => {
                setNote("");
                setManageOpen(true);
              }}
              style={styles.iconBtn}
            >
              <Ionicons name="settings-outline" size={22} color={colors.onSurface} />
            </Pressable>
          )}
          <Pressable testID="refresh-btn" onPress={refresh} style={styles.iconBtn}>
            <Ionicons name="refresh" size={20} color={colors.onSurface} />
          </Pressable>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{user?.role}</Text>
          </View>
          <Pressable testID="sign-out-btn" onPress={signOut} style={styles.iconBtn}>
            <Ionicons name="log-out-outline" size={22} color={colors.onSurface} />
          </Pressable>
        </View>
      </View>

      {/* Floor selector */}
      {floors.length > 0 && (
        <View style={styles.floorBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.floorRow}
          >
            {floors.map((f) => {
              const on = selectedFloor?.id === f.id;
              return (
                <Pressable
                  key={f.id}
                  testID={`floor-${f.id}`}
                  onPress={() => setSelectedFloor(f)}
                  style={[styles.floorChip, on && styles.floorChipActive]}
                >
                  <Text style={[styles.floorChipText, on && styles.floorChipTextActive]}>
                    {f.name}
                  </Text>
                </Pressable>
              );
            })}
            {isAdmin && (
              <Pressable testID="add-floor-chip" onPress={addFloor} style={styles.floorAdd}>
                <Ionicons name="add" size={18} color={colors.brandPrimary} />
              </Pressable>
            )}
          </ScrollView>
        </View>
      )}

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
        <View style={styles.flex}>
          <FloorCanvas
            rooms={rooms}
            blueprintUri={canvasUri}
            editMode={editMode && isAdmin}
            onOpenRoom={openRoom}
            onSaveRoom={saveRoomLayout}
          />
          <View style={styles.zoomHint} pointerEvents="none">
            <Ionicons name={editMode && isAdmin ? "move" : "scan"} size={14} color="#fff" />
            <Text style={styles.zoomHintText}>
              {editMode && isAdmin
                ? "Drag to move · pull corner to resize"
                : Platform.OS === "web"
                ? "Use + / − to zoom"
                : "Pinch to zoom"}
            </Text>
          </View>
        </View>
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

      {/* Admin: manage building & floors */}
      <Modal visible={manageOpen} transparent animationType="slide" onRequestClose={() => setManageOpen(false)}>
        <View style={styles.manageRoot}>
          <Pressable style={styles.pickerBackdropFull} onPress={() => setManageOpen(false)} />
          <View style={[styles.manageSheet, { paddingBottom: insets.bottom + spacing.xl }]}>
            <View style={styles.handle} />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.manageTitle}>Manage building</Text>

              <Text style={styles.manageLabel}>Building name</Text>
              <View style={styles.nameEditRow}>
                <TextInput
                  testID="building-name-input"
                  style={[styles.manageInput, { flex: 1, marginBottom: 0 }]}
                  value={bNameDraft}
                  onChangeText={setBNameDraft}
                  placeholder="Building name"
                  placeholderTextColor={colors.muted}
                  onSubmitEditing={() => renameBuilding(bNameDraft)}
                />
                <Pressable
                  testID="save-building-name"
                  onPress={() => renameBuilding(bNameDraft)}
                  style={styles.saveNameBtn}
                >
                  <Text style={styles.saveNameText}>Save</Text>
                </Pressable>
              </View>
              <View style={styles.manageRow}>
                <Pressable testID="add-building-btn" onPress={addBuilding} style={styles.manageBtnGhost}>
                  <Ionicons name="add" size={18} color={colors.brandPrimary} />
                  <Text style={styles.manageBtnGhostText}>Add building</Text>
                </Pressable>
                <Pressable testID="delete-building-btn" onPress={deleteBuilding} style={styles.manageBtnDanger}>
                  <Ionicons name="trash" size={16} color={colors.error} />
                  <Text style={styles.manageBtnDangerText}>Delete</Text>
                </Pressable>
              </View>

              <View style={styles.manageDivider} />

              <Text style={styles.manageLabel}>Blueprint for {selectedFloor?.name || "floor"}</Text>
              <Pressable testID="upload-blueprint-btn" onPress={uploadBlueprint} style={styles.blueprintBtn}>
                {selectedFloor?.blueprint_image ? (
                  <Image source={{ uri: selectedFloor.blueprint_image }} style={styles.blueprintPreview} contentFit="cover" />
                ) : (
                  <View style={styles.blueprintPlaceholder}>
                    <Ionicons name="cloud-upload-outline" size={30} color={colors.muted} />
                    <Text style={styles.blueprintText}>Upload a blueprint photo</Text>
                  </View>
                )}
              </Pressable>

              <View style={styles.manageDivider} />

              <View style={styles.rowBetweenManage}>
                <Text style={styles.manageLabel}>Floors</Text>
                <Pressable testID="manage-add-floor-btn" onPress={addFloor} style={styles.manageBtnGhost}>
                  <Ionicons name="add" size={18} color={colors.brandPrimary} />
                  <Text style={styles.manageBtnGhostText}>Add floor</Text>
                </Pressable>
              </View>
              {floors.map((f) => (
                <View key={f.id} style={styles.floorManageRow}>
                  <TextInput
                    testID={`floor-name-input-${f.id}`}
                    style={[styles.manageInput, { flex: 1, marginBottom: 0 }]}
                    defaultValue={f.name}
                    onSubmitEditing={(e) => renameFloor(f.id, e.nativeEvent.text)}
                    onEndEditing={(e) => renameFloor(f.id, e.nativeEvent.text)}
                  />
                  <Pressable
                    testID={`delete-floor-${f.id}`}
                    onPress={() => deleteFloor(f.id)}
                    style={styles.floorDeleteBtn}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                </View>
              ))}

              {note ? (
                <Pressable onPress={() => Linking.openSettings()}>
                  <Text style={styles.manageNote}>{note}</Text>
                </Pressable>
              ) : null}

              <Pressable testID="manage-done-btn" onPress={() => setManageOpen(false)} style={styles.manageDone}>
                <Text style={styles.manageDoneText}>Done</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
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
  zoomHint: {
    position: "absolute",
    top: spacing.md,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(28,28,30,0.72)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  zoomHintText: { color: "#fff", fontSize: 12, fontWeight: "600" },
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
  floorBar: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  floorRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm, alignItems: "center" },
  floorChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    flexShrink: 0,
  },
  floorChipActive: { backgroundColor: colors.onSurface },
  floorChipText: { fontSize: 14, fontWeight: "600", color: colors.onSurfaceSecondary },
  floorChipTextActive: { color: "#fff" },
  floorAdd: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  manageRoot: { flex: 1, justifyContent: "flex-end" },
  pickerBackdropFull: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  manageSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: "88%",
  },
  manageTitle: { fontSize: 22, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.md },
  manageLabel: { fontSize: 13, color: colors.muted, fontWeight: "700", marginBottom: 6, textTransform: "uppercase" },
  manageInput: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.onSurface,
    marginBottom: spacing.md,
  },
  nameEditRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  saveNameBtn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  saveNameText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  manageRow: { flexDirection: "row", gap: spacing.sm },
  rowBetweenManage: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  manageBtnGhost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary,
  },
  manageBtnGhostText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 14 },
  manageBtnDanger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
  },
  manageBtnDangerText: { color: colors.error, fontWeight: "700", fontSize: 14 },
  manageDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.lg },
  blueprintBtn: {
    width: "100%",
    aspectRatio: 1.6,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surfaceSecondary,
  },
  blueprintPreview: { width: "100%", height: "100%" },
  blueprintPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  blueprintText: { color: colors.muted, fontSize: 15 },
  floorManageRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  floorDeleteBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  manageNote: { color: colors.error, textAlign: "center", marginTop: spacing.sm },
  manageDone: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  manageDoneText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
