import { FilesApp, LogoPart } from './files-registry';

/** An app's logo as SVG markup (for places Angular templates cannot reach, such as an AG-Grid cell). Same drawing as the logo component. */
export function logoSvg(app: FilesApp, size: number, dark: boolean): string {
  const parts: readonly LogoPart[] = size <= 24 ? app.logoSmall : app.logo;
  const body = parts.map(p => {
    if (p.t === 'circle') return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="#fff"/>`;
    if (p.t === 'rect') return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.rx}" fill="none" stroke="#fff" stroke-opacity="${p.opacity ?? 1}" stroke-width="${p.stroke ?? 2}"/>`;
    return `<path d="${p.d}" fill="none" stroke="#fff" stroke-opacity="${p.opacity ?? 1}" stroke-width="${p.stroke ?? 2}" stroke-linecap="round"${p.join ? ' stroke-linejoin="round"' : ''}${p.dash ? ` stroke-dasharray="${p.dash}"` : ''}/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true" data-files-logo="${app.id}"><rect width="48" height="48" rx="12" fill="${dark ? app.colorDark : app.color}"/>${body}</svg>`;
}

/** The orange "Patient data" pill with its shield (Files list rows, the editor's chip uses the same wording). */
export function phiPillHtml(dark: boolean): string {
  const bg = dark ? 'rgba(251,146,60,.18)' : '#fff1e6';
  const fg = dark ? '#fdba74' : '#b45309';
  return `<span data-phi="true" title="Prefrontal put patient data in this file. It stays out of outside assistants." style="flex:none;display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:999px;font-size:12px;font-weight:600;line-height:1;white-space:nowrap;background:${bg};color:${fg}">`
    + `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 2.9 8.3 7 10 4.1-1.7 7-5.5 7-10V6l-7-3Z"/></svg>Patient data</span>`;
}
