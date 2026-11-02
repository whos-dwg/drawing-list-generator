export const canonicalAttributeTags = ['DWG_NUMBER', 'DRAWING_TITLE_1', 'DRAWING_TITLE_2', 'DRAWING_TITLE_3', 'DRAWING_TITLE_4'];

export function normalizeCadInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('CAD input settings must be an object.');
  const supplied = input.blockNames ?? ['A1_TITLE_EN'];
  const names = typeof supplied === 'string' ? supplied.split(/[,;，；\r\n]+/) : supplied;
  if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) throw new Error('Enter one or more block names.');
  const blockNames = [...new Set(names.map(name => name.trim()).filter(Boolean).map(name => name.toUpperCase()))];
  if (!blockNames.length || blockNames.length > 32 || blockNames.some(name => name.length > 255 || /[\x00-\x1f]/.test(name))) throw new Error('Enter 1–32 block names, separated by commas.');
  const sourceMap = input.attributeMap ?? {};
  if (!sourceMap || typeof sourceMap !== 'object' || Array.isArray(sourceMap)) throw new Error('Attribute mapping must be an object.');
  const attributeMap = {};
  for (const tag of canonicalAttributeTags) {
    const value = Object.hasOwn(sourceMap, tag) ? sourceMap[tag] : tag;
    if (typeof value !== 'string' || value.length > 255 || /[{}\x00-\x1f]/.test(value)) throw new Error(`Invalid source attribute for ${tag}.`);
    attributeMap[tag] = value.trim().toUpperCase();
  }
  if (!attributeMap.DWG_NUMBER) throw new Error('The drawing-number attribute is required.');
  return {blockNames, attributeMap};
}

export function cadInputFromPreset(preset = {}) {
  return normalizeCadInput(preset.cadInput ?? {blockNames: [preset.titleBlockName || 'A1_TITLE_EN']});
}

export function sameBlockSelection(left, right) {
  return [...normalizeCadInput(left).blockNames].sort().join('\n') === [...normalizeCadInput(right).blockNames].sort().join('\n');
}

export function mapCadAttributes(rawAttributes, config) {
  const source = new Map(Object.entries(rawAttributes ?? {}).map(([tag, value]) => [tag.toUpperCase(), value]));
  const attributes = {...rawAttributes};
  for (const tag of canonicalAttributeTags) {
    const sourceTag = config.attributeMap[tag];
    attributes[tag] = sourceTag ? String(source.get(sourceTag) ?? '') : '';
  }
  return attributes;
}
