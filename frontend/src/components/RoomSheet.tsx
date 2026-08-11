import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Linking,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, User } from "@/src/api";
import { pickImageAsDataUri } from "@/src/utils/pickImage";
import { colors, radius, spacing, statusColor, statusLabel } from "@/src/theme";
import { StatusPill } from "@/src/components/ui";

const STATUSES = ["untouched", "teacher_in", "in_progress", "completed"];

export default function RoomSheet({
  room,
  visible,
  onClose,
  onChanged,
  editMode,
  user,
}: {
  room: any;
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
  editMode: boolean;
  user: User;
}) {
  const insets = useSafeAreaInsets();
  const [memos, setMemos] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [visits, setVisits] = useState<any[]>([]);
  const [cleaners, setCleaners] = useState<any[]>([]);
  const [memoText, setMemoText] = useState("");
  const [newItem, setNewItem] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const role = user.role;
  const isStructure = room && (room.type === "stairs" || room.type === "hallway");

  const load = useCallback(async () => {
    if (!room) return;
    try {
      const [m, t, v] = await Promise.all([
        api.memos(room.id),
        api.tasks({ room_id: room.id }),
        api.visits({ room_id: room.id }),
      ]);
      setMemos(m);
      setTasks(t);
      setVisits(v);
      if (role === "boss" || role === "admin") {
        const c = await api.users("cleaner");
        setCleaners(c);
      }
    } catch {}
  }, [room, role]);

  useEffect(() => {
    if (visible && room) {
      setMemoText("");
      setNewItem("");
      setTaskTitle("");
      setAssignees([]);
      setNote("");
      load();
    }
  }, [visible, room?.id]);

  if (!room) return null;

  const setStatus = async (status: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await api.setRoomStatus(room.id, status);
    onChanged();
  };

  const addPhoto = async () => {
    const res = await pickImageAsDataUri();
    if (!res) return;
    if ("error" in res) {
      if (res.error === "settings") {
        setNote("Photo access is blocked. Open Settings to allow it.");
      } else {
        setNote("Couldn't access photos.");
      }
      return;
    }
    setBusy(true);
    try {
      await api.addRoomPhoto(room.id, res.dataUri);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = async (index: number) => {
    await api.deleteRoomPhoto(room.id, index);
    onChanged();
  };

  const toggleCheck = async (itemId: string) => {
    Haptics.selectionAsync();
    await api.toggleChecklist(room.id, itemId);
    await onChanged();
  };
  const addChecklistItem = async () => {
    if (!newItem.trim()) return;
    setBusy(true);
    try {
      await api.addChecklistItem(room.id, newItem.trim());
      setNewItem("");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };
  const removeChecklistItem = async (itemId: string) => {
    await api.deleteChecklistItem(room.id, itemId);
    await onChanged();
  };

  const addMemo = async () => {
    if (!memoText.trim()) return;
    setBusy(true);
    try {
      await api.addMemo(room.id, memoText.trim());
      setMemoText("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const createTask = async () => {
    if (!taskTitle.trim() || assignees.length === 0) return;
    setBusy(true);
    try {
      await api.createTask({
        title: taskTitle.trim(),
        room_id: room.id,
        assigned_to: assignees,
      });
      setTaskTitle("");
      setAssignees([]);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const completeTask = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await api.completeTask(id);
    await load();
    onChanged();
  };

  const redoTask = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await api.redoTask(id);
    await load();
  };

  const toggleVisit = async (dateStr: string) => {
    Haptics.selectionAsync();
    await api.addVisit(room.id, dateStr);
    await load();
    onChanged();
  };

  const deleteRoom = async () => {
    await api.deleteRoom(room.id);
    onChanged();
    onClose();
  };

  const canAddPhoto = role === "cleaner" || role === "boss" || role === "admin";
  const myVisits = visits.filter((v) => v.teacher_id === user.id).map((v) => v.date);
  const allVisitDates = new Set(visits.map((v) => v.date));
  const todayD = dayjs().startOf("day");
  const gridStart = todayD.startOf("week");
  const calendarCells = Array.from({ length: 21 }, (_, i) => gridStart.add(i, "day"));
  const weekdayLabels = ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.sheetWrap}
        >
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} testID="room-sheet-title">
                  {room.name}
                </Text>
                <Text style={styles.subtitle}>{room.type}</Text>
              </View>
              <StatusPill status={room.status} />
              <Pressable onPress={onClose} testID="room-sheet-close" style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView
              style={{ maxHeight: 520 }}
              contentContainerStyle={{ paddingBottom: spacing.xl }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* ADMIN EDIT MODE */}
              {editMode && role === "admin" ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Edit element</Text>
                  <Text style={styles.label}>Name</Text>
                  <TextInput
                    testID="edit-room-name"
                    style={styles.input}
                    defaultValue={room.name}
                    onEndEditing={(e) =>
                      api.updateRoom(room.id, { name: e.nativeEvent.text }).then(onChanged)
                    }
                  />
                  <Text style={styles.label}>Type</Text>
                  <View style={styles.chipRow}>
                    {["room", "hallway", "stairs", "entryway"].map((t) => (
                      <Pressable
                        key={t}
                        testID={`edit-type-${t}`}
                        onPress={() => api.updateRoom(room.id, { type: t }).then(onChanged)}
                        style={[styles.chip, room.type === t && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, room.type === t && styles.chipTextActive]}>
                          {t}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.dragHint}>
                    <Ionicons name="move" size={16} color={colors.brandPrimary} />
                    <Text style={styles.dragHintText}>
                      Drag the box on the map to move it, and pull its bottom-right corner to resize.
                    </Text>
                  </View>
                  <Pressable testID="delete-room" onPress={deleteRoom} style={styles.deleteBtn}>
                    <Ionicons name="trash" size={18} color={colors.error} />
                    <Text style={styles.deleteText}>Delete element</Text>
                  </Pressable>
                </View>
              ) : null}

              {/* STATUS CONTROLS */}
              {!editMode && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Status</Text>
                  <View style={styles.chipRow}>
                    {STATUSES.filter((s) => {
                      if (role === "cleaner") return s !== "teacher_in";
                      if (role === "teacher") return s === "teacher_in" || s === "untouched";
                      return true;
                    }).map((s) => (
                      <Pressable
                        key={s}
                        testID={`set-status-${s}`}
                        onPress={() => setStatus(s)}
                        style={[
                          styles.statusChoice,
                          { borderColor: statusColor(s) },
                          room.status === s && { backgroundColor: statusColor(s) },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusChoiceText,
                            room.status === s && { color: s === "in_progress" ? "#111" : "#fff" },
                          ]}
                        >
                          {statusLabel(s)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              {/* CHECKLIST (hidden for teachers) */}
              {!editMode && role !== "teacher" && (
                <View style={styles.section}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.sectionTitle}>Checklist</Text>
                    <Text style={styles.muted}>
                      {(room.checklist || []).filter((i: any) => i.done).length}/
                      {(room.checklist || []).length}
                    </Text>
                  </View>
                  {(room.checklist || []).map((it: any) => (
                    <Pressable
                      key={it.id}
                      testID={`check-${it.id}`}
                      onPress={() => toggleCheck(it.id)}
                      style={styles.checkRow}
                    >
                      <Ionicons
                        name={it.done ? "checkbox" : "square-outline"}
                        size={22}
                        color={it.done ? colors.success : colors.muted}
                      />
                      <Text style={[styles.checkText, it.done && styles.checkDone]}>{it.text}</Text>
                      {role === "admin" && (
                        <Pressable
                          testID={`check-del-${it.id}`}
                          onPress={() => removeChecklistItem(it.id)}
                          hitSlop={8}
                        >
                          <Ionicons name="close" size={16} color={colors.muted} />
                        </Pressable>
                      )}
                    </Pressable>
                  ))}
                  <View style={styles.inlineInputRow}>
                    <TextInput
                      testID="checklist-input"
                      style={[styles.input, { flex: 1, marginBottom: 0 }]}
                      placeholder="Add checklist item…"
                      placeholderTextColor={colors.muted}
                      value={newItem}
                      onChangeText={setNewItem}
                    />
                    <Pressable testID="checklist-add" onPress={addChecklistItem} style={styles.sendBtn}>
                      <Ionicons name="add" size={20} color="#fff" />
                    </Pressable>
                  </View>
                </View>
              )}

              {/* PHOTOS (not for structure-only elements; hidden for teachers) */}
              {!isStructure && !editMode && role !== "teacher" && (
                <View style={styles.section}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.sectionTitle}>Photos</Text>
                    {canAddPhoto && (
                      <Pressable testID="add-room-photo" onPress={addPhoto} style={styles.addLink}>
                        <Ionicons name="camera" size={16} color={colors.brandPrimary} />
                        <Text style={styles.addLinkText}>Add</Text>
                      </Pressable>
                    )}
                  </View>
                  {room.photos?.length ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {room.photos.map((p: string, i: number) => (
                        <View key={i} style={styles.photoWrap}>
                          <Image source={{ uri: p }} style={styles.photo} contentFit="cover" />
                          {canAddPhoto && (
                            <Pressable
                              onPress={() => removePhoto(i)}
                              style={styles.photoDelete}
                              testID={`delete-photo-${i}`}
                            >
                              <Ionicons name="close" size={14} color="#fff" />
                            </Pressable>
                          )}
                        </View>
                      ))}
                    </ScrollView>
                  ) : (
                    <Text style={styles.muted}>No photos yet.</Text>
                  )}
                </View>
              )}

              {/* MEMOS */}
              {!editMode && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Memos</Text>
                  {memos.length === 0 && <Text style={styles.muted}>No notes yet.</Text>}
                  {memos.map((m) => (
                    <View key={m.id} style={styles.memo}>
                      <View style={styles.rowBetween}>
                        <Text style={styles.memoAuthor}>
                          {m.author_name} · {m.author_role}
                        </Text>
                        <Text style={styles.memoDate}>{dayjs(m.created_at).format("MMM D")}</Text>
                      </View>
                      <Text style={styles.memoText}>{m.text}</Text>
                    </View>
                  ))}
                  <View style={styles.inlineInputRow}>
                    <TextInput
                      testID="memo-input"
                      style={[styles.input, { flex: 1, marginBottom: 0 }]}
                      placeholder="Add a note…"
                      placeholderTextColor={colors.muted}
                      value={memoText}
                      onChangeText={setMemoText}
                    />
                    <Pressable testID="memo-send" onPress={addMemo} style={styles.sendBtn}>
                      <Ionicons name="arrow-up" size={18} color="#fff" />
                    </Pressable>
                  </View>
                </View>
              )}

              {/* TEACHER VISITS CALENDAR */}
              {!editMode && !isStructure && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    {role === "teacher" ? "Book this room (Teacher In)" : "Teacher coming in"}
                  </Text>

                  <View style={styles.weekHeader}>
                    {weekdayLabels.map((w, i) => (
                      <Text key={i} style={styles.weekdayLabel}>
                        {w}
                      </Text>
                    ))}
                  </View>
                  <View style={styles.calendarGrid}>
                    {calendarCells.map((d) => {
                      const ds = d.format("YYYY-MM-DD");
                      const diff = d.startOf("day").diff(todayD, "day");
                      const bookableByMe = role === "teacher" && diff >= 3;
                      const mine = myVisits.includes(ds);
                      const booked = allVisitDates.has(ds);
                      const isToday = diff === 0;
                      const locked = role === "teacher" && diff < 3;
                      return (
                        <Pressable
                          key={ds}
                          testID={`cal-${ds}`}
                          disabled={!bookableByMe}
                          onPress={() => bookableByMe && toggleVisit(ds)}
                          style={[
                            styles.dayCell,
                            mine && styles.dayCellMine,
                            !mine && booked && styles.dayCellBooked,
                            locked && styles.dayCellLocked,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dayNum,
                              (mine || (booked && !mine)) && { color: "#fff" },
                              locked && { color: colors.borderStrong },
                              isToday && !mine && !booked && { color: colors.brandPrimary, fontWeight: "800" },
                            ]}
                          >
                            {d.date()}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {role === "teacher" ? (
                    <Text style={styles.hint}>
                      You can only book a room at least 3 days in advance. Booking turns the room red.
                    </Text>
                  ) : visits.length ? (
                    <View style={{ marginTop: spacing.sm }}>
                      {visits.map((v) => (
                        <Text key={v.id} style={styles.memoText}>
                          {v.teacher_name} · {dayjs(v.date).format("ddd, MMM D")}
                        </Text>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.muted}>No visits scheduled.</Text>
                  )}
                </View>
              )}

              {/* TASKS */}
              {!editMode && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Tasks</Text>
                  {tasks.length === 0 && <Text style={styles.muted}>No tasks for this element.</Text>}
                  {tasks.map((t) => (
                    <View key={t.id} style={styles.task}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.taskTitle}>{t.title}</Text>
                        <Text style={styles.taskMeta}>
                          {t.status === "completed"
                            ? `Done by ${t.completed_by_name}`
                            : t.status === "redo"
                            ? "Redo requested"
                            : "Pending"}
                        </Text>
                      </View>
                      {role === "cleaner" && t.status !== "completed" && (
                        <Pressable
                          testID={`complete-task-${t.id}`}
                          onPress={() => completeTask(t.id)}
                          style={styles.taskBtn}
                        >
                          <Text style={styles.taskBtnText}>Done</Text>
                        </Pressable>
                      )}
                      {(role === "boss" || role === "admin") && t.status === "completed" && (
                        <Pressable
                          testID={`redo-task-${t.id}`}
                          onPress={() => redoTask(t.id)}
                          style={[styles.taskBtn, { backgroundColor: colors.warning }]}
                        >
                          <Text style={[styles.taskBtnText, { color: "#111" }]}>Redo</Text>
                        </Pressable>
                      )}
                    </View>
                  ))}

                  {(role === "boss" || role === "admin") && (
                    <View style={styles.assignBox}>
                      <TextInput
                        testID="task-title-input"
                        style={styles.input}
                        placeholder="New task title…"
                        placeholderTextColor={colors.muted}
                        value={taskTitle}
                        onChangeText={setTaskTitle}
                      />
                      <Text style={styles.label}>Assign to</Text>
                      <View style={styles.chipRow}>
                        {cleaners.map((c) => {
                          const on = assignees.includes(c.id);
                          return (
                            <Pressable
                              key={c.id}
                              testID={`assignee-${c.id}`}
                              onPress={() =>
                                setAssignees((prev) =>
                                  on ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                                )
                              }
                              style={[styles.chip, on && styles.chipActive]}
                            >
                              <Text style={[styles.chipText, on && styles.chipTextActive]}>
                                {c.name}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <Pressable
                        testID="create-task-btn"
                        onPress={createTask}
                        disabled={!taskTitle.trim() || assignees.length === 0}
                        style={[
                          styles.assignBtn,
                          (!taskTitle.trim() || assignees.length === 0) && { opacity: 0.5 },
                        ]}
                      >
                        <Text style={styles.assignBtnText}>Assign task</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              )}

              {note ? (
                <Pressable onPress={() => Linking.openSettings()} style={styles.noteBanner}>
                  <Text style={styles.noteText}>{note}</Text>
                </Pressable>
              ) : null}
            </ScrollView>

            {busy && (
              <View style={styles.busyOverlay}>
                <ActivityIndicator color={colors.brandPrimary} />
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheetWrap: { justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  title: { fontSize: 22, fontWeight: "800", color: colors.onSurface },
  subtitle: { fontSize: 13, color: colors.muted, textTransform: "capitalize" },
  closeBtn: { padding: 4 },
  section: { paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.sm },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 6 },
  muted: { color: colors.muted, fontSize: 14 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 6, fontStyle: "italic" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
  },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceSecondary, textTransform: "capitalize" },
  chipTextActive: { color: "#fff" },
  statusChoice: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  statusChoiceText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  addLink: { flexDirection: "row", alignItems: "center", gap: 4 },
  addLinkText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 14 },
  photoWrap: { marginRight: spacing.sm },
  photo: { width: 120, height: 120, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  photoDelete: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  memo: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  memoAuthor: { fontSize: 12, fontWeight: "700", color: colors.brandPrimary, textTransform: "capitalize" },
  memoDate: { fontSize: 12, color: colors.muted },
  memoText: { fontSize: 14, color: colors.onSurface, marginTop: 4 },
  inlineInputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  task: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  taskTitle: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  taskMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  taskBtn: {
    backgroundColor: colors.success,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  taskBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  assignBox: { marginTop: spacing.sm },
  assignBtn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  assignBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  nudgeGrid: { marginTop: spacing.sm, gap: spacing.sm },
  nudgeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  nudgeLabel: { fontSize: 14, color: colors.onSurface, fontWeight: "600" },
  nudgeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.brandSecondary,
  },
  deleteText: { color: colors.error, fontWeight: "700", fontSize: 15 },
  noteBanner: {
    backgroundColor: colors.brandSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  noteText: { color: colors.onBrandSecondary, fontSize: 13, textAlign: "center" },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  weekHeader: { flexDirection: "row", marginBottom: 4 },
  weekdayLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "700",
    color: colors.muted,
  },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  dayCellMine: { backgroundColor: colors.status_teacher_in },
  dayCellBooked: { backgroundColor: colors.info },
  dayCellLocked: { opacity: 0.55 },
  dayNum: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  dragHint: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: colors.brandSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  dragHintText: { flex: 1, color: colors.onBrandSecondary, fontSize: 13, lineHeight: 18 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 7 },
  checkText: { flex: 1, fontSize: 15, color: colors.onSurface },
  checkDone: { textDecorationLine: "line-through", color: colors.muted },
});
