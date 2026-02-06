import type { AirtableClient } from "./airtable";

function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function sign(payload: object, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(`${encodedHeader}.${encodedPayload}.${secret}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export type LoginResult = {
  token: string;
  user: { id: string; email: string; name?: string };
  orgId: string;
};

export type LoginFailure =
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "no_org" }
  | { ok: false; reason: "not_active" }
  | { ok: false; reason: "error"; message?: string };

export class AuthService {
  constructor(
    private jwtSecret: string,
    private airtable: AirtableClient
  ) {}

  async login(email: string): Promise<LoginResult | LoginFailure> {
    const escaped = String(email).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const formula = `{Email} = "${escaped}"`;
    try {
      const result = await this.airtable.list("Users", { filterByFormula: formula });
      if (!result.records?.length) return { ok: false, reason: "not_found" };

      const r = result.records[0];
      const f = r.fields as Record<string, unknown>;
      const orgLink = f.Org;
      const arr = Array.isArray(orgLink) ? orgLink : orgLink != null ? [orgLink] : [];
      if (arr.length === 0) return { ok: false, reason: "no_org" };

      const orgId = String(arr[0]);
      const status = (f.Status as string) ?? "";
      if (status !== "ACTIVE") return { ok: false, reason: "not_active" };

      const user = { id: r.id, email: (f.Email as string) ?? "", name: (f.FullName as string) ?? undefined };
      const payload = {
        email: user.email,
        orgId,
        role: (f.Role as string) || "WORKER",
        exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      };
      const token = sign(payload, this.jwtSecret);
      return { token, user, orgId };
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      if (typeof console !== "undefined" && console.error) {
        console.error("[auth/login]", msg);
      }
      return { ok: false, reason: "error", message: msg };
    }
  }
}
