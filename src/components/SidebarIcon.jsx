// Ikon monokrom untuk navigasi utama. Semua ikon mengikuti currentColor agar
// konsisten putih di sidebar tanpa menambah dependensi ikon baru.
export function SidebarIcon({name, size=18, strokeWidth=1.9}) {
  const common = {
    width:size,
    height:size,
    viewBox:"0 0 24 24",
    fill:"none",
    stroke:"currentColor",
    strokeWidth,
    strokeLinecap:"round",
    strokeLinejoin:"round",
    "aria-hidden":"true",
  };

  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="4" rx="1.5"/><rect x="14" y="11" width="7" height="10" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></>,
    stock: <><path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"/><path d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5"/></>,
    master: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    transaction: <><path d="M20 7h-9M16 3l4 4-4 4"/><path d="M4 17h9M8 21l-4-4 4-4"/></>,
    approval: <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
    equipment: <><path d="M3 17h13v-5l-3-4H8v9"/><path d="M16 12h3l2 3v2h-2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M8 8V5h5l2 3"/></>,
    attb: <><path d="M4 7h16v13H4z"/><path d="M3 4h18v3H3zM9 11h6"/></>,
    opname: <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 9h6M9 13h6M9 17h4"/></>,
    maturity: <><path d="M4 17a8 8 0 0 1 16 0"/><path d="M12 17l4.5-4.5"/><circle cx="12" cy="17" r="1.3"/><path d="M4.5 13.5 6 14M19.5 13.5 18 14M12 9v1.6"/></>,
    capacity: <><path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-8h10v8M7 9h.01M12 9h.01M17 9h.01"/></>,
    forecast: <><path d="M3 20h18M5 17l4-5 4 3 6-8"/><path d="M15 7h4v4"/></>,
    ai: <><rect x="5" y="6" width="14" height="13" rx="3"/><path d="M9 11h.01M15 11h.01M9 15h6M12 2v4M8 2h8M3 10v5M21 10v5"/></>,
    request: <><path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h3"/><path d="m14 16 2 2 4-4"/></>,
    inbound: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></>,
    outbound: <><path d="M12 21V9M7 14l5-5 5 5"/><path d="M5 3h14"/></>,
    report: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    catalog: <><path d="M4 5h16v14H4zM8 3v4M16 3v4M8 11h8M8 15h5"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.6 2.9 8 7 10 4.1-2 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2.5-6 6-6s6 2 6 6"/><path d="M16 5a3 3 0 0 1 0 6M17 14c2.5.5 4 2.4 4 5"/></>,
    organization: <><rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/></>,
    warehouse: <><path d="M3 9 12 4l9 5v11H3V9Z"/><path d="M7 20v-7h10v7M7 9h.01M12 9h.01M17 9h.01"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-5 3.3-8 8-8s8 3 8 8"/></>,
    migrate: <><path d="M20 7h-9M16 3l4 4-4 4M4 17h9M8 21l-4-4 4-4"/><circle cx="12" cy="12" r="9" opacity=".28"/></>,
    cloud: <><path d="M6 19h12a4 4 0 0 0 .5-8A7 7 0 0 0 5 9.5 4.5 4.5 0 0 0 6 19Z"/><path d="m9 14 2 2 4-4"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M15 8l2 2M17 6l2 2"/></>,
    logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    collapse: <><path d="M9 18 3 12l6-6M21 18l-6-6 6-6"/></>,
    expand: <><path d="m3 18 6-6-6-6M15 18l6-6-6-6"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
  };

  return <svg {...common}>{paths[name] || paths.dashboard}</svg>;
}
