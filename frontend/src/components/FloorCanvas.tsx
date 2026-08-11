import React, { useEffect, useState } from "react";
import { Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

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
      w.value = Math.max(56, sw.value + e.translationX / scale.value);
      h.value = Math.max(34, sh.value + e.translationY / scale.value);
    })
    .onEnd(() => {
      runOnJS(saveJS)();
    });

  const pinGesture = Gesture.Exclusive(drag, tap);

  const pinStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
    width: w.value,
    height: h.value,
  }));

  const handleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value + w.value - 13 },
      { translateY: y.value + h.value - 13 },
    ],
  }));

  return (
    <>
      <GestureDetector gesture={pinGesture}>
        <Animated.View
          testID={`room-pin-${room.id}`}
          style={[
            styles.pin,
            pinStyle,
            { backgroundColor: statusColor(room.status) },
            editMode && styles.pinEditing,
          ]}
        >
          <Text
            numberOfLines={2}
            style={[styles.pinText, { color: statusTextColor(room.status) }]}
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
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const panRef = React.useRef<any>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const buzz = () => Haptics.selectionAsync();

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = savedScale.value * e.scale;
      scale.value = Math.min(4, Math.max(1, next));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.02) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .withRef(panRef)
    .averageTouches(true)
    .onUpdate((e) => {
      if (scale.value > 1) {
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
      } else {
        scale.value = withTiming(2);
        savedScale.value = 2;
      }
      runOnJS(buzz)();
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
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
        <Animated.View
          style={[styles.content, { width: size.w, height: size.h }, contentStyle]}
        >
          <Image source={{ uri: blueprintUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <Animated.View style={styles.tint} pointerEvents="none" />
          {size.w > 0 &&
            rooms.map((room) => (
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
});
