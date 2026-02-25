/**
 * Per-device flag for "Create your first project" prompt.
 * Prevents modal from showing repeatedly after user taps "Later".
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const FIRST_PROJECT_PROMPT_SHOWN_KEY = "first_project_prompt_shown";

export async function hasShownFirstProjectPrompt(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(FIRST_PROJECT_PROMPT_SHOWN_KEY);
    return value === "1";
  } catch {
    return true; // On error, assume shown to avoid repeated prompts
  }
}

export async function markFirstProjectPromptShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(FIRST_PROJECT_PROMPT_SHOWN_KEY, "1");
  } catch (e) {
    console.warn("[firstProjectPrompt] Failed to persist flag:", e);
  }
}

export async function clearFirstProjectPromptFlag(): Promise<void> {
  try {
    await AsyncStorage.removeItem(FIRST_PROJECT_PROMPT_SHOWN_KEY);
  } catch (e) {
    console.warn("[firstProjectPrompt] Failed to clear flag:", e);
  }
}
