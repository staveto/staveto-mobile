# Catalog Template Localization

## Overview

Localized catalog templates (CZ, DE, ES, PL, IT) are created by copying `eu-construction-v1` and applying translations. New project creation selects template by `countryCode`.

## Prerequisites

- `npm install firebase-admin`
- `GOOGLE_APPLICATION_CREDENTIALS` set to service account JSON path

## Workflow

### 1. Get real phase/task IDs (optional but recommended)

```bash
node scripts/dump-template-structure.js eu-construction-v1
```

Output: `scripts/template-structure.json` with actual IDs. Merge keys into `translations.json` if your template uses different IDs than PH1, PH1-1, etc.

### 2. Copy base template to each country

```bash
node scripts/copy-catalog.js eu-construction-v1 cz-construction-v1
node scripts/copy-catalog.js eu-construction-v1 de-construction-v1
node scripts/copy-catalog.js eu-construction-v1 es-construction-v1
node scripts/copy-catalog.js eu-construction-v1 pl-construction-v1
node scripts/copy-catalog.js eu-construction-v1 it-construction-v1
```

### 3. Apply translations

```bash
node scripts/applyTranslations.js cz-construction-v1 cz
node scripts/applyTranslations.js de-construction-v1 de
node scripts/applyTranslations.js es-construction-v1 es
node scripts/applyTranslations.js pl-construction-v1 pl
node scripts/applyTranslations.js it-construction-v1 it
```

## Country → Template mapping

| Country | Template ID |
|---------|-------------|
| SK | eu-construction-v1 |
| CZ | cz-construction-v1 |
| DE | de-construction-v1 |
| ES | es-construction-v1 |
| PL | pl-construction-v1 |
| IT | it-construction-v1 |
| Other | eu-construction-v1 (fallback) |

## Preview behavior

Phase preview in create modal still loads from `eu-construction-v1`. Only the final template used at project creation is country-resolved.
