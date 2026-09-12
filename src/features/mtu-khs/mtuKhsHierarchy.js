export function filterMtuHierarchy({ uitId = "", uptId = "", ultgId = "", giId = "", uptList = [], ultgList = [], gis = [], bays = [] }) {
  const scopedUpt = uptList.filter(item => !uitId || item.uitId === uitId);
  const uptIds = new Set(scopedUpt.map(item => item.id));
  const scopedUltg = ultgList.filter(item => uptIds.has(item.parentUptId || item.uptId));
  const visibleUltg = scopedUltg.filter(item => !uptId || (item.parentUptId || item.uptId) === uptId);
  const ultgIds = new Set(visibleUltg.filter(item => !ultgId || item.id === ultgId).map(item => item.id));
  const visibleGis = gis.filter(item => ultgIds.has(item.ultgId));
  const giIds = new Set(visibleGis.filter(item => item.id === giId).map(item => item.id));
  return { upt: scopedUpt, ultg: visibleUltg, gis: visibleGis, bays: giId ? bays.filter(item => giIds.has(item.garduIndukId)) : [] };
}
