import { Linking, Platform, Alert } from 'react-native';

/**
 * Open coordinates (lat, lng) in external maps app.
 * Used for time tracking check-in/check-out locations.
 * Uses Google Maps Search URL to show a pin at the exact coordinates (geo: URI does not show a pin).
 */
export async function openLatLngInMaps(lat: number, lng: number): Promise<void> {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    return;
  }
  const query = `${lat},${lng}`;
  const googleMapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  const appleMapsUrl = `http://maps.apple.com/?ll=${lat},${lng}`;
  try {
    if (Platform.OS === 'android') {
      await Linking.openURL(googleMapsSearchUrl);
      return;
    }
    if (await Linking.canOpenURL(appleMapsUrl)) {
      await Linking.openURL(appleMapsUrl);
      return;
    }
    await Linking.openURL(googleMapsSearchUrl);
  } catch (error) {
    console.error('[maps] Error opening maps:', error);
    Alert.alert('Chyba', 'Nepodarilo sa otvoriť mapy.');
  }
}

/**
 * Open address in external maps app
 * Prefers Google Maps, falls back to Apple Maps on iOS if Google Maps is not available
 * 
 * @param addressText - The address string to search for
 */
export async function openInMaps(addressText: string): Promise<void> {
  if (!addressText || !addressText.trim()) {
    Alert.alert('Chyba', 'Adresa nie je zadaná.');
    return;
  }

  // Encode address for URL
  const encodedAddress = encodeURIComponent(addressText.trim());

  // Google Maps web search URL (works as browser fallback)
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
  const googleMapsSchemeUrl = `comgooglemaps://?q=${encodedAddress}`;
  const androidGeoUrl = `geo:0,0?q=${encodedAddress}`;
  const androidNavigationUrl = `google.navigation:q=${encodedAddress}`;

  // Apple Maps URL (iOS only)
  const appleMapsUrl = `http://maps.apple.com/?q=${encodedAddress}`;

  try {
    if (Platform.OS === "android") {
      if (await Linking.canOpenURL(androidNavigationUrl)) {
        await Linking.openURL(androidNavigationUrl);
        return;
      }
      if (await Linking.canOpenURL(androidGeoUrl)) {
        await Linking.openURL(androidGeoUrl);
        return;
      }
      // Final fallback for emulator: browser web maps.
      await Linking.openURL(googleMapsUrl);
      return;
    }

    if (await Linking.canOpenURL(googleMapsSchemeUrl)) {
      await Linking.openURL(googleMapsSchemeUrl);
      return;
    }
    if (await Linking.canOpenURL(appleMapsUrl)) {
      await Linking.openURL(appleMapsUrl);
      return;
    }

    // Final iOS fallback: open maps in browser.
    await Linking.openURL(googleMapsUrl);
  } catch (error) {
    console.error('[maps] Error opening maps:', error);
    Alert.alert(
      'Chyba',
      'Nepodarilo sa otvoriť mapy. Skúste to znova alebo nainštalujte mapovú aplikáciu v emulátore.'
    );
  }
}
