export const colors = {
  background: "#1D376A",
  primary: "#e06737",
  accent: "#e06737",
  card: "#f0f4f8",
  text: "#111111",
  textMuted: "#555555",
  border: "#2d4a7a",
  /** Text na modrom pozadí (header, status) – kvôli čitateľnosti */
  textOnDark: "#ffffff",
  /** Error/destructive actions (e.g. leave project, remove) */
  error: "#dc3545",
  /** Team / secondary accent (e.g. calendar dots for team entries) */
  teamAccent: "#4a9fd9",
  /**
   * Light panels for forms on dark `background` (Equipment tab, etc.).
   * Use with `text` for field values — not `textOnDark`.
   */
  formPanel: "#f0f4f8",
  formPanelBorder: "#8fa4bf",
  /** Section labels on dark backgrounds */
  labelOnDark: "#ffffff",
  labelMutedOnDark: "rgba(255,255,255,0.78)",
  /** Subtitle / helper copy on dark onboarding shell (readable vs `textMuted` on blue) */
  onboardingHelperOnDark: "rgba(255,255,255,0.88)",
  /** Placeholder on light input rows (`formPanel` / `card`) — darker than body for legibility */
  inputPlaceholderOnLight: "#5c6674",
  /** Inactive chip on dark (outline style) */
  chipOnDarkBg: "rgba(255,255,255,0.12)",
  chipOnDarkBorder: "rgba(255,255,255,0.38)",
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
export const radius = 16;
