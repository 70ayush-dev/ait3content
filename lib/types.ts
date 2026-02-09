export type FieldType =
  | "input"
  | "textarea"
  | "rte"
  | "media"
  | "link"
  | "select"
  | "checkbox"
  | "repeater";

export type TabName = "content" | "settings" | "appearance";

export interface FieldDefinition {
  id: string;
  key: string;
  type: FieldType;
  label: string;
  required: boolean;
  defaultValue: string;
  helpText: string;
  maxLength?: number;
  maxItems?: number;
  options?: string[];
  tab: TabName;
  repeaterFields?: Omit<FieldDefinition, "repeaterFields">[];
}

export interface ElementMeta {
  vendorName: string;
  extensionKey: string;
  elementName: string;
  cTypeKey: string;
  iconName: string;
  group: string;
}

export interface BuilderSpec {
  meta: ElementMeta;
  fields: FieldDefinition[];
  templateHtml: string;
}

export interface ValidationResult {
  formErrors: string[];
  fieldErrors: Record<string, string[]>;
}
