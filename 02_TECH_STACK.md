# Tech Stack & Architecture

## High-Level Architecture

The project is a **standalone web application** that generates TYPO3 Content Element files.

Browser (UI)
↓
Builder JSON Spec
↓
Validation Layer
↓
Generator Engine
↓
ZIP Export (TYPO3 Files)


---

## Frontend (UI Layer)

### Purpose
- Visual drag-and-drop builder
- Field configuration UI
- Live preview (optional)
- JSON export/import

### Recommended Stack
- **Next.js (React)**
- **TypeScript**
- **dnd-kit** (drag & drop)
- **React Hook Form**
- **Zod / Ajv** (client-side validation)
- **Tailwind CSS** (fast UI development)

---

## Generator Engine

### Purpose
- Validate JSON specification
- Generate TYPO3 files deterministically
- Prepare Codex CLI prompt for optional AI assistance
- Package output into ZIP

### Implemented Stack
- **Next.js client-side generator logic**
- **TypeScript**
- **Zod + custom validator**
- **JSZip** (ZIP generation)

---

## TYPO3 Output Strategy

### MVP (Recommended)
- **CType-based custom Content Elements**
- **TCA columns** for custom fields in `tt_content`
- **Fluid template rendering** via TypoScript
- **SQL file (`ext_tables.sql`)** for generated custom columns and repeater child tables
- **Icon registration** for backend wizard/listing
- **TSConfig backend preview mapping**
- **Static TypoScript include registration (`sys_template.php`)**

### Future (Advanced)
- IRRE structures and advanced relational models
- Migration helpers and upgrade assistants

---

## AI Integration (Optional)

### Used For
- Fluid template HTML
- Field help texts
- Labels and descriptions

### NOT Used For
- PHP logic
- TCA logic
- TypoScript structure
- SQL structure

### Tools
- **Codex CLI** → development and prompt execution

---

## Deployment

- DDEV local environment for development
- Next.js web app deployment target

---

## Security Principles

- Strict JSON schema validation
- Allowlist-based generation
- No dynamic PHP execution
- ZIP-only export (no auto-write to TYPO3)
