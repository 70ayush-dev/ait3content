import { FieldType } from "./types";

export const FIELD_TYPES: { label: string; value: FieldType; hint: string; implication: string }[] = [
  { label: "Input", value: "input", hint: "Single-line text", implication: "SQL: varchar(255)" },
  { label: "Textarea", value: "textarea", hint: "Multi-line text", implication: "SQL: text" },
  { label: "RTE", value: "rte", hint: "Rich text", implication: "SQL: text + richtext editor" },
  { label: "Media", value: "media", hint: "Image/File", implication: "TCA: file field relation" },
  { label: "Link", value: "link", hint: "TYPO3 link field", implication: "TCA: inputLink renderType" },
  { label: "Select", value: "select", hint: "Dropdown options", implication: "SQL: varchar + TCA items" },
  { label: "Checkbox", value: "checkbox", hint: "Boolean", implication: "SQL: smallint(5) unsigned" },
  { label: "Repeater", value: "repeater", hint: "Nested grouped fields", implication: "SQL: json (MVP storage)" }
];

export const RESERVED_KEYS = [
  "uid",
  "pid",
  "tstamp",
  "crdate",
  "deleted",
  "hidden",
  "sys_language_uid",
  "l10n_parent",
  "CType",
  "header",
  "bodytext"
];

export const TABS = ["content", "settings", "appearance"] as const;
