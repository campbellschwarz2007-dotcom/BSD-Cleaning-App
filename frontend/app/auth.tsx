import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { colors, radius, spacing, shadow } from "@/src/theme";

type Role = "cleaner" | "teacher" | "boss" | "admin";

const ROLES: {
  key: Role;
  title: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "cleaner", title: "Cleaner", desc: "Tasks, chat & photo contest", icon: "sparkles" },
  { key: "teacher", title: "Teacher", desc: "Floor plan, notes & visits", icon: "school" },
  { key: "boss", title: "Boss", desc: "Assign tasks & oversee everything", icon: "briefcase" },
  { key: "admin", title: "Admin", desc: "Edit floor plans & settings", icon: "construct" },
];

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useAuth();
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<"name" | "pin">("name");
  const [hasPin, setHasPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const openRole = (r: Role) => {
    Haptics.selectionAsync();
    setRole(r);
    setName("");
    setPassword("");
    setPin("");
    setStep("name");
    setHasPin(false);
    setError("");
  };

  const closeSheet = () => {
    setRole(null);
    setStep("name");
    setPin("");
    setError("");
  };

  const needsName = role === "cleaner" || role === "teacher";
  const needsPassword = role === "boss" || role === "admin";

  // Step 1 for cleaner/teacher: look up whether this name already has a PIN.
  const continueToPin = async () => {
    if (!role || !name.trim()) return;
    setError("");
    setLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const status = await api.pinStatus({ role, name: name.trim() });
      setHasPin(!!status?.has_pin);
      setPin("");
      setStep("pin");
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!role) return;
    setError("");
    setLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const body: any = { role };
      if (needsName) {
        body.name = name.trim();
        body.pin = pin;
      }
      if (needsPassword) body.password = password;
      const user = await api.signin(body);
      if (!user?.id) {
        setError("Sign in failed — please try again.");
        return;
      }
      await signIn(user);
      closeSheet();
      router.replace("/(tabs)/floorplan");
    } catch (e: any) {
      setError(e.message || "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  const canContinue = name.trim().length > 0;
  const canSubmit = needsPassword
    ? password.length > 0
    : pin.length === 4;

  return (
    <LinearGradient
      colors={[colors.brandPrimary, "#B01126"]}
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + spacing["3xl"], paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandWrap}>
          <View style={styles.logoBadge}>
            <Ionicons name="flash" size={30} color={colors.brandPrimary} />
          </View>
          <Text style={styles.brandTitle}>Go Big Red</Text>
          <Text style={styles.brandSub}>Facility Cleaning Crew</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.pick}>Choose your profile</Text>
          {ROLES.map((r) => (
            <Pressable
              key={r.key}
              testID={`role-${r.key}`}
              style={({ pressed }) => [styles.roleCard, pressed && styles.pressed]}
              onPress={() => openRole(r.key)}
            >
              <View style={styles.roleIcon}>
                <Ionicons name={r.icon} size={22} color={colors.brandPrimary} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.roleTitle}>{r.title}</Text>
                <Text style={styles.roleDesc}>{r.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Modal
        visible={role !== null}
        transparent
        animationType="slide"
        onRequestClose={closeSheet}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalRoot}
        >
          <Pressable style={styles.backdrop} onPress={closeSheet} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>
              Sign in as {role ? role.charAt(0).toUpperCase() + role.slice(1) : ""}
            </Text>

            {needsName && step === "name" && (
              <TextInput
                testID="signin-name-input"
                style={styles.input}
                placeholder="Your name"
                placeholderTextColor={colors.muted}
                value={name}
                onChangeText={setName}
                autoFocus
                autoCapitalize="words"
                returnKeyType="next"
                onSubmitEditing={canContinue ? continueToPin : undefined}
              />
            )}

            {needsName && step === "pin" && (
              <>
                <Text style={styles.pinLabel}>
                  {hasPin
                    ? `Enter ${name.trim().split(" ")[0]}'s 4-digit PIN`
                    : "Create a 4-digit PIN"}
                </Text>
                {!hasPin && (
                  <Text style={styles.pinHint}>
                    Use this PIN to sign in next time — remember it.
                  </Text>
                )}
                <TextInput
                  testID="signin-pin-input"
                  style={[styles.input, styles.pinInput]}
                  placeholder="••••"
                  placeholderTextColor={colors.muted}
                  value={pin}
                  onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 4))}
                  autoFocus
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={4}
                  returnKeyType="done"
                  onSubmitEditing={canSubmit ? submit : undefined}
                />
              </>
            )}

            {needsPassword && (
              <TextInput
                testID="signin-password-input"
                style={styles.input}
                placeholder={role === "admin" ? "Admin password" : "Password"}
                placeholderTextColor={colors.muted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoFocus={role === "admin" || role === "boss"}
                returnKeyType="done"
                onSubmitEditing={canSubmit ? submit : undefined}
              />
            )}

            {error ? (
              <Text style={styles.error} testID="signin-error">
                {error}
              </Text>
            ) : null}

            {needsName && step === "name" ? (
              <Pressable
                testID="signin-continue"
                disabled={!canContinue || loading}
                onPress={continueToPin}
                style={[styles.submit, (!canContinue || loading) && styles.submitDisabled]}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitText}>Continue</Text>
                )}
              </Pressable>
            ) : (
              <Pressable
                testID="signin-submit"
                disabled={!canSubmit || loading}
                onPress={submit}
                style={[styles.submit, (!canSubmit || loading) && styles.submitDisabled]}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitText}>
                    {needsName && !hasPin ? "Set PIN & Continue" : "Continue"}
                  </Text>
                )}
              </Pressable>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: spacing.lg },
  brandWrap: { alignItems: "center", marginBottom: spacing["2xl"] },
  logoBadge: {
    width: 68,
    height: 68,
    borderRadius: 20,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  brandTitle: { fontSize: 30, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },
  brandSub: { fontSize: 15, color: "rgba(255,255,255,0.85)", marginTop: 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.card,
  },
  pick: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  roleCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  pressed: { opacity: 0.7 },
  roleIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  roleTitle: { fontSize: 17, fontWeight: "700", color: colors.onSurface },
  roleDesc: { fontSize: 13, color: colors.muted, marginTop: 1 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
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
  pinLabel: { fontSize: 15, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.xs },
  pinHint: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  pinInput: { textAlign: "center", letterSpacing: 12, fontSize: 22, fontWeight: "700" },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.onSurface,
    marginBottom: spacing.md,
  },
  error: { color: colors.error, fontSize: 14, marginBottom: spacing.sm },
  submit: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
