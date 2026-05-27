/* =========================================================
   Kode — Pointer-based drag-and-drop manager
   Works for mouse + touch (tablet). Exports useDnD hook.
   ========================================================= */

const { useState, useEffect, useRef, useCallback } = React;

// ---------- global drag state (one drag at a time) ----------
const dragState = {
  active: false,
  payload: null,          // {kind:'new'|'move', block, fromPath?}
  ghostEl: null,
  pointerId: null,
  startX: 0, startY: 0,
  onDropHandlers: new Map(),  // id -> {test(x,y), callback}
  listeners: new Set(),       // notified on drag start/end + hover
  currentHover: null,
};

function notify() {
  dragState.listeners.forEach(fn => fn(dragState));
}

function findDropTargetAt(x, y) {
  // walk DOM elements at point, pick nearest with data-drop-id
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    const id = el.getAttribute && el.getAttribute('data-drop-id');
    if (id) return { id, el };
  }
  return null;
}

function startDrag(e, payload, sourceEl) {
  if (dragState.active) return;
  dragState.active = true;
  dragState.payload = payload;
  dragState.pointerId = e.pointerId;
  dragState.startX = e.clientX;
  dragState.startY = e.clientY;

  // build ghost from source clone
  const ghost = sourceEl.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width = sourceEl.offsetWidth + 'px';
  ghost.style.height = sourceEl.offsetHeight + 'px';
  ghost.style.left = e.clientX + 'px';
  ghost.style.top = e.clientY + 'px';
  document.body.appendChild(ghost);
  dragState.ghostEl = ghost;

  sourceEl.classList.add('dragging');
  dragState._sourceEl = sourceEl;

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  notify();
}

function onMove(e) {
  if (!dragState.active) return;
  if (dragState.ghostEl) {
    dragState.ghostEl.style.left = e.clientX + 'px';
    dragState.ghostEl.style.top = e.clientY + 'px';
  }
  const hit = findDropTargetAt(e.clientX, e.clientY);
  const newHover = hit ? hit.id : null;
  if (newHover !== dragState.currentHover) {
    dragState.currentHover = newHover;
    notify();
  }
}

function onUp(e) {
  if (!dragState.active) return;
  const hit = findDropTargetAt(e.clientX, e.clientY);
  const handler = hit ? dragState.onDropHandlers.get(hit.id) : null;
  if (handler) handler.cb(dragState.payload);

  // cleanup
  if (dragState.ghostEl) dragState.ghostEl.remove();
  if (dragState._sourceEl) dragState._sourceEl.classList.remove('dragging');
  dragState.active = false;
  dragState.payload = null;
  dragState.ghostEl = null;
  dragState.pointerId = null;
  dragState.currentHover = null;
  dragState._sourceEl = null;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onUp);
  notify();
}

// ---------- hooks for components ----------

// draggable source: returns onPointerDown handler
function useDraggable(payloadFactory) {
  return useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const sourceEl = e.currentTarget;
    // tiny delay so a tap that didn't drag isn't a drag
    const sx = e.clientX, sy = e.clientY;
    let started = false;
    const onMv = (ev) => {
      if (started) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (dx * dx + dy * dy > 25) {
        started = true;
        window.removeEventListener('pointermove', onMv);
        window.removeEventListener('pointerup', onUp2);
        startDrag(ev, payloadFactory(), sourceEl);
      }
    };
    const onUp2 = () => {
      window.removeEventListener('pointermove', onMv);
      window.removeEventListener('pointerup', onUp2);
    };
    window.addEventListener('pointermove', onMv);
    window.addEventListener('pointerup', onUp2);
  }, [payloadFactory]);
}

// drop target: registers id + cb, returns isHover
function useDropZone(id, onDrop) {
  const [hover, setHover] = useState(false);
  useEffect(() => {
    dragState.onDropHandlers.set(id, { cb: onDrop });
    const fn = (st) => setHover(st.active && st.currentHover === id);
    dragState.listeners.add(fn);
    return () => {
      dragState.onDropHandlers.delete(id);
      dragState.listeners.delete(fn);
    };
  }, [id, onDrop]);
  return hover;
}

function useDragActive() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const fn = (st) => setActive(st.active);
    dragState.listeners.add(fn);
    return () => dragState.listeners.delete(fn);
  }, []);
  return active;
}

window.KodeDnD = { useDraggable, useDropZone, useDragActive };
