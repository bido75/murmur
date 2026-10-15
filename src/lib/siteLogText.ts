// The site log as plain sections for sharing (verified entries only). Pure.
import type { SiteLog } from './types';

export function siteLogSections(log: SiteLog | null | undefined): { title: string; items: string[] }[] {
  if (!log) return [];
  const ok = <T extends { verified: boolean }>(xs: T[] | undefined) => (xs ?? []).filter((x) => x.verified);
  const at = (loc: string | null) => (loc ? ` (${loc})` : '');
  const sections = [
    { title: 'Weather', items: log.weather?.verified ? [log.weather.text] : [] },
    { title: 'Safety', items: ok(log.issues).filter((i) => i.category === 'safety').map((i) => `${i.text}${at(i.location)}`) },
    { title: 'Issues', items: ok(log.issues).filter((i) => i.category !== 'safety').map((i) => `${i.text}${at(i.location)}`) },
    { title: 'Work completed', items: ok(log.work_completed).map((w) => `${w.text}${at(w.location)}`) },
    { title: 'Manpower', items: ok(log.manpower).map((m) => (m.count != null ? `${m.company_or_trade}: ${m.count}` : m.company_or_trade)) },
    { title: 'Inspections', items: ok(log.inspections).map((i) => (i.result ? `${i.text}: ${i.result}` : i.text)) },
    { title: 'Deliveries', items: ok(log.deliveries).map((d) => d.text) },
    { title: 'Delays', items: ok(log.delays).map((d) => d.text) },
  ];
  return sections.filter((s) => s.items.length);
}
