/**
 * Versioned Onboarding System
 *
 * Uses APP_VERSION from the application to track which onboarding features
 * users have completed. Each onboarding feature records the version when completed.
 */

// localStorage key for onboarding state
const ONBOARDING_STATE_KEY = "cch-onboarding-state";
// Legacy key from old onboarding system (users page)
const LEGACY_KEY = "cch-users-onboarding-seen";

/**
 * Onboarding features and the version they were introduced.
 * Users will see the onboarding if they haven't completed it.
 */
export const ONBOARDING_INTRODUCED_IN = {
  webhookMigration: "0.3.41",
} as const;

export type OnboardingFeature = keyof typeof ONBOARDING_INTRODUCED_IN;

/**
 * State stored in localStorage
 */
interface OnboardingState {
  /** Records the APP_VERSION when each feature's onboarding was completed */
  completed: {
    [K in OnboardingFeature]?: string;
  };
}

/**
 * Get the current onboarding state from localStorage
 */
export function getOnboardingState(): OnboardingState {
  if (typeof window === "undefined" || !window.localStorage) {
    return { completed: {} };
  }

  try {
    const raw = localStorage.getItem(ONBOARDING_STATE_KEY);
    if (!raw) {
      return { completed: {} };
    }
    const parsed = JSON.parse(raw) as OnboardingState;
    return {
      completed: parsed.completed ?? {},
    };
  } catch {
    // Invalid JSON or other error, return empty state
    return { completed: {} };
  }
}

/**
 * Check if onboarding should be shown for a feature
 *
 * @param feature - The onboarding feature to check
 * @returns true if onboarding should be shown (not yet completed)
 */
export function shouldShowOnboarding(feature: OnboardingFeature): boolean {
  if (typeof window === "undefined" || !window.localStorage) {
    // SSR or no localStorage - don't show
    return false;
  }

  const state = getOnboardingState();
  const completedVersion = state.completed[feature];

  // If not completed, should show
  if (!completedVersion) {
    return true;
  }

  // Already completed, don't show
  // Future: could check if there's a new version of the onboarding
  return false;
}

/**
 * Mark an onboarding feature as completed
 *
 * @param feature - The onboarding feature to mark as completed
 * @param version - The APP_VERSION to record (defaults to current)
 */
export function setOnboardingCompleted(feature: OnboardingFeature, version: string): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    const state = getOnboardingState();
    state.completed[feature] = version;
    localStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify(state));
  } catch {
    // localStorage not available or quota exceeded
  }
}

/**
 * Migrate old onboarding localStorage key to new system.
 * The old key was used for users page onboarding only.
 * This just removes the old key since we're deprecating that onboarding.
 */
export function migrateOldOnboardingKey(): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    if (localStorage.getItem(LEGACY_KEY) !== null) {
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    // localStorage not available
  }
}

/**
 * Reset onboarding state for a specific feature (for testing/debugging)
 */
export function resetOnboarding(feature: OnboardingFeature): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    const state = getOnboardingState();
    delete state.completed[feature];
    localStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify(state));
  } catch {
    // localStorage not available
  }
}

/**
 * Clear all onboarding state (for testing/debugging)
 */
export function clearAllOnboardingState(): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    localStorage.removeItem(ONBOARDING_STATE_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // localStorage not available
  }
}
