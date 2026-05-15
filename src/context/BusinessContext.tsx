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
  findPreferredBusinessOrgForUser,
  getMembership,
  getOrganization,
  type MembershipDoc,
  type OrganizationDoc,
} from "../services/organizations";

const ACTIVE_BUSINESS_ORG_STORAGE_KEY = "staveto_active_business_org_id";

type BusinessContextValue = {
  activeBusinessOrgId: string | null;
  setActiveBusinessOrgId: (orgId: string | null) => void;
  activeOrganization: OrganizationDoc | null;
  activeMembership: MembershipDoc | null;
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
    persistActiveBusinessOrgId(orgId).catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      setError(`BusinessContext storage write failed: ${message}`);
    });
  }, []);

  const resolveAndSetPreferredOrg = useCallback(
    async (userIdForLookup: string): Promise<boolean> => {
      const preferred = await findPreferredBusinessOrgForUser(userIdForLookup);
      if (!preferred) {
        setActiveBusinessOrgIdState(null);
        setActiveOrganization(null);
        setActiveMembership(null);
        await persistActiveBusinessOrgId(null);
        return false;
      }
      setActiveBusinessOrgIdState(preferred.org.id);
      setActiveOrganization(preferred.org);
      setActiveMembership(preferred.membership);
      await persistActiveBusinessOrgId(preferred.org.id);
      return true;
    },
    []
  );

  const refreshActiveBusinessOrg = useCallback(async () => {
    if (!storageHydrated || authLoading) {
      setLoading(true);
      return;
    }

    if (!user?.id) {
      setActiveOrganization(null);
      setActiveMembership(null);
      setLoading(false);
      return;
    }

    if (!activeBusinessOrgId) {
      setLoading(true);
      try {
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
        await resolveAndSetPreferredOrg(expectedUserId ?? "");
        setLoading(false);
        return;
      }

      setActiveOrganization(organization);
      setActiveMembership(membership);
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
      loading,
      error,
      refreshActiveBusinessOrg,
    }),
    [
      activeBusinessOrgId,
      setActiveBusinessOrgId,
      activeOrganization,
      activeMembership,
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

