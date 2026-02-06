const BASE = "https://api.airtable.com/v0";

export type AirtableRecord = { id: string; fields: Record<string, unknown> };

export class AirtableClient {
  constructor(
    private apiKey: string,
    private baseId: string
  ) {}

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${BASE}/${this.baseId}/${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string>),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = `Airtable ${res.status}`;
      try {
        const j = JSON.parse(text) as { error?: { message?: string } };
        if (j.error?.message) msg += ` – ${j.error.message}`;
      } catch {
        if (text) msg += ` – ${text.slice(0, 200)}`;
      }
      throw new Error(msg);
    }
    return res.json() as Promise<T>;
  }

  async find(table: string, recordId: string): Promise<{ id: string; fields: Record<string, unknown> }> {
    return this.request(`${table}/${recordId}`);
  }

  async list(
    table: string,
    opts: { filterByFormula?: string; sort?: Array<{ field: string; direction: "asc" | "desc" }>; maxRecords?: number } = {}
  ): Promise<{ records: AirtableRecord[] }> {
    const params = new URLSearchParams();
    if (opts.filterByFormula) params.set("filterByFormula", opts.filterByFormula);
    if (opts.maxRecords != null) params.set("maxRecords", String(opts.maxRecords));
    if (opts.sort?.length) {
      params.set("sort[0][field]", opts.sort[0].field);
      params.set("sort[0][direction]", opts.sort[0].direction);
    }
    const q = params.toString();
    return this.request(`${table}${q ? `?${q}` : ""}`);
  }

  /** Vytvorí jeden záznam. Pole „linked record“ sú polia typu string[] (record IDs). */
  async create(table: string, fields: Record<string, unknown>): Promise<AirtableRecord> {
    const out = await this.request<{ id: string; fields: Record<string, unknown> }>(table, {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
    return { id: out.id, fields: out.fields ?? {} };
  }

  /** Aktualizuje existujúci záznam (čiastočne). */
  async update(table: string, recordId: string, fields: Record<string, unknown>): Promise<AirtableRecord> {
    const out = await this.request<{ id: string; fields: Record<string, unknown> }>(`${table}/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    });
    return { id: out.id, fields: out.fields ?? {} };
  }

  /** Zmaže záznam. */
  async delete(table: string, recordId: string): Promise<void> {
    await this.request<{ id: string; deleted: boolean }>(`${table}/${recordId}`, { method: "DELETE" });
  }
}
