// Pick a small number of substantial detected regions for an uncluttered camera view.
export function selectDisplayRegions(colors, { limit = 6, minSamples = 24 } = {}) {
  if (!Array.isArray(colors)) return [];
  return colors.flatMap(group => (group.regions || []).map(region => ({
    ...region,
    name: group.name,
    key: `${group.name}:${region.id ?? `${Math.round(region.center?.x || 0)}-${Math.round(region.center?.y || 0)}`}`
  }))).filter(region => region.samples >= minSamples && region.bounds && region.center)
    .sort((a, b) => b.samples - a.samples).slice(0, limit);
}

export function getContainedVideoRect(stageWidth, stageHeight, videoWidth, videoHeight) {
  if (![stageWidth, stageHeight, videoWidth, videoHeight].every(value => value > 0)) return null;
  const scale = Math.min(stageWidth / videoWidth, stageHeight / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return { x: (stageWidth - width) / 2, y: (stageHeight - height) / 2, width, height };
}
