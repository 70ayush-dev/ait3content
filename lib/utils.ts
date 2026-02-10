import { RESERVED_KEYS } from "./constants";
import { BuilderSpec, FieldDefinition, ValidationResult } from "./types";

const KEY_REGEX = /^[a-z][a-z0-9_]*$/;

const xmlEscape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const phpSingleQuoteEscape = (value: string): string => value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const makeField = (type: FieldDefinition["type"], index: number): FieldDefinition => ({
  id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  key: `${type}_${index + 1}`,
  label: `${type.toUpperCase()} ${index + 1}`,
  type,
  required: false,
  defaultValue: "",
  helpText: "",
  tab: "content",
  maxLength: type === "input" || type === "textarea" ? 255 : undefined,
  maxItems: type === "media" || type === "repeater" ? 1 : undefined,
  options: type === "select" ? ["Option A", "Option B"] : undefined,
  repeaterFields:
    type === "repeater"
      ? [
          {
            id: `rf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            key: "item_title",
            label: "Item Title",
            type: "input",
            required: true,
            defaultValue: "",
            helpText: "",
            tab: "content",
            maxLength: 255
          }
        ]
      : undefined
});

const ensureFieldKeyValidation = (field: FieldDefinition, errors: string[], keyPool: Set<string>) => {
  if (!field.key || !KEY_REGEX.test(field.key)) {
    errors.push("Field key must be snake_case and start with a letter.");
  }
  if (RESERVED_KEYS.includes(field.key)) {
    errors.push(`Field key \"${field.key}\" is reserved by TYPO3.`);
  }
  if (keyPool.has(field.key)) {
    errors.push(`Field key \"${field.key}\" must be unique.`);
  }
  keyPool.add(field.key);
};

export const validateSpec = (spec: BuilderSpec): ValidationResult => {
  const formErrors: string[] = [];
  const fieldErrors: Record<string, string[]> = {};

  if (!spec.meta.extensionKey || !KEY_REGEX.test(spec.meta.extensionKey)) {
    formErrors.push("Extension key must be snake_case and start with a letter.");
  }
  if (!spec.meta.cTypeKey || !KEY_REGEX.test(spec.meta.cTypeKey)) {
    formErrors.push("CType key must be snake_case and start with a letter.");
  }
  if (!spec.meta.elementName.trim()) {
    formErrors.push("Content element name is required.");
  }

  const seenTopLevel = new Set<string>();
  for (const field of spec.fields) {
    const errors: string[] = [];
    ensureFieldKeyValidation(field, errors, seenTopLevel);

    if (field.type === "repeater") {
      if ((field.repeaterFields || []).length === 0) {
        errors.push("Repeater must contain at least one sub-field.");
      }
      if ((field.repeaterFields || []).some((f) => f.type === "repeater")) {
        errors.push("Nested repeater depth > 1 is not allowed in MVP.");
      }

      const repeaterSeen = new Set<string>();
      for (const subField of field.repeaterFields || []) {
        ensureFieldKeyValidation(subField, errors, repeaterSeen);
        if (subField.type === "select" && (!subField.options || subField.options.length === 0)) {
          errors.push(`Repeater sub-field \"${subField.key}\" must contain select options.`);
        }
      }
    }

    if (field.type === "select" && (!field.options || field.options.length === 0)) {
      errors.push("Select field must contain at least one option.");
    }

    if (errors.length > 0) {
      fieldErrors[field.id] = errors;
    }
  }

  if (spec.fields.length === 0) {
    formErrors.push("Add at least one field.");
  }

  return { formErrors, fieldErrors };
};

export const buildCodexPrompt = (spec: BuilderSpec): string => {
  return [
    "You are generating TYPO3 content element metadata + Fluid template suggestions.",
    "Return ONLY valid JSON, no markdown fences, no explanations.",
    "Do NOT invent field keys. Use only keys from the input spec.",
    "Use snake_case for cTypeKey and lowercase-dash style for iconName (example: content-hero-banner).",
    "templateHtml must be Fluid-compatible and include <f:layout name=\"Default\" /> and <f:section name=\"Main\">.",
    "Use {data.<fieldKey>} for regular values and media_<fieldKey> variables for media fields.",
    "JSON shape:",
    JSON.stringify(
      {
        elementName: "Human readable content element title",
        cTypeKey: "snake_case_ctype_key",
        iconName: "content-identifier",
        fieldLabels: {
          "<existing_field_key>": "Improved label"
        },
        templateHtml: "<f:layout name=\"Default\" />\n<f:section name=\"Main\">...</f:section>"
      },
      null,
      2
    ),
    "JSON SPEC:",
    JSON.stringify(spec, null, 2)
  ].join("\n\n");
};

export const generateTemplate = (fields: FieldDefinition[]): string => {
  const renderFieldValue = (field: FieldDefinition, scope = "data"): string => {
    const source = `{${scope}.${field.key}}`;
    if (field.type === "rte") {
      return `{${scope}.${field.key} -> f:format.raw()}`;
    }
    if (field.type === "checkbox") {
      return `<f:if condition="${source}"><span>Enabled</span></f:if>`;
    }
    if (field.type === "media") {
      return `<f:if condition="${source}"><span>[Media selected]</span></f:if>`;
    }
    return source;
  };

  const lines = fields.map((field) => {
    const safeLabel = xmlEscape(field.label);
    if (field.type === "checkbox") {
      return `  <f:if condition=\"{data.${field.key}}\"><p>${safeLabel}: Enabled</p></f:if>`;
    }
    if (field.type === "media") {
      return `  <f:if condition=\"{media_${field.key}}\"><f:for each=\"{media_${field.key}}\" as=\"file\"><f:image image=\"{file}\" alt=\"${safeLabel}\" /></f:for></f:if>`;
    }
    if (field.type === "repeater") {
      const nonRepeaterFields = (field.repeaterFields || []).filter((f) => f.type !== "repeater");
      const itemContent =
        nonRepeaterFields.length > 0
          ? nonRepeaterFields
              .map((f) => {
                if (f.type === "media") {
                  return `<f:if condition="{item.${f.key}Files}"><f:for each="{item.${f.key}Files}" as="file"><f:image image="{file}" alt="${xmlEscape(
                    f.label
                  )}" /></f:for></f:if>`;
                }
                return `<p><strong>${xmlEscape(f.label)}:</strong> ${renderFieldValue(f as FieldDefinition, "item")}</p>`;
              })
              .join("")
          : "<p>[Repeater item]</p>";
      return `  <f:if condition=\"{${field.key}}\"><f:for each=\"{${field.key}}\" as=\"item\"><div class=\"item\">${itemContent}</div></f:for></f:if>`;
    }
    return `  <f:if condition=\"{data.${field.key}}\"><p>${safeLabel}: ${renderFieldValue(field)}</p></f:if>`;
  });

  return [
    '<f:layout name="Default" />',
    '<f:section name="Main">',
    '<section class="ce-builder-output">',
    ...lines,
    "</section>",
    "</f:section>"
  ].join("\n");
};

const resolveTemplateHtml = (spec: BuilderSpec): string => {
  const candidate = spec.templateHtml?.trim();
  return candidate || "";
};

const toTypo3Identifier = (value: string): string =>
  value
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");

const toTemplateName = (cType: string): string => {
  const normalized = toTypo3Identifier(cType);
  if (!normalized) {
    return "Default";
  }
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
};

const generateInitialIconSvg = (spec: BuilderSpec): string => {
  const seed = `${spec.meta.elementName}${spec.meta.cTypeKey}`.trim();
  const initial = (seed[0] || "C").toUpperCase();
  const palette = [
    { bg: "#0f766e", fg: "#ecfeff" },
    { bg: "#1d4ed8", fg: "#eff6ff" },
    { bg: "#7c3aed", fg: "#f5f3ff" },
    { bg: "#be123c", fg: "#fff1f2" },
    { bg: "#475569", fg: "#f8fafc" },
    { bg: "#b45309", fg: "#fffbeb" }
  ];
  const idx = seed.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0) % palette.length;
  const colors = palette[idx];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${xmlEscape(
    spec.meta.elementName || "Content Element"
  )}">
  <rect width="64" height="64" rx="12" fill="${colors.bg}" />
  <text x="32" y="42" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="${colors.fg}">${xmlEscape(
    initial
  )}</text>
</svg>`;
};

const repeaterTableName = (ext: string, cType: string, fieldKey: string): string =>
  toTypo3Identifier(`tx_${ext}_${cType}_${fieldKey}`);

const repeaterFields = (spec: BuilderSpec): FieldDefinition[] => spec.fields.filter((field) => field.type === "repeater");

const tcaConfigByField = (field: FieldDefinition, ext: string, cType: string): string => {
  const label = `LLL:EXT:__EXT__/Resources/Private/Language/locallang_${toTypo3Identifier(
    cType
  )}.xlf:field.${field.key}.label`;

  if (field.type === "input") {
    return `['exclude' => true, 'label' => '${label}', 'config' => ['type' => 'input', 'size' => 50, 'eval' => '${
      field.required ? "trim,required" : "trim"
    }', 'max' => ${field.maxLength ?? 255}]]`;
  }
  if (field.type === "textarea" || field.type === "rte") {
    return `['exclude' => true, 'label' => '${label}', 'config' => ['type' => 'text', 'rows' => ${
      field.type === "rte" ? 8 : 5
    }, 'enableRichtext' => ${field.type === "rte" ? "true" : "false"}]]`;
  }
  if (field.type === "media") {
    return `['exclude' => true, 'label' => '${label}', 'config' => ['type' => 'file', 'maxitems' => ${field.maxItems ?? 1}]]`;
  }
  if (field.type === "link") {
    return `['exclude' => true, 'label' => '${label}', 'config' => ['type' => 'input', 'renderType' => 'inputLink', 'size' => 50]]`;
  }
  if (field.type === "select") {
    const items = (field.options || ["Option"])
      .map((option) => `['${phpSingleQuoteEscape(option)}', '${phpSingleQuoteEscape(option)}']`)
      .join(", ");
    return `['exclude' => true, 'label' => '${label}', 'config' => ['type' => 'select', 'renderType' => 'selectSingle', 'items' => [${items}]]]`;
  }
  if (field.type === "checkbox") {
    return `['exclude' => true, 'label' => '${label}', 'config' => ['type' => 'check', 'default' => 0]]`;
  }
  if (field.type === "repeater") {
    const foreignTable = repeaterTableName(ext, cType, field.key);
    const foreignField = toTypo3Identifier(field.key);
    return `[
            'exclude' => true,
            'label' => '${label}',
            'config' => [
                'type' => 'inline',
                'foreign_table' => '${foreignTable}',
                'foreign_field' => 'parentid',
                'foreign_table_field' => 'parenttable',
                'foreign_match_fields' => [
                    'parentfield' => '${foreignField}',
                ],
                'appearance' => [
                    'collapseAll' => 1,
                    'newRecordLinkAddTitle' => 1,
                    'levelLinksPosition' => 'top',
                    'useSortable' => 1,
                    'showSynchronizationLink' => 0,
                    'showAllLocalizationLink' => 0
                ],
                'foreign_sortby' => 'sorting',
                'minitems' => ${field.required ? 1 : 0},
                'maxitems' => ${field.maxItems ?? 999}
            ]
        ]`;
  }
  return `['exclude' => true, 'label' => '${label}', 'config' => ['type' => 'text', 'rows' => 5]]`;
};

export const generateTcaOverridePhp = (spec: BuilderSpec): string => {
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  const cType = toTypo3Identifier(spec.meta.cTypeKey);
  const icon = toTypo3Identifier(spec.meta.iconName || `${cType}_icon`);
  const group = toTypo3Identifier(spec.meta.group || "default");
  const titleLabel = `LLL:EXT:${ext}/Resources/Private/Language/locallang_${cType}.xlf:ce.${cType}.title`;
  const tcaColumns = spec.fields
    .map((field) => {
      const key = toTypo3Identifier(field.key);
      const config = tcaConfigByField(field, ext, cType).replace("__EXT__", ext);
      return `        '${key}' => ${config}`;
    })
    .join(",\n");
  const showItems = spec.fields.map((field) => toTypo3Identifier(field.key)).join(",\n                ");

return `<?php
defined('TYPO3') || die();

call_user_func(static function (): void {
    $cType = '${cType}';
    $iconIdentifier = '${icon}';

    // Register CType in new content element wizard/group.
    \\TYPO3\\CMS\\Core\\Utility\\ExtensionManagementUtility::addTcaSelectItem(
        'tt_content',
        'CType',
        [
            'label' => '${titleLabel}',
            'value' => $cType,
            'icon' => $iconIdentifier,
            'group' => '${group}',
            'description' => 'LLL:EXT:${ext}/Resources/Private/Language/locallang_${cType}.xlf:ce.${cType}.description',
        ],
        'textmedia',
        'after'
    );

    // Register custom columns for this CType.
    \\TYPO3\\CMS\\Core\\Utility\\ExtensionManagementUtility::addTCAcolumns('tt_content', [
${tcaColumns}
    ]);

    // Configure form layout for this CType.
    $GLOBALS['TCA']['tt_content']['types'][$cType] = [
        'showitem' => '
            --palette--;;general,
            --palette--;;headers,
            ${showItems},
            --div--;LLL:EXT:core/Resources/Private/Language/Form/locallang_tabs.xlf:access,
                --palette--;;hidden,
                --palette--;;access
        ',
    ];

    $GLOBALS['TCA']['tt_content']['ctrl']['typeicon_classes'][$cType] = $iconIdentifier;
});
`;
};

export const generateIconsPhp = (spec: BuilderSpec): string => {
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  const icon = toTypo3Identifier(spec.meta.iconName || `${spec.meta.cTypeKey}_icon`);

  return `<?php
return [
    '${icon}' => [
        'provider' => \\TYPO3\\CMS\\Core\\Imaging\\IconProvider\\SvgIconProvider::class,
        'source' => 'EXT:${ext}/Resources/Public/Icons/${icon}.svg',
    ],
];
`;
};

export const generateTypoScriptSetup = (spec: BuilderSpec): string => {
  const cType = toTypo3Identifier(spec.meta.cTypeKey);
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  const templateName = toTemplateName(cType);
  const mediaFields = spec.fields.filter((field) => field.type === "media");
  const topLevelMediaProcessing = mediaFields
    .map(
      (field, i) => `  dataProcessing.${120 + i * 2} = TYPO3\\CMS\\Frontend\\DataProcessing\\FilesProcessor
  dataProcessing.${120 + i * 2} {
    references {
      table = tt_content
      uid.field = uid
      fieldName = ${toTypo3Identifier(field.key)}
    }
    as = media_${toTypo3Identifier(field.key)}
  }
  dataProcessing.${121 + i * 2} = TYPO3\\CMS\\Frontend\\DataProcessing\\FilesProcessor
  dataProcessing.${121 + i * 2} {
    references {
      table = tt_content
      uid.field = uid
      fieldName = ${toTypo3Identifier(field.key)}
    }
    as = ${toTypo3Identifier(field.key)}
  }`
    )
    .join("\n");
  const repeaterProcessing = repeaterFields(spec)
    .map((field, i) => {
      const table = repeaterTableName(ext, cType, field.key);
      const childMedia = (field.repeaterFields || []).filter((subField) => subField.type === "media");
      const childMediaProcessing = childMedia
        .map(
          (mediaField, idx) => `    dataProcessing.${20 + idx} = TYPO3\\CMS\\Frontend\\DataProcessing\\FilesProcessor
    dataProcessing.${20 + idx} {
      references {
        table = ${table}
        uid.field = uid
        fieldName = ${toTypo3Identifier(mediaField.key)}
      }
      as = ${toTypo3Identifier(mediaField.key)}Files
    }`
        )
        .join("\n");
      return `  dataProcessing.${210 + i} = TYPO3\\CMS\\Frontend\\DataProcessing\\DatabaseQueryProcessor
  dataProcessing.${210 + i} {
    table = ${table}
    pidInList.field = pid
    where.dataWrap = parentid={field:uid}
    orderBy = sorting
    as = ${toTypo3Identifier(field.key)}
${childMediaProcessing ? `${childMediaProcessing}\n` : ""}
  }`;
    })
    .join("\n");
  const dataProcessing = [topLevelMediaProcessing, repeaterProcessing].filter(Boolean).join("\n");

  return `tt_content.${cType} =< lib.contentElement
tt_content.${cType} {
  templateName = ${templateName}
  templateRootPaths.170 = EXT:${ext}/Resources/Private/Templates/ContentElements/
  partialRootPaths.170 = EXT:${ext}/Resources/Private/Partials/
  layoutRootPaths.170 = EXT:${ext}/Resources/Private/Layouts/
${dataProcessing ? `${dataProcessing}\n` : ""}}
`;
};

export const generateTypoScriptConstants = (spec: BuilderSpec): string => {
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  return `plugin.tx_${ext} {
  view {
    templateRootPath = EXT:${ext}/Resources/Private/Templates/ContentElements/
    partialRootPath = EXT:${ext}/Resources/Private/Partials/
    layoutRootPath = EXT:${ext}/Resources/Private/Layouts/
  }
}
`;
};

export const generateExtEmconfPhp = (spec: BuilderSpec): string => {
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  const elementName = phpSingleQuoteEscape(spec.meta.elementName);

  return `<?php
$EM_CONF[$_EXTKEY] = [
    'title' => '${elementName}',
    'description' => 'Generated TYPO3 custom content element (${toTypo3Identifier(spec.meta.cTypeKey)})',
    'category' => 'fe',
    'author' => 'ait3content-builder',
    'state' => 'beta',
    'clearCacheOnLoad' => 1,
    'version' => '0.1.0',
    'constraints' => [
        'depends' => [
            'typo3' => '12.4.0-12.4.99',
        ],
        'conflicts' => [],
        'suggests' => [],
    ],
];
`;
};

export const generateComposerJson = (spec: BuilderSpec): string => {
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  const vendor = toTypo3Identifier(spec.meta.vendorName || "vendor");

  return JSON.stringify(
    {
      name: `${vendor}/${ext}`,
      version: "1.0.0",
      type: "typo3-cms-extension",
      description: `Generated TYPO3 content element: ${spec.meta.elementName}`,
      license: "proprietary",
      require: {
        "typo3/cms-core": "^12.4",
        "typo3/cms-frontend": "^12.4",
        "typo3/cms-fluid-styled-content": "^12.4"
      },
      extra: {
        "typo3/cms": {
          "extension-key": ext
        }
      }
    },
    null,
    2
  );
};

export const generateImportReadme = (spec: BuilderSpec): string => {
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  const cType = toTypo3Identifier(spec.meta.cTypeKey);
  return `# Import Guide (${ext})

This package is generated as a local TYPO3 extension and is **not published on Packagist**.

## Composer mode (recommended)

1. Copy this folder to \`packages/${ext}\`.
2. In TYPO3 project root, register local path repository:
   \`ddev composer config repositories.${ext} path packages/${ext}\`
3. Require package:
   \`ddev composer req vendor/${ext}:1.0.0\`
4. Run DB updates and flush caches.

## Classic mode (without Composer package install)

1. Copy this folder to \`public/typo3conf/ext/${ext}\` (or \`typo3conf/ext/${ext}\` depending on setup).
2. Activate extension in TYPO3 backend.
3. Run DB compare/update and flush caches.

## Result

Add new content element \`${cType}\` from New Content Element wizard.
`;
};

export const generatePageTsConfig = (spec: BuilderSpec): string => {
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  const cType = toTypo3Identifier(spec.meta.cTypeKey);
  const icon = toTypo3Identifier(spec.meta.iconName || `${cType}_icon`);
  const group = toTypo3Identifier(spec.meta.group || "custom");
  const templateName = toTemplateName(cType);

  return `mod.wizards.newContentElement.wizardItems.${group} {
  header = ${spec.meta.group || "Custom"}
  elements {
    ${cType} {
      iconIdentifier = ${icon}
      title = LLL:EXT:${ext}/Resources/Private/Language/locallang_${cType}.xlf:ce.${cType}.title
      description = LLL:EXT:${ext}/Resources/Private/Language/locallang_${cType}.xlf:ce.${cType}.description
      tt_content_defValues {
        CType = ${cType}
      }
    }
  }
  show := addToList(${cType})
}

mod.web_layout.tt_content {
  preview {
    ${cType} = EXT:${ext}/Resources/Private/Templates/Preview/${templateName}.html
  }
}
`;
};

export const generatePageTsConfigImport = (spec: BuilderSpec): string => {
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  const cType = toTypo3Identifier(spec.meta.cTypeKey);
  const templateName = toTemplateName(cType);
  return `@import 'EXT:${ext}/Configuration/TsConfig/Page/ContentElement/Element/${templateName}.tsconfig'`;
};

export const generateTypoScriptSetupImport = (spec: BuilderSpec): string => {
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  const cType = toTypo3Identifier(spec.meta.cTypeKey);
  const templateName = toTemplateName(cType);
  return `@import 'EXT:${ext}/Configuration/TypoScript/ContentElement/Element/${templateName}.typoscript'`;
};

export const generateExtTablesPhp = (spec: BuilderSpec): string => {
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  const cType = toTypo3Identifier(spec.meta.cTypeKey);
  const allowTables = repeaterFields(spec)
    .map((field) => repeaterTableName(ext, cType, field.key))
    .map(
      (table) =>
        `\\TYPO3\\CMS\\Core\\Utility\\ExtensionManagementUtility::allowTableOnStandardPages('${table}');`
    )
    .join("\n");

  return `<?php
defined('TYPO3') || die();
${allowTables ? `\n${allowTables}\n` : ""}
`;
};

export const generateExtLocalconfPhp = (spec: BuilderSpec): string => {
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  return `<?php
defined('TYPO3') || die();

\\TYPO3\\CMS\\Core\\Utility\\ExtensionManagementUtility::addPageTSConfig(
    "@import 'EXT:${ext}/Configuration/page.tsconfig'"
);
`;
};

export const generateSysTemplateOverridePhp = (spec: BuilderSpec): string => {
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  const title = phpSingleQuoteEscape(`${spec.meta.elementName} (${toTypo3Identifier(spec.meta.cTypeKey)})`);

  return `<?php
defined('TYPO3') || die();

\\TYPO3\\CMS\\Core\\Utility\\ExtensionManagementUtility::addStaticFile(
    '${ext}',
    'Configuration/TypoScript',
    '${title}'
);
`;
};

export const generateBackendPreviewTemplate = (spec: BuilderSpec): string => {
  const title = xmlEscape(spec.meta.elementName);
  const previewRows = spec.fields
    .map((field) => {
      const key = toTypo3Identifier(field.key);
      const label = xmlEscape(field.label);
      const top = `{${key}}`;

      if (field.type === "checkbox") {
        return `<f:if condition="${top}">
  <tr>
    <td style="padding:4px 6px;font-weight:600;color:#334155;">${label}</td>
    <td style="padding:4px 6px;color:#0f766e;">Enabled</td>
  </tr>
</f:if>`;
      }

      if (field.type === "media") {
        return `<f:if condition="${top}">
  <tr>
    <td style="padding:4px 6px;font-weight:600;color:#334155;">${label}</td>
    <td style="padding:4px 6px;color:#334155;">Image attached (${top})</td>
  </tr>
</f:if>`;
      }

      if (field.type === "repeater") {
        return `<f:if condition="${top}">
  <tr>
    <td style="padding:4px 6px;font-weight:600;color:#334155;">${label}</td>
    <td style="padding:4px 6px;color:#334155;">${top} item(s)</td>
  </tr>
</f:if>`;
      }

      return `<f:if condition="${top}">
  <tr>
    <td style="padding:4px 6px;font-weight:600;color:#334155;">${label}</td>
    <td style="padding:4px 6px;color:#334155;">{${key} -> f:format.crop(maxCharacters:120)}</td>
  </tr>
</f:if>`;
    })
    .join("\n");

  return `<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers" data-namespace-typo3-fluid="true">
<div class="typo3-backend-preview" style="padding:10px;border:1px solid #d1d5db;border-radius:8px;background:#ffffff;">
  <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px;">
    <strong style="color:#0f172a;">${title}</strong>
    <span style="font-size:11px;color:#64748b;">CType: ${toTypo3Identifier(spec.meta.cTypeKey)}</span>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:12px;">
    <tbody>
${previewRows || '      <tr><td style="padding:4px 6px;color:#64748b;">No fields configured.</td></tr>'}
    </tbody>
  </table>
</div>
</html>
`;
};

export const generateLocallangXlf = (spec: BuilderSpec): string => {
  const cType = toTypo3Identifier(spec.meta.cTypeKey);
  const fieldTransUnits = spec.fields
    .flatMap((field) => {
      const base = `<trans-unit id="field.${field.key}.label"><source>${xmlEscape(field.label)}</source></trans-unit>`;
      if (field.type !== "repeater") {
        return [base];
      }
      const nested = (field.repeaterFields || []).flatMap((subField) => [
        // Flat key is used by generated child table TCA column configs.
        `<trans-unit id="field.${subField.key}.label"><source>${xmlEscape(subField.label)}</source></trans-unit>`,
        // Scoped key retained for readability/future use.
        `<trans-unit id="field.${field.key}.${subField.key}.label"><source>${xmlEscape(subField.label)}</source></trans-unit>`
      ]);
      return [base, ...nested];
    })
    .join("\n      ");

  return `<?xml version="1.0" encoding="utf-8"?>
<xliff version="1.0">
  <file source-language="en" datatype="plaintext" original="messages" date="${new Date().toISOString()}">
    <body>
      <trans-unit id="ce.${cType}.title"><source>${xmlEscape(spec.meta.elementName)}</source></trans-unit>
      <trans-unit id="ce.${cType}.description"><source>${xmlEscape(spec.meta.elementName)} content element</source></trans-unit>
      ${fieldTransUnits}
    </body>
  </file>
</xliff>
`;
};

export const generateManifest = (spec: BuilderSpec): string =>
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      tool: "ait3content-builder",
      typo3: "12 LTS",
      php: "8.2+",
      vendor: spec.meta.vendorName,
      cType: spec.meta.cTypeKey,
      extensionKey: spec.meta.extensionKey
    },
    null,
    2
  );

export const generateRepeaterTableTcaPhp = (spec: BuilderSpec, field: FieldDefinition): string => {
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  const cType = toTypo3Identifier(spec.meta.cTypeKey);
  const table = repeaterTableName(ext, cType, field.key);
  const labelField = toTypo3Identifier((field.repeaterFields || [])[0]?.key || "uid");
  const searchFields = (field.repeaterFields || []).map((f) => toTypo3Identifier(f.key)).join(",");
  const columns = (field.repeaterFields || [])
    .map((subField) => {
      const key = toTypo3Identifier(subField.key);
      const config = tcaConfigByField(subField as FieldDefinition, ext, cType).replace("__EXT__", ext);
      return `        '${key}' => ${config}`;
    })
    .join(",\n");
  const showItems = (field.repeaterFields || []).map((subField) => toTypo3Identifier(subField.key)).join(",\n            ");

  return `<?php
defined('TYPO3') || die();

return [
    'ctrl' => [
        'title' => 'LLL:EXT:${ext}/Resources/Private/Language/locallang_${cType}.xlf:field.${toTypo3Identifier(
    field.key
  )}.label',
        'label' => '${labelField}',
        'tstamp' => 'tstamp',
        'crdate' => 'crdate',
        'cruser_id' => 'cruser_id',
        'delete' => 'deleted',
        'sortby' => 'sorting',
        'hideTable' => true,
        'enablecolumns' => [
            'disabled' => 'hidden',
        ],
        'security' => [
            'ignorePageTypeRestriction' => true,
        ],
        'searchFields' => '${searchFields}',
        'iconfile' => 'EXT:${ext}/Resources/Public/Icons/${toTypo3Identifier(spec.meta.iconName || "default")}.svg',
    ],
    'columns' => [
        'pid' => ['config' => ['type' => 'passthrough']],
        'parentid' => ['config' => ['type' => 'passthrough']],
        'parenttable' => ['config' => ['type' => 'passthrough']],
        'parentfield' => ['config' => ['type' => 'passthrough']],
${columns ? `\n${columns}` : ""}
    ],
    'types' => [
        '1' => ['showitem' => '
            ${showItems}
        '],
    ],
];
`;
};

export const generateExtTablesSql = (spec: BuilderSpec): string => {
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  const cType = toTypo3Identifier(spec.meta.cTypeKey);
  const ttContentColumns = spec.fields.map((field) => {
    const key = toTypo3Identifier(field.key);
    if (field.type === "repeater") {
      // Inline relation fields require a parent column on tt_content.
      return `  ${key} int(11) unsigned DEFAULT '0' NOT NULL`;
    }
    if (field.type === "checkbox") {
      return `  ${key} smallint(5) unsigned DEFAULT '0' NOT NULL`;
    }
    if (field.type === "media") {
      return `  ${key} int(11) unsigned DEFAULT '0' NOT NULL`;
    }
    if (field.type === "input" || field.type === "link" || field.type === "select") {
      return `  ${key} varchar(255) DEFAULT '' NOT NULL`;
    }
    return `  ${key} text`;
  });

  const repeaterTablesSql = repeaterFields(spec)
    .map((field) => {
      const table = repeaterTableName(ext, cType, field.key);
      const childColumns = (field.repeaterFields || []).map((subField) => {
        const key = toTypo3Identifier(subField.key);
        if (subField.type === "checkbox") {
          return `  ${key} smallint(5) unsigned DEFAULT '0' NOT NULL`;
        }
        if (subField.type === "media") {
          return `  ${key} int(11) unsigned DEFAULT '0' NOT NULL`;
        }
        if (subField.type === "input" || subField.type === "link" || subField.type === "select") {
          return `  ${key} varchar(255) DEFAULT '' NOT NULL`;
        }
        return `  ${key} text`;
      });
      const columnLines = [...childColumns, "  PRIMARY KEY (uid)", "  KEY parent (parentid)", "  KEY parent_sort (parentid,sorting)"];

      return `
CREATE TABLE ${table} (
  uid int(11) NOT NULL auto_increment,
  pid int(11) DEFAULT '0' NOT NULL,
  tstamp int(11) unsigned DEFAULT '0' NOT NULL,
  crdate int(11) unsigned DEFAULT '0' NOT NULL,
  cruser_id int(11) unsigned DEFAULT '0' NOT NULL,
  deleted smallint(5) unsigned DEFAULT '0' NOT NULL,
  hidden smallint(5) unsigned DEFAULT '0' NOT NULL,
  sorting int(11) unsigned DEFAULT '0' NOT NULL,
  parentid int(11) unsigned DEFAULT '0' NOT NULL,
  parenttable varchar(255) DEFAULT '' NOT NULL,
  parentfield varchar(255) DEFAULT '' NOT NULL,
${columnLines.join(",\n")}
);`;
    })
    .join("\n");

  return `#
# Add custom content element columns
#
CREATE TABLE tt_content (
${ttContentColumns.join(",\n")}
);${repeaterTablesSql}
`;
};

export const buildGeneratedFiles = (spec: BuilderSpec): Record<string, string> => {
  const base = `${spec.meta.extensionKey}`;
  const cType = toTypo3Identifier(spec.meta.cTypeKey);
  const templateName = toTemplateName(cType);
  const iconName = toTypo3Identifier(spec.meta.iconName || "default");
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  const generatedTemplate = resolveTemplateHtml(spec);
  const setupElementPath = `${base}/Configuration/TypoScript/ContentElement/Element/${templateName}.typoscript`;
  const pageTsConfigElementPath = `${base}/Configuration/TsConfig/Page/ContentElement/Element/${templateName}.tsconfig`;
  const tcaOverridePath = `${base}/Configuration/TCA/Overrides/tt_content_${cType}.php`;
  const repeaterTableFiles = Object.fromEntries(
    repeaterFields(spec).map((field) => {
      const table = repeaterTableName(ext, cType, field.key);
      return [`${base}/Configuration/TCA/${table}.php`, generateRepeaterTableTcaPhp(spec, field)];
    })
  );

  return {
    [`${base}/README_IMPORT.md`]: generateImportReadme(spec),
    [`${base}/composer.json`]: generateComposerJson(spec),
    [`${base}/ext_emconf.php`]: generateExtEmconfPhp(spec),
    [`${base}/manifest.json`]: generateManifest(spec),
    [`${base}/spec.json`]: JSON.stringify(spec, null, 2),
    [`${base}/ext_tables.php`]: generateExtTablesPhp(spec),
    [`${base}/ext_localconf.php`]: generateExtLocalconfPhp(spec),
    [`${base}/ext_tables.sql`]: generateExtTablesSql(spec),
    [`${base}/Configuration/Icons.php`]: generateIconsPhp(spec),
    [`${base}/Configuration/page.tsconfig`]: `${generatePageTsConfigImport(spec)}\n`,
    [pageTsConfigElementPath]: generatePageTsConfig(spec),
    [`${base}/Configuration/TCA/Overrides/sys_template.php`]: generateSysTemplateOverridePhp(spec),
    [tcaOverridePath]: generateTcaOverridePhp(spec),
    ...repeaterTableFiles,
    [`${base}/Configuration/TypoScript/constants.typoscript`]: generateTypoScriptConstants(spec),
    [`${base}/Configuration/TypoScript/setup.typoscript`]: `${generateTypoScriptSetupImport(spec)}\n`,
    [setupElementPath]: generateTypoScriptSetup(spec),
    [`${base}/Resources/Private/Templates/ContentElements/${templateName}.html`]: generatedTemplate,
    [`${base}/Resources/Private/Templates/Preview/${templateName}.html`]: generateBackendPreviewTemplate(spec),
    [`${base}/Resources/Private/Partials/.gitkeep`]: "",
    [`${base}/Resources/Private/Layouts/.gitkeep`]: "",
    [`${base}/Resources/Private/Language/locallang_${cType}.xlf`]: generateLocallangXlf(spec),
    [`${base}/Resources/Public/Icons/${iconName}.svg`]: generateInitialIconSvg(spec)
  };
};

export const listGeneratedFilePaths = (spec: BuilderSpec): string[] => {
  const base = `${spec.meta.extensionKey}`;
  const cType = toTypo3Identifier(spec.meta.cTypeKey);
  const templateName = toTemplateName(cType);
  const iconName = toTypo3Identifier(spec.meta.iconName || "default");
  const ext = toTypo3Identifier(spec.meta.extensionKey);
  const repeaterTcaFiles = repeaterFields(spec).map(
    (field) => `${base}/Configuration/TCA/${repeaterTableName(ext, cType, field.key)}.php`
  );

  return [
    `${base}/README_IMPORT.md`,
    `${base}/composer.json`,
    `${base}/ext_emconf.php`,
    `${base}/manifest.json`,
    `${base}/spec.json`,
    `${base}/ext_tables.php`,
    `${base}/ext_localconf.php`,
    `${base}/ext_tables.sql`,
    `${base}/Configuration/Icons.php`,
    `${base}/Configuration/page.tsconfig`,
    `${base}/Configuration/TsConfig/Page/ContentElement/Element/${templateName}.tsconfig`,
    `${base}/Configuration/TCA/Overrides/sys_template.php`,
    `${base}/Configuration/TCA/Overrides/tt_content_${cType}.php`,
    ...repeaterTcaFiles,
    `${base}/Configuration/TypoScript/constants.typoscript`,
    `${base}/Configuration/TypoScript/setup.typoscript`,
    `${base}/Configuration/TypoScript/ContentElement/Element/${templateName}.typoscript`,
    `${base}/Resources/Private/Templates/ContentElements/${templateName}.html`,
    `${base}/Resources/Private/Templates/Preview/${templateName}.html`,
    `${base}/Resources/Private/Partials/.gitkeep`,
    `${base}/Resources/Private/Layouts/.gitkeep`,
    `${base}/Resources/Private/Language/locallang_${cType}.xlf`,
    `${base}/Resources/Public/Icons/${iconName}.svg`
  ];
};

export const createZipFromSpec = async (spec: BuilderSpec): Promise<Blob> => {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const files = buildGeneratedFiles(spec);
  const base = `${toTypo3Identifier(spec.meta.extensionKey)}/`;
  Object.entries(files).forEach(([path, content]) => {
    const zipPath = path.startsWith(base) ? path.slice(base.length) : path;
    zip.file(zipPath, content);
  });
  return zip.generateAsync({ type: "blob" });
};

export const createZipFromSpecs = async (specs: BuilderSpec[]): Promise<Blob> => {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  if (specs.length === 0) {
    return zip.generateAsync({ type: "blob" });
  }

  const first = specs[0];
  const ext = toTypo3Identifier(first.meta.extensionKey);
  const vendor = toTypo3Identifier(first.meta.vendorName || "vendor");
  const base = `${ext}`;
  const writeZipFile = (path: string, content: string) => {
    const zipPath = path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
    zip.file(zipPath, content);
  };

  const mismatch = specs.find(
    (spec) =>
      toTypo3Identifier(spec.meta.extensionKey) !== ext || toTypo3Identifier(spec.meta.vendorName || "vendor") !== vendor
  );
  if (mismatch) {
    throw new Error("All bundled elements must use the same vendor name and extension key.");
  }

  const uniqueByCType = new Map<string, BuilderSpec>();
  specs.forEach((spec) => {
    uniqueByCType.set(toTypo3Identifier(spec.meta.cTypeKey), spec);
  });
  const bundleSpecs = Array.from(uniqueByCType.values());

  const iconEntries = bundleSpecs
    .map((spec) => {
      const icon = toTypo3Identifier(spec.meta.iconName || `${spec.meta.cTypeKey}_icon`);
      return `    '${icon}' => [\n        'provider' => \\TYPO3\\CMS\\Core\\Imaging\\IconProvider\\SvgIconProvider::class,\n        'source' => 'EXT:${ext}/Resources/Public/Icons/${icon}.svg',\n    ]`;
    })
    .join(",\n");

  const pageTsConfigImports = bundleSpecs.map((spec) => generatePageTsConfigImport(spec)).join("\n");
  const typoScriptSetupImports = bundleSpecs.map((spec) => generateTypoScriptSetupImport(spec)).join("\n");
  const allowTables = Array.from(
    new Set(
      bundleSpecs.flatMap((spec) => {
        const cType = toTypo3Identifier(spec.meta.cTypeKey);
        return repeaterFields(spec).map((field) => repeaterTableName(ext, cType, field.key));
      })
    )
  )
    .map(
      (table) =>
        `\\TYPO3\\CMS\\Core\\Utility\\ExtensionManagementUtility::allowTableOnStandardPages('${table}');`
    )
    .join("\n");
  const bundleExtTablesPhp = `<?php
defined('TYPO3') || die();
${allowTables ? `\n${allowTables}\n` : ""}
`;

  const allColumns = new Map<string, string>();
  const repeaterTableSqlBlocks: string[] = [];
  bundleSpecs.forEach((spec) => {
    const sql = generateExtTablesSql(spec);
    const ttMatch = sql.match(/CREATE TABLE tt_content \(\n([\s\S]*?)\n\);/);
    if (ttMatch) {
      ttMatch[1]
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .forEach((line) => {
          const normalizedLine = line.replace(/,$/, "");
          const key = normalizedLine.replace(/\s+.*/, "");
          if (!allColumns.has(key)) {
            allColumns.set(key, `  ${normalizedLine}`);
          }
        });
    }
    const repeaterMatches = sql.match(/CREATE TABLE tx_[\s\S]*?\);\n?/g) || [];
    repeaterTableSqlBlocks.push(...repeaterMatches);
  });

  const extTablesSql = `#\n# Add custom content element columns\n#\nCREATE TABLE tt_content (\n${Array.from(allColumns.values()).join(
    ",\n"
  )}\n);\n\n${repeaterTableSqlBlocks.join("\n")}`.trim() + "\n";

  const sysTemplateOverride = `<?php
defined('TYPO3') || die();

\\TYPO3\\CMS\\Core\\Utility\\ExtensionManagementUtility::addStaticFile(
    '${ext}',
    'Configuration/TypoScript',
    'Generated Content Elements Bundle'
);
`;

  const manifest = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      tool: "ait3content-builder",
      typo3: "12 LTS",
      php: "8.2+",
      vendor,
      extensionKey: ext,
      mode: "bundle",
      elements: bundleSpecs.map((spec) => ({
        cType: toTypo3Identifier(spec.meta.cTypeKey),
        elementName: spec.meta.elementName,
        iconName: toTypo3Identifier(spec.meta.iconName || `${spec.meta.cTypeKey}_icon`)
      }))
    },
    null,
    2
  );

  const specJson = JSON.stringify(bundleSpecs, null, 2);

  const bundleReadme = `# Import Guide (${ext})

This ZIP contains a single TYPO3 extension with ${bundleSpecs.length} custom content elements.

## Composer mode (recommended)

1. Copy this folder to \`packages/${ext}\`.
2. In TYPO3 project root, register local path repository:
   \`ddev composer config repositories.${ext} path packages/${ext}\`
3. Require package:
   \`ddev composer req ${vendor}/${ext}:1.0.0\`
4. Run DB updates and flush caches.

## Included CTypes

${bundleSpecs.map((spec) => `- ${toTypo3Identifier(spec.meta.cTypeKey)} (${spec.meta.elementName})`).join("\n")}
`;

  writeZipFile(`${base}/README_IMPORT.md`, bundleReadme);
  writeZipFile(`${base}/composer.json`, generateComposerJson(first));
  writeZipFile(`${base}/ext_emconf.php`, generateExtEmconfPhp(first));
  writeZipFile(`${base}/manifest.json`, manifest);
  writeZipFile(`${base}/spec.json`, specJson);
  writeZipFile(`${base}/ext_tables.php`, bundleExtTablesPhp);
  writeZipFile(`${base}/ext_localconf.php`, generateExtLocalconfPhp(first));
  writeZipFile(`${base}/ext_tables.sql`, extTablesSql);
  writeZipFile(
    `${base}/Configuration/Icons.php`,
    `<?php\nreturn [\n${iconEntries}\n];\n`
  );
  writeZipFile(`${base}/Configuration/page.tsconfig`, `${pageTsConfigImports}\n`);
  writeZipFile(`${base}/Configuration/TCA/Overrides/sys_template.php`, sysTemplateOverride);
  writeZipFile(`${base}/Configuration/TypoScript/constants.typoscript`, generateTypoScriptConstants(first));
  writeZipFile(`${base}/Configuration/TypoScript/setup.typoscript`, `${typoScriptSetupImports}\n`);
  writeZipFile(`${base}/Resources/Private/Partials/.gitkeep`, "");
  writeZipFile(`${base}/Resources/Private/Layouts/.gitkeep`, "");

  bundleSpecs.forEach((spec) => {
    const cType = toTypo3Identifier(spec.meta.cTypeKey);
    const templateName = toTemplateName(cType);
    const iconName = toTypo3Identifier(spec.meta.iconName || "default");
    const generatedTemplate = resolveTemplateHtml(spec);

    writeZipFile(`${base}/Configuration/TCA/Overrides/tt_content_${cType}.php`, generateTcaOverridePhp(spec));
    writeZipFile(`${base}/Configuration/TsConfig/Page/ContentElement/Element/${templateName}.tsconfig`, generatePageTsConfig(spec));
    writeZipFile(`${base}/Configuration/TypoScript/ContentElement/Element/${templateName}.typoscript`, generateTypoScriptSetup(spec));
    writeZipFile(`${base}/Resources/Private/Templates/ContentElements/${templateName}.html`, generatedTemplate);
    writeZipFile(`${base}/Resources/Private/Templates/Preview/${templateName}.html`, generateBackendPreviewTemplate(spec));
    writeZipFile(`${base}/Resources/Private/Language/locallang_${cType}.xlf`, generateLocallangXlf(spec));
    writeZipFile(`${base}/Resources/Public/Icons/${iconName}.svg`, generateInitialIconSvg(spec));

    repeaterFields(spec).forEach((field) => {
      const table = repeaterTableName(ext, cType, field.key);
      writeZipFile(`${base}/Configuration/TCA/${table}.php`, generateRepeaterTableTcaPhp(spec, field));
    });
  });

  return zip.generateAsync({ type: "blob" });
};

export const downloadText = (content: string, fileName: string, mimeType = "text/plain;charset=utf-8"): void => {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
};

export const exportZip = async (spec: BuilderSpec): Promise<void> => {
  const blob = await createZipFromSpec(spec);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${spec.meta.extensionKey}.zip`;
  link.click();
  URL.revokeObjectURL(link.href);
};
