// Central design tokens derived from /app/design_guidelines.json (light theme, iOS-native clean).
export const colors = {
  surface: "#FFFFFF",
  onSurface: "#111827",
  surfaceSecondary: "#F2F2F7",
  onSurfaceSecondary: "#374151",
  surfaceTertiary: "#E5E5EA",
  onSurfaceTertiary: "#4B5563",
  surfaceInverse: "#1C1C1E",
  onSurfaceInverse: "#FFFFFF",
  brand: "#E41C38",
  brandPrimary: "#E41C38",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#FDE8EA",
  onBrandSecondary: "#9B1326",
  brandTertiary: "#F9D2D7",
  onBrandTertiary: "#E41C38",
  success: "#34C759",
  onSuccess: "#FFFFFF",
  warning: "#FFCC00",
  onWarning: "#111827",
  error: "#FF3B30",
  onError: "#FFFFFF",
  info: "#8E8E93",
  border: "#E5E5EA",
  borderStrong: "#C7C7CC",
  divider: "#E5E5EA",
  muted: "#8E8E93",
  // floor plan status colors
  status_untouched: "#8E8E93",
  status_teacher_in: "#FF3B30",
  status_in_progress: "#FFCC00",
  status_completed: "#34C759",
};

export const statusColor = (status: string) => {
  switch (status) {
    case "completed":
      return colors.status_completed;
    case "in_progress":
      return colors.status_in_progress;
    case "teacher_in":
      return colors.status_teacher_in;
    default:
      return colors.status_untouched;
  }
};

export const statusLabel = (status: string) => {
  switch (status) {
    case "completed":
      return "Completed";
    case "in_progress":
      return "In Progress";
    case "teacher_in":
      return "Teacher In";
    default:
      return "Untouched";
  }
};

export const statusTextColor = (status: string) => {
  return status === "in_progress" ? colors.onWarning : "#FFFFFF";
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };

export const font = {
  regular: { fontWeight: "400" as const },
  medium: { fontWeight: "600" as const },
  bold: { fontWeight: "700" as const },
  heavy: { fontWeight: "800" as const },
};

export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
};
