// Komponen Sparkline — dipindah dari App.jsx (refactor Fase 4).

export function Sparkline({ data, color="#3b82f6", h=36, w=100 }) {
  if (!data || data.length<2) return <svg width={w} height={h}><line x1="0" y1={h/2} x2={w} y2={h/2} stroke={color} strokeOpacity="0.3" strokeWidth="1.5" strokeDasharray="4"/></svg>;
  const max=Math.max(...data,1), min=Math.min(...data,0), range=max-min||1;
  const pts = data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-min)/range)*(h-4)-2}`).join(" ");
  return <svg width={w} height={h}><polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" points={pts}/></svg>;
}
