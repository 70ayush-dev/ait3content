"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useForm } from "react-hook-form";

import { FIELD_TYPES, TABS } from "@/lib/constants";
import { metaSchema, type MetaForm } from "@/lib/schema";
import { BuilderSpec, FieldDefinition, TabName, ValidationResult } from "@/lib/types";
import {
  buildCodexPrompt,
  createZipFromSpecs,
  downloadText,
  listGeneratedFilePaths,
  makeField,
  slugify,
  validateSpec
} from "@/lib/utils";

const steps = [
  "Element Meta",
  "Drag & Drop Builder",
  "Layout",
  "Validation",
  "AI Assist",
  "Preview",
  "Export"
];
const DRAFT_KEY = "ait3content_builder_draft_v1";
const META_KEYS: Array<keyof MetaForm> = ["vendorName", "extensionKey", "elementName", "cTypeKey", "iconName", "group"];
const META_LABELS: Record<keyof MetaForm, string> = {
  vendorName: "Vendor Name",
  extensionKey: "Extension Key",
  elementName: "Element Name",
  cTypeKey: "CType Key",
  iconName: "Icon Name",
  group: "Group"
};
const META_HINTS: Record<keyof MetaForm, string> = {
  vendorName: "Composer vendor namespace (example: vendor)",
  extensionKey: "Lowercase TYPO3 extension key (example: n2tsitepackage)",
  elementName: "Human-readable content element label",
  cTypeKey: "Machine key for tt_content CType (example: feature_grid)",
  iconName: "Identifier for icon registration (example: content-feature-grid)",
  group: "New Content Element Wizard group"
};

const cx = (...parts: Array<string | boolean | undefined>): string => parts.filter(Boolean).join(" ");

const repeaterSubTypes: FieldDefinition["type"][] = [
  "input",
  "textarea",
  "rte",
  "media",
  "link",
  "select",
  "checkbox"
];

type AiUsage = {
  model?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};

const getTypeMeta = (type: FieldDefinition["type"]) => FIELD_TYPES.find((item) => item.value === type);

function SortableFieldCard({
  field,
  onChange,
  onDelete,
  errors
}: {
  field: FieldDefinition;
  onChange: (next: FieldDefinition) => void;
  onDelete: (id: string) => void;
  errors: string[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(
        "rounded-2xl border p-4 backdrop-blur-sm",
        isDragging ? "border-amber-400 bg-amber-50/70" : "border-slate-300/70 bg-white/70"
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="cursor-grab rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600"
          {...attributes}
          {...listeners}
        >
          Drag
        </button>
        <span className="rounded-lg bg-teal-700/10 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-teal-800">
          {field.type}
        </span>
        <button
          type="button"
          onClick={() => onDelete(field.id)}
          className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
        >
          Remove
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        TYPO3 mapping: {getTypeMeta(field.type)?.implication ?? "Mapped in generator"}
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Label</span>
          <input
            value={field.label}
            onChange={(e) => onChange({ ...field, label: e.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Field Key</span>
          <input
            value={field.key}
            onChange={(e) => onChange({ ...field, key: slugify(e.target.value) })}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block font-medium text-slate-700">Help Text</span>
          <input
            value={field.helpText}
            onChange={(e) => onChange({ ...field, helpText: e.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Default</span>
          <input
            value={field.defaultValue}
            onChange={(e) => onChange({ ...field, defaultValue: e.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Tab</span>
          <select
            value={field.tab}
            onChange={(e) => onChange({ ...field, tab: e.target.value as TabName })}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {TABS.map((tab) => (
              <option key={tab} value={tab}>
                {tab}
              </option>
            ))}
          </select>
        </label>

        {(field.type === "input" || field.type === "textarea") && (
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Max Length</span>
            <input
              type="number"
              min={1}
              value={field.maxLength ?? 255}
              onChange={(e) => onChange({ ...field, maxLength: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </label>
        )}

        {(field.type === "media" || field.type === "repeater") && (
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Max Items</span>
            <input
              type="number"
              min={1}
              value={field.maxItems ?? 1}
              onChange={(e) => onChange({ ...field, maxItems: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </label>
        )}

        {field.type === "select" && (
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block font-medium text-slate-700">Options (comma-separated)</span>
            <input
              value={(field.options ?? []).join(", ")}
              onChange={(e) =>
                onChange({
                  ...field,
                  options: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                })
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </label>
        )}

        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onChange({ ...field, required: e.target.checked })}
          />
          Required
        </label>
      </div>

      {field.type === "repeater" && (
        <section className="mt-4 rounded-xl border border-teal-200 bg-teal-50/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-teal-900">Repeater Sub-fields</h4>
            <button
              type="button"
              onClick={() => {
                const nextIndex = (field.repeaterFields || []).length + 1;
                const nextSubField: Omit<FieldDefinition, "repeaterFields"> = {
                  id: `rf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  key: `item_field_${nextIndex}`,
                  label: `Item Field ${nextIndex}`,
                  type: "input",
                  required: false,
                  defaultValue: "",
                  helpText: "",
                  maxLength: 255,
                  tab: field.tab
                };
                onChange({
                  ...field,
                  repeaterFields: [...(field.repeaterFields || []), nextSubField]
                });
              }}
              className="rounded-lg border border-teal-300 bg-white px-2 py-1 text-xs font-semibold text-teal-800 hover:bg-teal-100"
            >
              Add Sub-field
            </button>
          </div>

          <div className="space-y-2">
            {(field.repeaterFields || []).map((subField) => (
              <div key={subField.id} className="rounded-lg border border-teal-200 bg-white p-3">
                <div className="mb-2 grid gap-2 md:grid-cols-2">
                  <label className="text-xs">
                    <span className="mb-1 block font-medium text-slate-700">Label</span>
                    <input
                      value={subField.label}
                      onChange={(e) =>
                        onChange({
                          ...field,
                          repeaterFields: (field.repeaterFields || []).map((item) =>
                            item.id === subField.id ? { ...item, label: e.target.value } : item
                          )
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                    />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block font-medium text-slate-700">Key</span>
                    <input
                      value={subField.key}
                      onChange={(e) =>
                        onChange({
                          ...field,
                          repeaterFields: (field.repeaterFields || []).map((item) =>
                            item.id === subField.id ? { ...item, key: slugify(e.target.value) } : item
                          )
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                    />
                  </label>
                </div>

                <div className="grid gap-2 md:grid-cols-3">
                  <label className="text-xs">
                    <span className="mb-1 block font-medium text-slate-700">Type</span>
                    <select
                      value={subField.type}
                      onChange={(e) =>
                        onChange({
                          ...field,
                          repeaterFields: (field.repeaterFields || []).map((item) =>
                            item.id === subField.id
                              ? {
                                  ...item,
                                  type: e.target.value as FieldDefinition["type"],
                                  options: e.target.value === "select" ? ["Option A", "Option B"] : undefined,
                                  maxLength:
                                    e.target.value === "input" || e.target.value === "textarea" ? 255 : undefined
                                }
                              : item
                          )
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                    >
                      {repeaterSubTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="inline-flex items-center gap-2 pt-5 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={subField.required}
                      onChange={(e) =>
                        onChange({
                          ...field,
                          repeaterFields: (field.repeaterFields || []).map((item) =>
                            item.id === subField.id ? { ...item, required: e.target.checked } : item
                          )
                        })
                      }
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...field,
                        repeaterFields: (field.repeaterFields || []).filter((item) => item.id !== subField.id)
                      })
                    }
                    className="mt-4 rounded-lg border border-red-200 px-2 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                  >
                    Remove Sub-field
                  </button>
                </div>

                {subField.type === "select" && (
                  <label className="mt-2 block text-xs">
                    <span className="mb-1 block font-medium text-slate-700">Options (comma-separated)</span>
                    <input
                      value={(subField.options || []).join(", ")}
                      onChange={(e) =>
                        onChange({
                          ...field,
                          repeaterFields: (field.repeaterFields || []).map((item) =>
                            item.id === subField.id
                              ? {
                                  ...item,
                                  options: e.target.value
                                    .split(",")
                                    .map((opt) => opt.trim())
                                    .filter(Boolean)
                                }
                              : item
                          )
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {errors.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-700">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default function BuilderPage() {
  const [step, setStep] = useState(0);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [bundle, setBundle] = useState<BuilderSpec[]>([]);
  const [validation, setValidation] = useState<ValidationResult>({ formErrors: [], fieldErrors: {} });
  const [templateHtml, setTemplateHtml] = useState<string>("");
  const [loadingZip, setLoadingZip] = useState(false);
  const [loadingBundleZip, setLoadingBundleZip] = useState(false);
  const [status, setStatus] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [templateSource, setTemplateSource] = useState<"ai" | "manual" | "none">("none");
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);
  const [aiGeneratedAt, setAiGeneratedAt] = useState<string | null>(null);
  const [showAiReportModal, setShowAiReportModal] = useState(false);
  const [validatedFingerprint, setValidatedFingerprint] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const metaForm = useForm<MetaForm>({
    defaultValues: {
      vendorName: "vendor",
      extensionKey: "n2tsitepackage",
      elementName: "Feature Grid",
      cTypeKey: "feature_grid",
      iconName: "content-feature-grid",
      group: "custom"
    }
  });

  const meta = metaForm.watch();

  const spec = useMemo<BuilderSpec>(
    () => ({
      meta,
      fields,
      templateHtml
    }),
    [fields, meta, templateHtml]
  );
  const currentFingerprint = useMemo(() => JSON.stringify(spec), [spec]);
  const generatedFileList = useMemo(() => listGeneratedFilePaths(spec).sort(), [spec]);
  const metaValid = useMemo(() => metaSchema.safeParse(meta).success, [meta]);
  const isExportUnlocked =
    validatedFingerprint === currentFingerprint &&
    validation.formErrors.length === 0 &&
    Object.keys(validation.fieldErrors).length === 0;
  const metaCompletion = useMemo(() => {
    const values = [meta.vendorName, meta.extensionKey, meta.elementName, meta.cTypeKey, meta.iconName, meta.group];
    return values.filter((value) => value.trim().length > 0).length;
  }, [meta]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    setFields((prev) => {
      const oldIndex = prev.findIndex((f) => f.id === active.id);
      const newIndex = prev.findIndex((f) => f.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const addField = (type: FieldDefinition["type"]) => {
    setFields((prev) => [...prev, makeField(type, prev.length)]);
    setValidatedFingerprint(null);
    if (step < 1) {
      setStep(1);
    }
  };

  const applyPreset = (preset: "hero" | "testimonial" | "cta") => {
    const mk = (type: FieldDefinition["type"], key: string, label: string): FieldDefinition => ({
      ...makeField(type, Math.floor(Math.random() * 10)),
      key,
      label,
      id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    });

    if (preset === "hero") {
      metaForm.reset({
        vendorName: meta.vendorName || "vendor",
        extensionKey: meta.extensionKey || "n2tsitepackage",
        elementName: "Hero Banner",
        cTypeKey: "hero_banner",
        iconName: "content-hero-banner",
        group: "marketing"
      });
      setFields([
        { ...mk("input", "headline", "Headline"), required: true, maxLength: 120 },
        { ...mk("textarea", "subline", "Subline"), maxLength: 255 },
        { ...mk("media", "hero_image", "Hero Image"), maxItems: 1 },
        { ...mk("link", "primary_link", "Primary Link") }
      ]);
      setTemplateHtml("");
      setTemplateSource("none");
    }

    if (preset === "testimonial") {
      metaForm.reset({
        vendorName: meta.vendorName || "vendor",
        extensionKey: meta.extensionKey || "n2tsitepackage",
        elementName: "Testimonials",
        cTypeKey: "testimonials",
        iconName: "content-testimonials",
        group: "marketing"
      });
      const repeater = mk("repeater", "testimonials_items", "Testimonials Items");
      repeater.maxItems = 10;
      repeater.repeaterFields = [
        { ...mk("input", "author_name", "Author Name"), required: true },
        { ...mk("textarea", "quote_text", "Quote Text"), required: true },
        { ...mk("select", "rating", "Rating"), options: ["3", "4", "5"] }
      ];
      setFields([repeater, { ...mk("checkbox", "show_rating", "Show Rating") }]);
      setTemplateHtml("");
      setTemplateSource("none");
    }

    if (preset === "cta") {
      metaForm.reset({
        vendorName: meta.vendorName || "vendor",
        extensionKey: meta.extensionKey || "n2tsitepackage",
        elementName: "Call To Action",
        cTypeKey: "call_to_action",
        iconName: "content-cta",
        group: "marketing"
      });
      setFields([
        { ...mk("input", "cta_title", "CTA Title"), required: true },
        { ...mk("textarea", "cta_text", "CTA Text") },
        { ...mk("link", "cta_link", "CTA Link"), required: true },
        { ...mk("select", "cta_style", "CTA Style"), options: ["primary", "secondary"] }
      ]);
      setTemplateHtml("");
      setTemplateSource("none");
    }

    setValidatedFingerprint(null);
    setStatus({ type: "ok", text: `Loaded ${preset.toUpperCase()} preset.` });
    setStep(1);
  };

  const updateField = (next: FieldDefinition) => {
    setFields((prev) => prev.map((f) => (f.id === next.id ? next : f)));
    setValidatedFingerprint(null);
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(spec));
  }, [spec]);

  const loadDraft = () => {
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) {
      setStatus({ type: "error", text: "No saved draft found in this browser." });
      return;
    }
    try {
      const parsed = JSON.parse(raw) as BuilderSpec;
      metaForm.reset({
        vendorName: parsed.meta.vendorName || "vendor",
        extensionKey: parsed.meta.extensionKey || "n2tsitepackage",
        elementName: parsed.meta.elementName || "",
        cTypeKey: parsed.meta.cTypeKey || "",
        iconName: parsed.meta.iconName || "",
        group: parsed.meta.group || "custom"
      });
      setFields(parsed.fields || []);
      const importedTemplate = parsed.templateHtml || "";
      setTemplateHtml(importedTemplate);
      setTemplateSource(importedTemplate.trim() ? "manual" : "none");
      setValidatedFingerprint(null);
      setStatus({ type: "ok", text: "Draft loaded." });
    } catch {
      setStatus({ type: "error", text: "Saved draft is invalid JSON." });
    }
  };

  const clearDraft = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(DRAFT_KEY);
    }
    setStatus({ type: "ok", text: "Saved draft cleared." });
  };

  const runValidation = () => {
    const parsed = metaSchema.safeParse(meta);
    const result = validateSpec(spec);
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) => result.formErrors.push(issue.message));
    }
    setValidation(result);
    setStep(3);
    if (result.formErrors.length === 0 && Object.keys(result.fieldErrors).length === 0) {
      setValidatedFingerprint(currentFingerprint);
      setStatus({ type: "ok", text: "Validation passed." });
    } else {
      setValidatedFingerprint(null);
      setStatus({ type: "error", text: "Validation failed. Fix highlighted issues." });
    }
    return result;
  };

  const generateWithAi = async () => {
    if (fields.length === 0) {
      setStatus({ type: "error", text: "Add fields before AI generation." });
      return;
    }

    setAiGenerating(true);
    setAiProgress(5);
    setStep(4);

    const timer = window.setInterval(() => {
      setAiProgress((prev) => (prev >= 90 ? 90 : prev + 7));
    }, 350);

    try {
      const response = await fetch("/api/ai/generate-template", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ spec })
      });
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        data?: {
          elementName?: string;
          cTypeKey?: string;
          iconName?: string;
          fieldLabels?: Record<string, string>;
          templateHtml?: string;
        };
        usage?: AiUsage;
      };

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error || "AI generation failed.");
      }

      const ai = payload.data;

      if (ai.elementName || ai.cTypeKey || ai.iconName) {
        metaForm.reset({
          vendorName: meta.vendorName || "vendor",
          extensionKey: meta.extensionKey || "n2tsitepackage",
          elementName: ai.elementName || meta.elementName || "",
          cTypeKey: ai.cTypeKey ? slugify(ai.cTypeKey) : meta.cTypeKey || "",
          iconName: ai.iconName || meta.iconName || "",
          group: meta.group || "custom"
        });
      }

      if (ai.fieldLabels && Object.keys(ai.fieldLabels).length > 0) {
        setFields((prev) =>
          prev.map((field) =>
            ai.fieldLabels?.[field.key] ? { ...field, label: ai.fieldLabels[field.key] } : field
          )
        );
      }

      if (ai.templateHtml && ai.templateHtml.trim().length > 0) {
        setTemplateHtml(ai.templateHtml);
        setTemplateSource("ai");
      } else {
        setTemplateHtml("");
        setTemplateSource("none");
      }

      setAiUsage(payload.usage || null);
      setAiGeneratedAt(new Date().toISOString());
      setShowAiReportModal(true);
      setValidatedFingerprint(null);
      setStatus({
        type: ai.templateHtml?.trim() ? "ok" : "error",
        text: ai.templateHtml?.trim()
          ? "Generated from AI successfully."
          : "AI ran but returned no template output."
      });
      setAiProgress(100);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI generation failed.";
      setStatus({ type: "error", text: message });
    } finally {
      window.clearInterval(timer);
      window.setTimeout(() => setAiGenerating(false), 250);
    }
  };

  const downloadSpec = () =>
    downloadText(JSON.stringify(spec, null, 2), `${meta.cTypeKey || "spec"}.json`, "application/json;charset=utf-8");

  const importSpec = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as BuilderSpec;
        const normalizedMeta = {
          vendorName: parsed.meta.vendorName || "vendor",
          extensionKey: parsed.meta.extensionKey || "",
          elementName: parsed.meta.elementName || "",
          cTypeKey: parsed.meta.cTypeKey || "",
          iconName: parsed.meta.iconName || "",
          group: parsed.meta.group || ""
        };
        const metaCheck = metaSchema.safeParse(normalizedMeta);
        if (!metaCheck.success || !Array.isArray(parsed.fields) || typeof parsed.templateHtml !== "string") {
          setStatus({ type: "error", text: "Invalid spec structure." });
          return;
        }
        metaForm.reset(normalizedMeta);
        setFields(parsed.fields);
        setTemplateHtml(parsed.templateHtml);
        setTemplateSource(parsed.templateHtml.trim() ? "manual" : "none");
        setValidatedFingerprint(null);
        setStatus({ type: "ok", text: "Spec imported successfully." });
      } catch {
        setStatus({ type: "error", text: "Failed to parse spec JSON." });
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  const doExportZip = async () => {
    if (!isExportUnlocked) {
      setStatus({ type: "error", text: "Run validation successfully first to unlock export." });
      return;
    }
    if (!templateHtml.trim()) {
      setStatus({ type: "error", text: "No template output available. Generate with AI before export." });
      return;
    }

    setLoadingZip(true);
    try {
      const blob = await createZipFromSpecs([spec]);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${spec.meta.vendorName}_${spec.meta.extensionKey}_${spec.meta.cTypeKey}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
      setStep(6);
      setStatus({ type: "ok", text: "ZIP exported successfully." });
    } finally {
      setLoadingZip(false);
    }
  };

  const addCurrentToBundle = () => {
    const result = runValidation();
    if (result.formErrors.length > 0 || Object.keys(result.fieldErrors).length > 0) {
      return;
    }
    if (!templateHtml.trim()) {
      setStatus({ type: "error", text: "Cannot bundle without AI template output." });
      return;
    }

    const snapshot: BuilderSpec = JSON.parse(JSON.stringify(spec));
    setBundle((prev) => {
      const idx = prev.findIndex((item) => item.meta.cTypeKey === snapshot.meta.cTypeKey);
      if (idx === -1) {
        return [...prev, snapshot];
      }
      const next = [...prev];
      next[idx] = snapshot;
      return next;
    });
    setStatus({ type: "ok", text: `Added ${snapshot.meta.cTypeKey} to bundle.` });
  };

  const loadBundleElement = (entry: BuilderSpec) => {
    metaForm.reset(entry.meta);
    setFields(entry.fields);
    setTemplateHtml(entry.templateHtml);
    setTemplateSource(entry.templateHtml.trim() ? "manual" : "none");
    setValidatedFingerprint(null);
    setStatus({ type: "ok", text: `Loaded ${entry.meta.cTypeKey} from bundle.` });
  };

  const removeFromBundle = (cTypeKey: string) => {
    setBundle((prev) => prev.filter((item) => item.meta.cTypeKey !== cTypeKey));
  };

  const exportBundleZip = async () => {
    if (bundle.length === 0) {
      setStatus({ type: "error", text: "Bundle is empty. Add at least one content element." });
      return;
    }
    if (bundle.some((item) => !item.templateHtml.trim())) {
      setStatus({ type: "error", text: "Bundle contains element(s) without template output." });
      return;
    }
    setLoadingBundleZip(true);
    try {
      const blob = await createZipFromSpecs(bundle);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${bundle[0].meta.vendorName}_${bundle[0].meta.extensionKey}_bundle.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
      setStatus({ type: "ok", text: `Bundle ZIP exported with ${bundle.length} elements.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to export bundle ZIP.";
      setStatus({ type: "error", text: message });
    } finally {
      setLoadingBundleZip(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-12 pt-8 md:px-8">
      <header className="mb-8 grid gap-6 rounded-3xl border border-teal-900/20 bg-gradient-to-br from-teal-900 via-teal-800 to-cyan-800 p-6 text-white shadow-2xl shadow-teal-950/20 md:grid-cols-[1fr_auto] md:p-8">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200/90">TYPO3 v12 Builder</p>
          <h1 className="text-3xl font-semibold leading-tight md:text-4xl">AI Powered Content Element Studio</h1>
          <p className="mt-3 max-w-2xl text-sm text-teal-100 md:text-base">
            Build, validate, preview, and export TYPO3 content elements with TCA, SQL, Fluid templates, and icons.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 self-start rounded-2xl bg-white/10 p-2 text-xs backdrop-blur-sm">
          {steps.map((item, i) => (
            <div key={item} className={cx("rounded-xl px-2 py-2", i === step && "bg-amber-300 text-slate-950")}>{`${i + 1}. ${item}`}</div>
          ))}
        </div>
      </header>
      {status && (
        <div
          className={cx(
            "mb-6 rounded-xl border px-4 py-3 text-sm font-medium",
            status.type === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-800"
          )}
        >
          {status.text}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-6 rounded-3xl border border-slate-300/70 bg-white/80 p-5 shadow-lg shadow-slate-900/5 backdrop-blur-sm">
          <section className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Step 1: Meta</h2>
            <div className="space-y-3">
              {META_KEYS.map((key) => (
                <label key={key} className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">{META_LABELS[key]}</span>
                  <input
                    {...metaForm.register(key, {
                      onChange: (e) => {
                        if (key === "extensionKey" || key === "cTypeKey") {
                          e.target.value = slugify(e.target.value);
                        }
                      }
                    })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                  <span className="mt-1 block text-[11px] text-slate-500">{META_HINTS[key]}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Step 2: Add Blocks</h2>
            <div className="grid grid-cols-2 gap-2">
              {FIELD_TYPES.map((field) => (
                <button
                  key={field.value}
                  type="button"
                  onClick={() => addField(field.value)}
                  className="rounded-xl border border-slate-300 bg-white p-2 text-left transition hover:border-teal-500 hover:shadow-sm"
                >
                  <div className="text-sm font-semibold text-slate-800">{field.label}</div>
                  <div className="text-xs text-slate-500">{field.hint}</div>
                  <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-teal-700">{field.implication}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Quick Presets</h2>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => applyPreset("hero")}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-700"
              >
                Hero Banner
              </button>
              <button
                type="button"
                onClick={() => applyPreset("testimonial")}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-700"
              >
                Testimonials
              </button>
              <button
                type="button"
                onClick={() => applyPreset("cta")}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-700"
              >
                Call To Action
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Actions</h2>
            <div className="space-y-2">
              <button
                type="button"
                onClick={runValidation}
                className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                Validate & Unlock Export
              </button>
              <button
                type="button"
                onClick={generateWithAi}
                disabled={aiGenerating}
                className="w-full rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-100 disabled:opacity-60"
              >
                {aiGenerating ? "Generating via AI..." : "Generate via AI (Codex CLI)"}
              </button>
              {aiGenerating && (
                <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-2">
                  <div className="mb-1 text-xs font-semibold text-cyan-800">AI generation in progress: {aiProgress}%</div>
                  <div className="h-2 rounded-full bg-cyan-100">
                    <div
                      className="h-2 rounded-full bg-cyan-600 transition-all"
                      style={{ width: `${aiProgress}%` }}
                    />
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={downloadSpec}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-700"
              >
                Download spec.json
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-700"
              >
                Import spec.json
              </button>
              <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={importSpec} className="hidden" />
              <button
                type="button"
                onClick={loadDraft}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-700"
              >
                Load last draft
              </button>
              <button
                type="button"
                onClick={clearDraft}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-700"
              >
                Clear saved draft
              </button>
              <button
                type="button"
                onClick={doExportZip}
                disabled={loadingZip || !isExportUnlocked}
                className="w-full rounded-xl bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-60"
              >
                {loadingZip ? "Exporting..." : "Export ZIP"}
              </button>
              <button
                type="button"
                onClick={addCurrentToBundle}
                className="w-full rounded-xl border border-teal-300 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-100"
              >
                Add Current CE To Bundle
              </button>
              <button
                type="button"
                onClick={exportBundleZip}
                disabled={loadingBundleZip || bundle.length === 0}
                className="w-full rounded-xl bg-cyan-700 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-60"
              >
                {loadingBundleZip ? "Exporting Bundle..." : `Export Bundle ZIP (${bundle.length})`}
              </button>
              <p className="text-xs text-slate-500">
                Export unlocks only after a successful validation on the current draft.
              </p>
              {aiUsage && (
                <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-2 text-xs text-cyan-900">
                  <div className="font-semibold">Last AI Run</div>
                  <div>Model: {aiUsage.model || "n/a"}</div>
                  <div>Tokens: {aiUsage.totalTokens ?? "n/a"}</div>
                  <button
                    type="button"
                    onClick={() => setShowAiReportModal(true)}
                    className="mt-1 rounded-lg border border-cyan-300 bg-white px-2 py-1 font-semibold text-cyan-800 hover:bg-cyan-100"
                  >
                    View AI Report
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Bundle Manager</h2>
            <div className="space-y-2 rounded-xl border border-slate-300 bg-slate-50 p-3">
              {bundle.length === 0 ? (
                <p className="text-xs text-slate-600">No bundled content elements yet.</p>
              ) : (
                bundle.map((item) => (
                  <div key={item.meta.cTypeKey} className="rounded-lg border border-slate-200 bg-white p-2.5">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-800">{item.meta.elementName}</p>
                      <span className="rounded-md bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-800">
                        {item.meta.cTypeKey}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {item.meta.vendorName}/{item.meta.extensionKey}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => loadBundleElement(item)}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-700"
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFromBundle(item.meta.cTypeKey)}
                        className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">First-Time Checklist</h2>
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-600">
                <span>Readiness</span>
                <span>{Math.round(((Number(metaValid) + Number(fields.length > 0) + Number(isExportUnlocked)) / 3) * 100)}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full bg-teal-600 transition-all"
                  style={{
                    width: `${Math.round(((Number(metaValid) + Number(fields.length > 0) + Number(isExportUnlocked)) / 3) * 100)}%`
                  }}
                />
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs">
              <p className={cx("font-medium", metaValid ? "text-emerald-700" : "text-slate-600")}>
                {metaValid ? "✓" : "•"} Meta fields are valid
              </p>
              <p className={cx("font-medium", fields.length > 0 ? "text-emerald-700" : "text-slate-600")}>
                {fields.length > 0 ? "✓" : "•"} At least one field is added
              </p>
              <p className={cx("font-medium", isExportUnlocked ? "text-emerald-700" : "text-slate-600")}>
                {isExportUnlocked ? "✓" : "•"} Validation passed and export unlocked
              </p>
            </div>
          </section>
        </aside>

        <main className="space-y-6">
          {fields.length === 0 && (
            <section className="rounded-3xl border border-amber-300/70 bg-amber-50/70 p-5 shadow-lg shadow-amber-900/5 backdrop-blur-sm">
              <h2 className="mb-2 text-lg font-semibold text-slate-900">Guided Start (Step-by-Step)</h2>
              <p className="mb-4 text-sm text-slate-700">
                Follow these steps once; after that you can use presets or build manually.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className={cx(
                    "rounded-xl border px-3 py-3 text-left",
                    metaValid ? "border-emerald-300 bg-emerald-50" : "border-slate-300 bg-white"
                  )}
                >
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">Step 1</div>
                  <div className="text-sm font-semibold text-slate-900">Complete metadata</div>
                  <div className="text-xs text-slate-600">{metaCompletion}/6 fields filled</div>
                </button>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className={cx(
                    "rounded-xl border px-3 py-3 text-left",
                    fields.length > 0 ? "border-emerald-300 bg-emerald-50" : "border-slate-300 bg-white"
                  )}
                >
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">Step 2</div>
                  <div className="text-sm font-semibold text-slate-900">Add blocks or use preset</div>
                  <div className="text-xs text-slate-600">{fields.length} fields added</div>
                </button>
                <button
                  type="button"
                  onClick={runValidation}
                  className={cx(
                    "rounded-xl border px-3 py-3 text-left",
                    isExportUnlocked ? "border-emerald-300 bg-emerald-50" : "border-slate-300 bg-white"
                  )}
                >
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">Step 3</div>
                  <div className="text-sm font-semibold text-slate-900">Validate configuration</div>
                  <div className="text-xs text-slate-600">{isExportUnlocked ? "Export unlocked" : "Pending validation"}</div>
                </button>
                <button
                  type="button"
                  onClick={generateWithAi}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-left"
                >
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">Step 4</div>
                  <div className="text-sm font-semibold text-slate-900">Generate template via AI</div>
                  <div className="text-xs text-slate-600">If AI is not run, template stays empty</div>
                </button>
              </div>
            </section>
          )}

          <section className="rounded-3xl border border-slate-300/70 bg-white/80 p-5 shadow-lg shadow-slate-900/5 backdrop-blur-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Step 2/3: Builder + Layout</h2>
              <div className="text-sm text-slate-600">{fields.length} fields</div>
            </div>

            {fields.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">
                Add your first block from the left panel.
              </p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-3">
                    {fields.map((field) => (
                      <SortableFieldCard
                        key={field.id}
                        field={field}
                        onChange={updateField}
                        onDelete={(id) => setFields((prev) => prev.filter((f) => f.id !== id))}
                        errors={validation.fieldErrors[field.id] ?? []}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <article className="rounded-3xl border border-slate-300/70 bg-white/80 p-5 shadow-lg shadow-slate-900/5 backdrop-blur-sm">
              <h2 className="mb-3 text-lg font-semibold text-slate-900">Step 4: Validation Results</h2>
              {validation.formErrors.length === 0 && Object.keys(validation.fieldErrors).length === 0 ? (
                <p className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">No validation errors.</p>
              ) : (
                <>
                  {validation.formErrors.length > 0 && (
                    <ul className="mb-3 list-disc space-y-1 rounded-xl border border-red-200 bg-red-50 p-4 pl-8 text-sm text-red-700">
                      {validation.formErrors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  )}
                  {Object.keys(validation.fieldErrors).length > 0 && (
                    <p className="text-sm text-slate-600">Fix field-level errors shown in cards above.</p>
                  )}
                </>
              )}
            </article>

            <article className="rounded-3xl border border-slate-300/70 bg-white/80 p-5 shadow-lg shadow-slate-900/5 backdrop-blur-sm">
              <h2 className="mb-3 text-lg font-semibold text-slate-900">Step 5: AI Assist (Codex CLI)</h2>
              <p className="mb-3 text-sm text-slate-600">
                Generate directly via Codex CLI from this UI, or copy the prompt for manual CLI usage.
              </p>
              <button
                type="button"
                onClick={generateWithAi}
                disabled={aiGenerating}
                className="mb-2 mr-2 rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-800 hover:bg-cyan-100 disabled:opacity-60"
              >
                {aiGenerating ? "Generating..." : "Generate from AI now"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(buildCodexPrompt(spec));
                    setStatus({ type: "ok", text: "Codex prompt copied to clipboard." });
                  } catch {
                    setStatus({ type: "error", text: "Clipboard copy failed. Copy manually from textbox." });
                  }
                }}
                className="mb-2 rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-700"
              >
                Copy Prompt
              </button>
              <textarea
                readOnly
                value={buildCodexPrompt(spec)}
                className="h-48 w-full rounded-xl border border-slate-300 bg-slate-950 p-3 font-mono text-xs text-teal-200"
              />
            </article>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <article className="rounded-3xl border border-slate-300/70 bg-white/80 p-5 shadow-lg shadow-slate-900/5 backdrop-blur-sm">
              <h2 className="mb-3 text-lg font-semibold text-slate-900">Step 6: Backend Form Preview</h2>
              <div className="space-y-4">
                {TABS.map((tab) => {
                  const items = fields.filter((field) => field.tab === tab);
                  return (
                    <div key={tab} className="rounded-xl border border-slate-300 p-3">
                      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">{tab}</h3>
                      {items.length === 0 ? (
                        <p className="text-xs text-slate-500">No fields in this tab.</p>
                      ) : (
                        <div className="space-y-2">
                          {items.map((field) => (
                            <div key={field.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                              <div className="font-medium text-slate-800">{field.label}</div>
                              <div className="text-xs text-slate-500">{field.key}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="rounded-3xl border border-slate-300/70 bg-white/80 p-5 shadow-lg shadow-slate-900/5 backdrop-blur-sm">
              <h2 className="mb-3 text-lg font-semibold text-slate-900">Step 6: Frontend Render Preview</h2>
              <div className="prose prose-sm max-w-none rounded-xl border border-slate-300 bg-white p-4">
                {fields.length === 0 ? (
                  <p className="text-slate-500">No fields yet.</p>
                ) : (
                  fields.map((field) => (
                    <div key={field.id} className="mb-2 rounded-lg border border-slate-200 p-2">
                      <strong>{field.label}</strong>
                      <div className="text-xs text-slate-500">{field.type}</div>
                      {field.defaultValue && <div className="text-sm text-slate-700">{field.defaultValue}</div>}
                    </div>
                  ))
                )}
              </div>

              <label className="mt-4 block text-sm">
                <span className="mb-1 block font-medium text-slate-700">
                  Generated Fluid Template (editable){" "}
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                    {templateSource === "ai"
                      ? "Generated from AI"
                      : templateSource === "manual"
                        ? "Edited manually"
                        : "No template output"}
                  </span>
                </span>
                <textarea
                  value={templateHtml}
                  onChange={(e) => {
                    setTemplateHtml(e.target.value);
                    setTemplateSource("manual");
                  }}
                  className="h-44 w-full rounded-xl border border-slate-300 bg-slate-950 p-3 font-mono text-xs text-teal-200"
                />
              </label>
            </article>
          </section>
          <section className="rounded-3xl border border-slate-300/70 bg-white/80 p-5 shadow-lg shadow-slate-900/5 backdrop-blur-sm">
            <h2 className="mb-3 text-lg font-semibold text-slate-900">Step 7: Generated Files</h2>
            <p className="mb-3 text-sm text-slate-600">
              Export includes a TYPO3 extension-ready structure with these files:
            </p>
            <div className="max-h-56 overflow-auto rounded-xl border border-slate-300 bg-slate-950 p-3 font-mono text-xs text-teal-200">
              {generatedFileList.map((path) => (
                <div key={path}>{path}</div>
              ))}
            </div>
          </section>
        </main>
      </div>
      {showAiReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-300 bg-white p-5 shadow-2xl">
            <h3 className="mb-2 text-lg font-semibold text-slate-900">AI Generation Report</h3>
            <div className="space-y-1 text-sm text-slate-700">
              <div>
                <span className="font-semibold">Element:</span> {meta.elementName} ({meta.cTypeKey})
              </div>
              <div>
                <span className="font-semibold">Generated at:</span> {aiGeneratedAt || "n/a"}
              </div>
              <div>
                <span className="font-semibold">Model:</span> {aiUsage?.model || "n/a"}
              </div>
              <div>
                <span className="font-semibold">Input tokens:</span> {aiUsage?.inputTokens ?? "n/a"}
              </div>
              <div>
                <span className="font-semibold">Output tokens:</span> {aiUsage?.outputTokens ?? "n/a"}
              </div>
              <div>
                <span className="font-semibold">Total tokens:</span> {aiUsage?.totalTokens ?? "n/a"}
              </div>
              <div>
                <span className="font-semibold">Template output:</span>{" "}
                {templateHtml.trim() ? "Available" : "No template output"}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  downloadText(
                    JSON.stringify(
                      {
                        generatedAt: aiGeneratedAt,
                        meta: {
                          vendorName: meta.vendorName,
                          extensionKey: meta.extensionKey,
                          elementName: meta.elementName,
                          cTypeKey: meta.cTypeKey,
                          iconName: meta.iconName
                        },
                        usage: aiUsage,
                        hasTemplateOutput: Boolean(templateHtml.trim())
                      },
                      null,
                      2
                    ),
                    `${meta.cTypeKey || "content_element"}_ai_report.json`,
                    "application/json;charset=utf-8"
                  )
                }
                className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800 hover:bg-cyan-100"
              >
                Download Report
              </button>
              <button
                type="button"
                onClick={() => setShowAiReportModal(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
