import functionsModule from "@react-native-firebase/functions";

type ClaimInvitesResult = {
  claimedCount: number;
  projectIds: string[];
};

function getRegionalFunctions(region: string) {
  try {
    return (functionsModule as unknown as (region: string) => ReturnType<typeof functionsModule>)(region);
  } catch {
    return functionsModule(undefined, region);
  }
}

export async function claimProjectInvites(): Promise<ClaimInvitesResult> {
  try {
    const regionalFunctions = getRegionalFunctions("europe-west1");
    const fn = regionalFunctions.httpsCallable("claimProjectInvites");
    const result = await fn({});
    const data = (result?.data ?? {}) as Partial<ClaimInvitesResult>;
    return {
      claimedCount: typeof data.claimedCount === "number" ? data.claimedCount : 0,
      projectIds: Array.isArray(data.projectIds) ? data.projectIds.filter((x): x is string => typeof x === "string") : [],
    };
  } catch (error) {
    console.warn("[invites] claimProjectInvites failed:", error);
    return { claimedCount: 0, projectIds: [] };
  }
}
