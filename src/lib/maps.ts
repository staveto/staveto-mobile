import { Linking, Platform, Alert } from 'react-native';

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

  // Google Maps search URL (works on both iOS and Android)
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

  // Apple Maps URL (iOS only)
  const appleMapsUrl = `http://maps.apple.com/?q=${encodedAddress}`;

  try {
    // Try Google Maps first (works on both platforms)
    const canOpenGoogleMaps = await Linking.canOpenURL(googleMapsUrl);
    
    if (canOpenGoogleMaps) {
      await Linking.openURL(googleMapsUrl);
      return;
    }

    // Fallback to Apple Maps on iOS
    if (Platform.OS === 'ios') {
      const canOpenAppleMaps = await Linking.canOpenURL(appleMapsUrl);
      if (canOpenAppleMaps) {
        await Linking.openURL(appleMapsUrl);
        return;
      }
    }

    // If neither works, show error
    Alert.alert(
      'Chyba',
      'Nepodarilo sa otvoriť mapy. Skontrolujte, či máte nainštalovanú aplikáciu Google Maps alebo Apple Maps.'
    );
  } catch (error) {
    console.error('[maps] Error opening maps:', error);
    Alert.alert('Chyba', 'Nepodarilo sa otvoriť mapy. Skúste to znova.');
  }
}
