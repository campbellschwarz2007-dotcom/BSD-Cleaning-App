import React, { useEffect, useState } from "react";
import { Text, StyleSheet, View, Pressable, Platform } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
} from "react-native-reanimated";

import { colors, radius, statusColor, statusTextColor, shadow } from "@/src/theme";

type SavePatch = { x: number; y: number; width: number; height: number };

function DraggablePin({
  room,
  scale,
  editMode,
  panRef,
  onOpenRoom,
  onSaveRoom,
}: {
  room: any;
  scale: Animated.SharedValue<number>;
  editMode: boolean;
  panRef: React.MutableRefObject<any>;
  onOpenRoom: (room: any) => void;
  onSaveRoom: (roomId: string, patch: SavePatch) => void;
}) {
  const x = useSharedValue(room.x);
  const y = useSharedValue(room.y);
  const w = useSharedValue(room.width);
  const h = useSharedValue(room.height);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const sw = useSharedValue(0);
  const sh = useSharedValue(0);

  useEffect(() => {
    x.value = room.x;
    y.value = room.y;
    w.value = room.width;
    h.value = room.height;
  }, [room.x, room.y, room.width, room.height]);

  const openJS = () => onOpenRoom(room);
  const saveJS = () =>
    onSaveRoom(room.id, {
      x: Math.max(0, Math.round(x.value)),
      y: Math.max(0, Math.round(y.value)),
      width: Math.round(w.value),
      height: Math.round(h.value),
    });

  const tap = Gesture.Tap()
    .maxDuration(260)
    .onEnd(() => {
      runOnJS(openJS)();
    });

  const drag = Gesture.Pan()
    .enabled(editMode)
    .blocksExternalGesture(panRef)
    .onStart(() => {
      sx.value = x.value;
      sy.value = y.value;
    })
    .onUpdate((e) => {
      x.value = sx.value + e.translationX / scale.value;
      y.value = sy.value + e.translationY / scale.value;
    })
    .onEnd(() => {
      runOnJS(saveJS)();
    });

  const resize = Gesture.Pan()
    .enabled(editMode)
    .blocksExternalGesture(panRef)
    .onStart(() => {
      sw.value = w.value;
      sh.value = h.value;
    })
    .onUpdate((e) => {
      w.value = Math.max(20, sw.value + e.translationX / scale.value);
      h.value = Math.max(16, sh.value + e.translationY / scale.value);
    })
    .onEnd(() => {
      runOnJS(saveJS)();
    });

  const pinGesture = editMode ? Gesture.Exclusive(drag, tap) : tap;

  const rot = room.rotation || 0;
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const isRed = !!room.teacher_today;
  const bg = isRed ? colors.status_teacher_in : statusColor(room.status);
  const fg = isRed ? "#FFFFFF" : statusTextColor(room.status);
  const fontSize = room.font_size || 12;

  const pinStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { rotate: `${rot}deg` },
    ],
    width: w.value,
    height: h.value,
  }));

  const handleStyle = useAnimatedStyle(() => {
    // position at the pin's (possibly rotated) bottom-right corner
    const cx = x.value + w.value / 2;
    const cy = y.value + h.value / 2;
    const dx = w.value / 2;
    const dy = h.value / 2;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return {
      transform: [
        { translateX: cx + rx - 13 },
        { translateY: cy + ry - 13 },
      ],
    };
  });

  return (
    <>
      <GestureDetector gesture={pinGesture}>
        <Animated.View
          testID={`room-pin-${room.id}`}
          style={[
            styles.pin,
            pinStyle,
            { backgroundColor: bg },
            editMode && styles.pinEditing,
          ]}
        >
          <Text
            numberOfLines={2}
            style={[styles.pinText, { color: fg, fontSize }]}
          >
            {room.name}
          </Text>
        </Animated.View>
      </GestureDetector>

      {editMode && (
        <GestureDetector gesture={resize}>
          <Animated.View testID={`resize-${room.id}`} style={[styles.handle, handleStyle]} />
        </GestureDetector>
      )}
    </>
  );
}

export default function FloorCanvas({
  rooms,
  blueprintUri,
  editMode,
  onOpenRoom,
  onSaveRoom,
}: {
  rooms: any[];
  blueprintUri: string;
  editMode: boolean;
  onOpenRoom: (room: any) => void;
  onSaveRoom: (roomId: string, patch: SavePatch) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const savedOx = useSharedValue(0);
  const savedOy = useSharedValue(0);
  const panRef = React.useRef<any>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ iw: 0, ih: 0 });

  // Content is laid out at the blueprint's natural aspect ratio: full width,
  // height proportional to the image (so tall blueprints become scrollable).
  const baseW = size.w;
  const ratio = natural.iw ? natural.ih / natural.iw : 0;
  const baseH = ratio ? size.w * ratio : size.h;

  // Recenter / top-align whenever the surface or blueprint changes.
  useEffect(() => {
    if (!size.w) return;
    scale.value = 1;
    savedScale.value = 1;
    const ny = baseH <= size.h ? (size.h - baseH) / 2 : 0;
    ox.value = 0;
    oy.value = ny;
    savedOx.value = 0;
    savedOy.value = ny;
  }, [size.w, size.h, natural.iw, natural.ih, blueprintUri]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = savedScale.value * e.scale;
      const s = Math.min(4, Math.max(1, next));
      scale.value = s;
      const scaledW = baseW * s;
      const scaledH = baseH * s;
      ox.value =
        scaledW <= size.w
          ? (size.w - scaledW) / 2
          : Math.min(0, Math.max(size.w - scaledW, ox.value));
      oy.value =
        scaledH <= size.h
          ? (size.h - scaledH) / 2
          : Math.min(0, Math.max(size.h - scaledH, oy.value));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedOx.value = ox.value;
      savedOy.value = oy.value;
    });

  const pan = Gesture.Pan()
    .withRef(panRef)
    .averageTouches(true)
    .onUpdate((e) => {
      const s = scale.value;
      const scaledW = baseW * s;
      const scaledH = baseH * s;
      let nx = savedOx.value + e.translationX;
      let ny = savedOy.value + e.translationY;
      nx = scaledW <= size.w ? (size.w - scaledW) / 2 : Math.min(0, Math.max(size.w - scaledW, nx));
      ny = scaledH <= size.h ? (size.h - scaledH) / 2 : Math.min(0, Math.max(size.h - scaledH, ny));
      ox.value = nx;
      oy.value = ny;
    })
    .onEnd(() => {
      savedOx.value = ox.value;
      savedOy.value = oy.value;
    });

  const composed = Gesture.Simultaneous(pinch, pan);

  const zoomBy = (factor: number) => {
    const s = Math.min(4, Math.max(1, savedScale.value * factor));
    scale.value = s;
    savedScale.value = s;
    const scaledW = baseW * s;
    const scaledH = baseH * s;
    const nx =
      scaledW <= size.w
        ? (size.w - scaledW) / 2
        : Math.min(0, Math.max(size.w - scaledW, ox.value));
    const ny =
      scaledH <= size.h
        ? (size.h - scaledH) / 2
        : Math.min(0, Math.max(size.h - scaledH, oy.value));
    ox.value = nx;
    oy.value = ny;
    savedOx.value = nx;
    savedOy.value = ny;
  };

  const contentStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: ox.value + (baseW / 2) * (scale.value - 1) },
      { translateY: oy.value + (baseH / 2) * (scale.value - 1) },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        style={styles.viewport}
        onLayout={(e) =>
          setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
        }
      >
        {size.w > 0 && (
          <Animated.View
            style={[styles.content, { width: baseW, height: baseH }, contentStyle]}
          >
            <Image
              source={{ uri: blueprintUri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              onLoad={(e) => {
                const src: any = e.source;
                if (src?.width && src?.height) setNatural({ iw: src.width, ih: src.height });
              }}
            />
            <Animated.View style={styles.tint} pointerEvents="none" />
            {rooms.map((room) => (
              <DraggablePin
                key={room.id}
                room={room}
                scale={scale}
                editMode={editMode}
                panRef={panRef}
                onOpenRoom={onOpenRoom}
                onSaveRoom={onSaveRoom}
              />
            ))}
          </Animated.View>
        )}

        {Platform.OS === "web" && size.w > 0 && (
          <View style={styles.zoomControls} pointerEvents="box-none">
            <Pressable
              testID="zoom-in-btn"
              onPress={() => zoomBy(1.25)}
              style={styles.zoomBtn}
            >
              <Ionicons name="add" size={22} color={colors.onSurface} />
            </Pressable>
            <Pressable
              testID="zoom-out-btn"
              onPress={() => zoomBy(0.8)}
              style={styles.zoomBtn}
            >
              <Ionicons name="remove" size={22} color={colors.onSurface} />
            </Pressable>
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: "hidden", backgroundColor: "#c9ced6" },
  content: { position: "relative" },
  tint: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255,255,255,0.18)" },
  pin: {
    position: "absolute",
    left: 0,
    top: 0,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.85)",
    ...shadow.card,
  },
  pinEditing: { borderStyle: "dashed", borderColor: "#111" },
  pinText: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  handle: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: colors.brandPrimary,
    ...shadow.card,
  },
  zoomControls: {
    position: "absolute",
    right: 12,
    bottom: 12,
    gap: 8,
  },
  zoomBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
});
