# UI Flow & User Experience

## Entry Point

User opens the tool via browser:
https://ait3content.ddev.site


No TYPO3 login or backend access is required.

---

## Step 1: Create New Content Element

User provides:
- Vendor Name (e.g. `vendor`)
- Extension Key (e.g. `n2tsitepackage`)
- Content Element Name
- CType Key (machine name)
- Icon name
- Group/category

---

## Step 2: Drag & Drop Builder

User builds element using blocks:
- Input (text)
- Textarea
- RTE
- Media / Image
- Link
- Select / Checkbox
- Repeater (stored with dedicated child table + inline relation)

Each block supports:
- Label
- Required flag
- Default value
- Limits (length, items)
- Help text

---

## Step 3: Layout Configuration

User configures:
- Tabs (Content, Settings, Appearance)
- Field ordering
- Grouping
- Repeater structure

---

## Step 4: Validation

System validates:
- Unique field keys
- Allowed field types
- Naming conventions
- Repeater depth
- TYPO3 reserved keywords

Errors are shown inline in UI.

---

## Step 5: Optional AI Assist

User may click:
- “Generate Fluid Template”
- “Generate Field Descriptions”

AI receives:
- Sanitized JSON spec
- Strict output contract

AI returns:
- Template HTML
- Text only (no PHP)

---

## Step 6: Preview (Optional)

User previews:
- Backend form layout (simulated)
- Frontend rendering (basic)

---

## Step 7: Export

User clicks **Export ZIP**

ZIP contains:
- TCA Overrides
- SQL (`ext_tables.sql`)
- TypoScript
- TSConfig
- Fluid Templates
- Language files
- Icons
- `manifest.json`
- `spec.json`

User can also:
- Add current Content Element to bundle
- Repeat build for more elements
- Export **Bundle ZIP** containing multiple generated content elements

---

## Step 8: TYPO3 Integration

Developer:
1. Unzips files
2. Copies into TYPO3 extension
3. Flushes caches

Result:
- Content Element appears in TYPO3 backend
- Editors can use it immediately
