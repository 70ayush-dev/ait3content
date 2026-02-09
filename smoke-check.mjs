import { buildGeneratedFiles } from './lib/utils.ts';

const spec = {
  meta: {
    extensionKey: 'n2tsitepackage',
    elementName: 'Hero Banner',
    cTypeKey: 'hero_banner',
    iconName: 'content-hero-banner',
    group: 'custom'
  },
  fields: [
    { id: '1', key: 'headline', type: 'input', label: 'Headline', required: true, defaultValue: '', helpText: '', tab: 'content' },
    { id: '2', key: 'subline', type: 'textarea', label: 'Subline', required: false, defaultValue: '', helpText: '', tab: 'content' }
  ],
  templateHtml: '<section><h1>{data.headline}</h1><p>{data.subline}</p></section>'
};

const files = buildGeneratedFiles(spec);
const keys = Object.keys(files).sort();
console.log('HAS_TCA', keys.some((k) => k.endsWith('/Configuration/TCA/Overrides/tt_content.php')));
console.log('HAS_SQL', keys.some((k) => k.endsWith('/ext_tables.sql')));
console.log('HAS_TEMPLATE', keys.some((k) => k.endsWith('/Resources/Private/Templates/Content/hero_banner.html')));
console.log('HAS_ICON', keys.some((k) => k.endsWith('/Resources/Public/Icons/content_hero_banner.svg')));
