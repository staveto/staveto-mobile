/**
 * Job site location — text or map pick (web-aligned with JobSiteLocationField).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import MapView, { Marker, type MapPressEvent, type Region } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useI18n } from "../i18n/I18nContext";
import { spacing } from "../theme";
import {
  geocodeProjectAddress,
  getDefaultMapCenter,
  reverseGeocodeCoordinates,
  type ProjectCoordinates,
} from "../lib/projectLocation";
import { getCurrentPositionSafe, requestLocationPermission } from "../lib/location";

type LocationMode = "text" | "map";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onCoordinatesChange?: (coords: ProjectCoordinates | null) => void;
  countryCode?: string | null;
  placeholder?: string;
  editable?: boolean;
};

const ui = {
  navy: "#0F2A4D",
  orange: "#E06737",
  surface: "#FFFFFF",
  surfaceMuted: "#F6F8FB",
  border: "#D0D7E2",
  borderStrong: "#94A3B8",
  muted: "#64748B",
} as const;

function mapsAvailable(): boolean {
  if (Platform.OS === "ios") return true;
  if (Platform.OS !== "android") return false;
  return !!Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
}

function toRegion(center: ProjectCoordinates, zoomed: boolean): Region {
  const delta = zoomed ? 0.02 : 0.35;
  return {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };
}

export function JobSiteLocationField({
  value,
  onChange,
  onCoordinatesChange,
  countryCode,
  placeholder,
  editable = true,
}: Props) {
  const { t } = useI18n();
  const mapRef = useRef<MapView | null>(null);
  const [mode, setMode] = useState<LocationMode>("text");
  const defaultCenter = useMemo(() => getDefaultMapCenter(countryCode), [countryCode]);
  const [center, setCenter] = useState<ProjectCoordinates>(defaultCenter);
  const [marker, setMarker] = useState<ProjectCoordinates | null>(null);
  const [resolving, setResolving] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const canShowMap = mapsAvailable();

  useEffect(() => {
    setCenter(defaultCenter);
  }, [defaultCenter]);

  useEffect(() => {
    if (mode !== "map") return;
    const trimmed = value.trim();
    if (!trimmed) {
      setCenter(defaultCenter);
      return;
    }
    let cancelled = false;
    void geocodeProjectAddress(trimmed).then((coords) => {
      if (cancelled || !coords) return;
      setCenter(coords);
      setMarker(coords);
      mapRef.current?.animateToRegion(toRegion(coords, true), 350);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, value, defaultCenter]);

  const applyPick = useCallback(
    async (coords: ProjectCoordinates) => {
      setMarker(coords);
      setCenter(coords);
      onCoordinatesChange?.(coords);
      setResolving(true);
      setMapError(null);
      try {
        const label = await reverseGeocodeCoordinates(coords.lat, coords.lng);
        if (label) {
          onChange(label);
        } else {
          setMapError("reverse-failed");
        }
      } finally {
        setResolving(false);
      }
    },
    [onChange, onCoordinatesChange]
  );

  const onMapPress = useCallback(
    (e: MapPressEvent) => {
      if (!editable) return;
      const { latitude, longitude } = e.nativeEvent.coordinate;
      void applyPick({ lat: latitude, lng: longitude });
    },
    [applyPick, editable]
  );

  const useMyLocation = useCallback(async () => {
    if (!editable) return;
    setResolving(true);
    setMapError(null);
    try {
      const granted = await requestLocationPermission();
      if (!granted) {
        setMapError("permission");
        return;
      }
      const gps = await getCurrentPositionSafe();
      if (!gps) {
        setMapError("gps");
        return;
      }
      const coords = { lat: gps.lat, lng: gps.lng };
      mapRef.current?.animateToRegion(toRegion(coords, true), 350);
      await applyPick(coords);
    } finally {
      setResolving(false);
    }
  }, [applyPick, editable]);

  const resolvedPlaceholder =
    placeholder ?? t("createProject.simplified.locationPlaceholder");

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{t("createProject.simplified.location")}</Text>
        {canShowMap ? (
          <View style={styles.modeToggle} accessibilityRole="tablist">
            <TouchableOpacity
              style={[styles.modeBtn, mode === "text" && styles.modeBtnActive]}
              onPress={() => setMode("text")}
              disabled={!editable}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === "text" }}
            >
              <Ionicons
                name="text-outline"
                size={14}
                color={mode === "text" ? ui.navy : ui.muted}
              />
              <Text style={[styles.modeBtnText, mode === "text" && styles.modeBtnTextActive]}>
                {t("createProject.simplified.locationModeText")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === "map" && styles.modeBtnActive]}
              onPress={() => setMode("map")}
              disabled={!editable}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === "map" }}
            >
              <Ionicons
                name="map-outline"
                size={14}
                color={mode === "map" ? ui.navy : ui.muted}
              />
              <Text style={[styles.modeBtnText, mode === "map" && styles.modeBtnTextActive]}>
                {t("createProject.simplified.locationModeMap")}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {mode === "text" || !canShowMap ? (
        <View style={styles.inputWrap}>
          <Ionicons name="location-outline" size={20} color={ui.muted} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={(v) => {
              onChange(v);
              if (!v.trim()) onCoordinatesChange?.(null);
            }}
            placeholder={resolvedPlaceholder}
            placeholderTextColor={ui.muted}
            editable={editable}
          />
        </View>
      ) : (
        <View style={styles.mapBlock}>
          <Text style={styles.mapHint}>{t("createProject.simplified.locationMapHint")}</Text>
          <View style={styles.mapFrame}>
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={toRegion(center, !!marker)}
              onPress={onMapPress}
              showsUserLocation={false}
              showsMyLocationButton={false}
            >
              {marker ? (
                <Marker
                  coordinate={{ latitude: marker.lat, longitude: marker.lng }}
                  pinColor={ui.orange}
                />
              ) : null}
            </MapView>
            {resolving ? (
              <View style={styles.mapOverlay} pointerEvents="none">
                <ActivityIndicator color={ui.navy} size="large" />
              </View>
            ) : null}
          </View>

          <TouchableOpacity
            style={styles.myLocationBtn}
            onPress={() => void useMyLocation()}
            disabled={!editable || resolving}
            accessibilityRole="button"
          >
            <Ionicons name="navigate-outline" size={18} color={ui.orange} />
            <Text style={styles.myLocationText}>
              {t("createProject.simplified.locationUseMyLocation")}
            </Text>
          </TouchableOpacity>

          {value.trim() ? <Text style={styles.selectedAddress}>{value.trim()}</Text> : null}
          {mapError === "reverse-failed" ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {t("createProject.simplified.locationReverseGeocodeError")}
            </Text>
          ) : null}
          {mapError === "permission" || mapError === "gps" ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {t("createProject.simplified.locationGpsError")}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  label: { fontSize: 15, fontWeight: "700", color: ui.navy, flexShrink: 1 },
  modeToggle: {
    flexDirection: "row",
    backgroundColor: "#E2E8F0",
    borderRadius: 12,
    padding: 3,
    gap: 2,
  },
  modeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    minHeight: 36,
  },
  modeBtnActive: {
    backgroundColor: ui.surface,
  },
  modeBtnText: { fontSize: 12, fontWeight: "600", color: ui.muted },
  modeBtnTextActive: { color: ui.navy, fontWeight: "700" },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: ui.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: ui.borderStrong,
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  inputIcon: { marginRight: 8 },
  input: {
    flex: 1,
    fontSize: 16,
    color: ui.navy,
    paddingVertical: 12,
  },
  mapBlock: { gap: spacing.sm },
  mapHint: { fontSize: 13, color: ui.muted, lineHeight: 18 },
  mapFrame: {
    height: 220,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: ui.border,
    backgroundColor: ui.surfaceMuted,
  },
  map: { flex: 1 },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  myLocationBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: ui.border,
    backgroundColor: ui.surface,
    minHeight: 44,
  },
  myLocationText: { fontSize: 14, fontWeight: "700", color: ui.orange },
  selectedAddress: {
    fontSize: 14,
    fontWeight: "600",
    color: ui.navy,
    lineHeight: 20,
  },
  errorText: { fontSize: 13, fontWeight: "600", color: "#B42318" },
});
