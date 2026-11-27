/**
 * "Do it for me" (30.8) on a control that only opens something: a press as
 * a person does it, so menus that open on pointer down (Base UI) open too,
 * and React's click handlers and a link's navigation run. Never used on a
 * control that saves (ui-map `safe`).
 */
export function pressElement(element: HTMLElement): void {
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
  const rect = element.getBoundingClientRect();
  const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const hit = document.elementFromPoint(point.x, point.y);
  const target: Element = hit && element.contains(hit) ? hit : element;
  const init = (buttons: number) => ({
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: point.x,
    clientY: point.y,
    button: 0,
    buttons,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    view: window,
  });
  const Pointer = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
  target.dispatchEvent(new Pointer("pointerdown", init(1)));
  target.dispatchEvent(new MouseEvent("mousedown", init(1)));
  element.focus({ preventScroll: true });
  target.dispatchEvent(new Pointer("pointerup", init(0)));
  target.dispatchEvent(new MouseEvent("mouseup", init(0)));
  target.dispatchEvent(new MouseEvent("click", init(0)));
}
