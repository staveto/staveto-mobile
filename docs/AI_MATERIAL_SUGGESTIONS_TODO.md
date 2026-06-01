# AI material suggestions — backend follow-up

Mobile MVP supports **manual** material suggestions and **used material** tracking.
AI-generated material lists are **not** wired yet.

## Required Cloud Function changes (outside this PR)

1. **`generateProjectStructure`**
   - Extend Gemini prompt to suggest trade materials from brief + attachments.
   - Return optional `materialSuggestions[]` in JSON (name, quantity, unit, confidence, sourceNote, phaseName, taskTitle).

2. **`createProjectFromAiPlan`** (optional)
   - May persist suggestions server-side, or mobile can write to `projects/{id}/materialSuggestions` after create.

3. **Schema sync**
   - Keep `functions/src/aiProjectSchema.ts` aligned with `mobile/src/lib/aiProjectSchema.ts` (`AiMaterialSuggestion`, optional `materialSuggestions` on plan).

4. **Deploy**
   ```bash
   firebase deploy --only functions:generateProjectStructure,functions:createProjectFromAiPlan
   ```

## Firestore paths (mobile MVP)

- `projects/{projectId}/materialSuggestions/{suggestionId}` — planned / recommended
- `projects/{projectId}/materials/{materialId}` — actually used (with cost)

Planned and used collections are **never** auto-merged; user accepts via form or adds used material manually.
