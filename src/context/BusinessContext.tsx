import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "./AuthContext";
import {
  fetchBillingOwnerOrderOrgSurfaceBoostsByOrgId,
  findPreferredBusinessOrgForUser,
  getMembership,
  getOrganization,
  type MembershipDoc,
  type OrganizationDoc,
} from "../services/organizations";

const ACTIVE_BUSINESS_ORG_STORAGE_KEY = "staveto_active_business_org_id";

function debugBusinessContext(message: string, payload?: Record<string, unknown>) {
  if (!__DEV__) return;
  if (payload) {
    console.log(`[BusinessContext] ${message}`, payload);
    return;
  }
  console.log(`[BusinessContext] ${message}`);
}

type BusinessContextValue = {
  activeBusinessOrgId: string | null;
  setActiveBusinessOrgId: (orgId: string | null) => void;
  activeOrganization: OrganizationDoc | null;
  activeMembership: MembershipDoc | null;
  /** Boost score from `businessOrders` for this user as billing owner; -1 = none / not loaded. */
  billingOwnerOrderSurfaceBoostScore: number;
  loading: boolean;
  error: string | null;
  refreshActiveBusinessOrg: () => Promise<void>;
};

const BusinessContext = createContext<BusinessContextValue | null>(null);

async function persistActiveBusinessOrgId(orgId: string | null): Promise<void> {
  if (orgId) {
    await AsyncStorage.setItem(ACTIVE_BUSINESS_ORG_STORAGE_KEY, orgId);
  } else {
    await AsyncStorage.removeItem(ACTIVE_BUSINESS_ORG_STORAGE_KEY);
  }
}

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [activeBusinessOrgId, setActiveBusinessOrgIdState] = useState<string | null>(null);
  const [activeOrganization, setActiveOrganization] = useState<OrganizationDoc | null>(null);
  const [activeMembership, setActiveMembership] = useState<MembershipDoc | null>(null);
  const [billingOwnerOrderSurfaceBoostScore, setBillingOwnerOrderSurfaceBoostScore] =
    useState<number>(-1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const previousUserIdRef = useRef<string | null>(null);
  const refreshRunRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const storedOrgId = await AsyncStorage.getItem(ACTIVE_BUSINESS_ORG_STORAGE_KEY);
        debugBusinessContext("storage hydrated", {
          storedActiveBusinessOrgId: storedOrgId ?? null,
        });
        if (!cancelled) {
          setActiveBusinessOrgIdState(storedOrgId || null);
        }
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : String(e);
          setError(`BusinessContext storage read failed: ${message}`);
        }
      } finally {
        if (!cancelled) {
          setStorageHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setActiveBusinessOrgId = useCallback((orgId: string | null) => {
    setActiveBusinessOrgIdState(orgId);
    setError(null);
    setActiveOrganization(null);
    setActiveMembership(null);
    setBillingOwnerOrderSurfaceBoostScore(-1);
    persistActiveBusinessOrgId(orgId).catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      setError(`BusinessContext storage write failed: ${message}`);
    });
  }, []);

  const resolveAndSetPreferredOrg = useCallback(
    async (userIdForLookup: string): Promise<boolean> => {
      debugBusinessContext("resolving preferred org", {
        userId: userIdForLookup,
        storedActiveBusinessOrgId: activeBusinessOrgId,
      });
      const preferred = await findPreferredBusinessOrgForUser(userIdForLookup);
      if (!preferred) {
        debugBusinessContext("preferred org not found - showing landing", { userId: userIdForLookup });
        setActiveBusinessOrgIdState(null);
        setActiveOrganization(null);
        setActiveMembership(null);
        setBillingOwnerOrderSurfaceBoostScore(-1);
        await persistActiveBusinessOrgId(null);
        return false;
      }
      setActiveBusinessOrgIdState(preferred.org.id);
      setActiveOrganization(preferred.org);
      setActiveMembership(preferred.membership);
      await persistActiveBusinessOrgId(preferred.org.id);
      try {
        const boosts = await fetchBillingOwnerOrderOrgSurfaceBoostsByOrgId(userIdForLookup);
        setBillingOwnerOrderSurfaceBoostScore(boosts.get(preferred.org.id) ?? -1);
      } catch {
        setBillingOwnerOrderSurfaceBoostScore(-1);
      }
      debugBusinessContext("preferred org found - showing dashboard", {
        orgId: preferred.org.id,
        orgStatus: preferred.org.status,
      });
      return true;
    },
    [activeBusinessOrgId]
  );

  const refreshActiveBusinessOrg = useCallback(async () => {
    if (!storageHydrated || authLoading) {
      setLoading(true);
      return;
    }

    if (!user?.id) {
      setActiveOrganization(null);
      setActiveMembership(null);
      setBillingOwnerOrderSurfaceBoostScore(-1);
      setLoading(false);
      return;
    }

    if (!activeBusinessOrgId) {
      setLoading(true);
      try {
        debugBusinessContext("missing activeBusinessOrgId; fallback lookup starts", {
          userId: user.id,
        });
        await resolveAndSetPreferredOrg(user.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(`BusinessContext resolve preferred org failed: ${message}`);
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    setError(null);
    const runId = ++refreshRunRef.current;
    const expectedOrgId = activeBusinessOrgId;
    const expectedUserId = user?.id ?? null;
    try {
      const [organization, membership] = await Promise.all([
        getOrganization(expectedOrgId),
        getMembership(expectedOrgId, expectedUserId ?? ""),
      ]);

      if (runId !== refreshRunRef.current) {
        return;
      }

      if (!organization || !membership) {
        debugBusinessContext("stored activeBusinessOrgId not usable; fallback lookup starts", {
          activeBusinessOrgId: expectedOrgId,
          hasOrganization: !!organization,
          hasMembership: !!membership,
        });
        await resolveAndSetPreferredOrg(expectedUserId ?? "");
        setLoading(false);
        return;
      }

      debugBusinessContext("using stored activeBusinessOrgId", {
        orgId: organization.id,
        orgStatus: organization.status,
      });
      setActiveOrganization(organization);
      setActiveMembership(membership);
      try {
        const boosts = await fetchBillingOwnerOrderOrgSurfaceBoostsByOrgId(expectedUserId);
        setBillingOwnerOrderSurfaceBoostScore(boosts.get(expectedOrgId) ?? -1);
      } catch {
        setBillingOwnerOrderSurfaceBoostScore(-1);
      }
      setLoading(false);
    } catch (e) {
      if (runId !== refreshRunRef.current) {
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      setError(`BusinessContext refresh failed: ${message}`);
      setLoading(false);
    }
  }, [activeBusinessOrgId, authLoading, resolveAndSetPreferredOrg, storageHydrated, user?.id]);

  useEffect(() => {
    refreshActiveBusinessOrg().catch(() => {
      // refreshActiveBusinessOrg already writes a user-facing error state.
    });
  }, [refreshActiveBusinessOrg]);

  useEffect(() => {
    if (!storageHydrated || authLoading) return;
    const previousUserId = previousUserIdRef.current;
    if (previousUserId === null) {
      previousUserIdRef.current = userId;
      return;
    }
    if (previousUserId !== userId) {
      refreshRunRef.current += 1;
      setActiveBusinessOrgIdState(null);
      setActiveOrganization(null);
      setActiveMembership(null);
      setBillingOwnerOrderSurfaceBoostScore(-1);
      setError(null);
      setLoading(false);
      persistActiveBusinessOrgId(null).catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        setError(`BusinessContext storage clear failed: ${message}`);
      });
    }
    previousUserIdRef.current = userId;
  }, [authLoading, storageHydrated, userId]);

  const value = useMemo<BusinessContextValue>(
    () => ({
      activeBusinessOrgId,
      setActiveBusinessOrgId,
      activeOrganization,
      activeMembership,
      billingOwnerOrderSurfaceBoostScore,
      loading,
      error,
      refreshActiveBusinessOrg,
    }),
    [
      activeBusinessOrgId,
      setActiveBusinessOrgId,
      activeOrganization,
      activeMembership,
      billingOwnerOrderSurfaceBoostScore,
      loading,
      error,
      refreshActiveBusinessOrg,
    ]
  );

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness(): BusinessContextValue {
  const ctx = useContext(BusinessContext);
  if (!ctx) {
    throw new Error("useBusiness must be used inside BusinessProvider");
  }
  return ctx;
}

