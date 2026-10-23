// The tiny DOM helper the renderer uses.
//
// It is in its own file so every part of the renderer builds elements the same way.

export type Child = Node | string | null | false | undefined;

export function h(
  tag: string,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function")
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k in el && typeof v !== "string")
      (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children)
    if (c) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}
