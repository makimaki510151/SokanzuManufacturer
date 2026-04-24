/**
 * 相関図 Web エディタ — soukanzu (main.py) と同様の JSON スキーマに準拠
 * canvas_info, elements[], groups[], connections[]
 */

const DEFAULT_CANVAS = { width: 900, height: 600 };
const DEFAULT_IMAGE_SIZE = 50;
const CONNECTION_SHIFT = 8;
/** SVG 書き出し時の内容周りの余白（ユーザー座標） */
const EXPORT_PAD = 40;

/** @typedef {{ width: number, height: number }} CanvasInfo */
/** @typedef {{ title?: string, description?: string, details?: string, link_url?: string }} Profile */
/** @typedef {{ type:'image', id:string, path:string, x:number, y:number, width:number, height:number, profile?:Profile }} ElementImage */
/** @typedef {{ type:'text', id:string, content:string, x:number, y:number, font?:string, size?:number, color?:string }} ElementText */
/** @typedef {{ id:string, members:string[], bounds:number[], label:string, color:string, line_type?:string, stroke_width?:number, fill_color?:string }} Group */
/** @typedef {{ id:string, start_id:string, start_type:string, end_id:string, end_type:string, type:string, color:string, width:number, label?: string, label_size?: number, label_offset?: number }} Connection */
/** @typedef {{ canvas_info: CanvasInfo, elements: (ElementImage|ElementText)[], groups: Group[], connections: Connection[] }} DiagramData */

function uuid() {
  return crypto.randomUUID();
}

function emptyData() {
  return {
    canvas_info: { ...DEFAULT_CANVAS },
    elements: [],
    groups: [],
    connections: [],
  };
}

/** @param {DiagramData} data */
function getById(data, id, typ) {
  if (typ === "element") return data.elements.find((e) => e.id === id) ?? null;
  if (typ === "group") return data.groups.find((g) => g.id === id) ?? null;
  if (typ === "connection") return data.connections.find((c) => c.id === id) ?? null;
  return null;
}

/** @param {number[]} b */
function normalizedBounds(b) {
  const [x1, y1, x2, y2] = b;
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

/** @param {Group} g */
function normalizeGroupBounds(g) {
  g.bounds = normalizedBounds(g.bounds);
}

/**
 * @param {Group} g
 * @returns {{ stroke: string, strokeWidth: number, dasharray: string | null, fill: string }}
 */
function getGroupStyle(g) {
  const stroke = g.color || "#3b82f6";
  const strokeWidth = Math.max(1, Number(g.stroke_width) || 1);
  const lineType = g.line_type || "dash";
  const dasharray = lineType === "solid" ? null : "4 2";
  const fillRaw = String(g.fill_color || "").trim();
  const fill = fillRaw ? fillRaw : "none";
  return { stroke, strokeWidth, dasharray, fill };
}

function getElementBounds(el) {
  if (!el) return [0, 0, 0, 0];
  if (Array.isArray(el.bounds) && el.bounds.length === 4) {
    return normalizedBounds(el.bounds);
  }
  const x = el.x;
  const y = el.y;
  if (el.type === "image") {
    const w = el.width ?? DEFAULT_IMAGE_SIZE;
    const h = el.height ?? DEFAULT_IMAGE_SIZE;
    return [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
  }
  if (el.type === "text") {
    return [x - 20, y - 10, x + 20, y + 10];
  }
  return [x, y, x, y];
}

function getConnectionPoint(startBounds, endBounds) {
  const cx1 = (startBounds[0] + startBounds[2]) / 2;
  const cy1 = (startBounds[1] + startBounds[3]) / 2;
  const cx2 = (endBounds[0] + endBounds[2]) / 2;
  const cy2 = (endBounds[1] + endBounds[3]) / 2;
  const dx = cx2 - cx1;
  const dy = cy2 - cy1;
  if (dx === 0 && dy === 0) return { x: cx1, y: cy1 };
  const angle = Math.atan2(dy, dx);
  const halfW = (startBounds[2] - startBounds[0]) / 2;
  const halfH = (startBounds[3] - startBounds[1]) / 2;
  const tx = Math.cos(angle) !== 0 ? halfW / Math.abs(Math.cos(angle)) : Infinity;
  const ty = Math.sin(angle) !== 0 ? halfH / Math.abs(Math.sin(angle)) : Infinity;
  const tMin = Math.min(tx, ty);
  const connectX = cx1 + tMin * Math.cos(angle);
  const connectY = cy1 + tMin * Math.sin(angle);
  return {
    x: Math.max(startBounds[0], Math.min(startBounds[2], connectX)),
    y: Math.max(startBounds[1], Math.min(startBounds[3], connectY)),
  };
}

function shiftOffset(dx, dy, shiftIndex) {
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { ox: 0, oy: 0 };
  const nx = -dy / dist;
  const ny = dx / dist;
  const amount = CONNECTION_SHIFT * shiftIndex;
  return { ox: nx * amount, oy: ny * amount };
}

function connectionShiftIndex(connId, startId, endId, connections) {
  const key = [startId, endId].sort().join("\0");
  const list = connections.filter((c) => {
    const k = [c.start_id, c.end_id].sort().join("\0");
    return k === key;
  });
  const idx = list.findIndex((c) => c.id === connId);
  if (list.length === 1) return 0;
  if (idx === 0) return 0;
  const mag = Math.floor((idx + 1) / 2);
  return mag * (idx % 2 === 0 ? 1 : -1);
}

/**
 * @param {DiagramData} d
 * @param {Connection} c
 * @param {Connection[]} connDup
 */
function getConnectionLineCoords(d, c, connDup) {
  const start = getById(d, c.start_id, c.start_type);
  const end = getById(d, c.end_id, c.end_type);
  if (!start || !end) return null;
  const sb = getElementBounds(/** @type {*} */ (start));
  const eb = getElementBounds(/** @type {*} */ (end));
  const p1b = getConnectionPoint(sb, eb);
  const p2b = getConnectionPoint(eb, sb);
  const dx = p2b.x - p1b.x;
  const dy = p2b.y - p1b.y;
  const si = connectionShiftIndex(c.id, c.start_id, c.end_id, connDup);
  const { ox, oy } = shiftOffset(dx, dy, si);
  return { x1: p1b.x + ox, y1: p1b.y + oy, x2: p2b.x + ox, y2: p2b.y + oy };
}

function offsetLinePerpendicular(x1, y1, x2, y2, off) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  return { x1: x1 + nx * off, y1: y1 + ny * off, x2: x2 + nx * off, y2: y2 + ny * off };
}

/**
 * @param {SVGElement} parent
 * @param {Document} ownerDoc
 * @param {DiagramData} d
 * @param {Connection} c
 * @param {Connection[]} connDup
 */
function renderConnectionInto(parent, ownerDoc, d, c, connDup) {
  const NS = "http://www.w3.org/2000/svg";
  const coords = getConnectionLineCoords(d, c, connDup);
  if (!coords) return;
  const { x1, y1, x2, y2 } = coords;
  const t = c.type || "line";
  const w = c.width ?? 2;
  const stroke = c.color || "#111";
  const labelStr = String(c.label || "")
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, " ");
  const off = Number(c.label_offset);
  const useOffset = Number.isFinite(off) && Math.abs(off) > 0.001;

  const g = ownerDoc.createElementNS(NS, "g");
  g.dataset.kind = "connection";
  g.dataset.id = c.id;

  const visPath = ownerDoc.createElementNS(NS, "path");
  visPath.setAttribute("d", `M ${x1} ${y1} L ${x2} ${y2}`);
  visPath.setAttribute("fill", "none");
  visPath.setAttribute("stroke", stroke);
  visPath.setAttribute("stroke-width", String(w));
  if (t.includes("dash")) visPath.setAttribute("stroke-dasharray", "6 4");
  if (t.includes("arrow") && !t.includes("double")) {
    visPath.setAttribute("marker-end", "url(#arrow-end)");
  } else if (t.includes("double_arrow")) {
    visPath.setAttribute("marker-end", "url(#arrow-end)");
    visPath.setAttribute("marker-start", "url(#arrow-start)");
  }
  visPath.setAttribute("pointer-events", "none");

  const hitPath = ownerDoc.createElementNS(NS, "path");
  hitPath.setAttribute("d", `M ${x1} ${y1} L ${x2} ${y2}`);
  hitPath.setAttribute("fill", "none");
  hitPath.setAttribute("stroke", "rgba(0,0,0,0.02)");
  hitPath.setAttribute("stroke-width", "18");
  hitPath.setAttribute("pointer-events", "stroke");
  hitPath.style.cursor = currentTool === "delete" ? "not-allowed" : "default";

  g.append(visPath);
  if (currentTool === "delete" && deleteHover?.kind === "connection" && deleteHover.id === c.id) {
    const hi = ownerDoc.createElementNS(NS, "path");
    hi.setAttribute("d", `M ${x1} ${y1} L ${x2} ${y2}`);
    hi.setAttribute("fill", "none");
    hi.setAttribute("stroke", "#f97316");
    hi.setAttribute("stroke-width", String(Math.max(10, w + 6)));
    hi.setAttribute("stroke-linecap", "round");
    hi.setAttribute("pointer-events", "none");
    hi.setAttribute("opacity", "0.55");
    g.insertBefore(hi, visPath);
  }

  if (labelStr) {
    const o = useOffset ? offsetLinePerpendicular(x1, y1, x2, y2, off) : { x1, y1, x2, y2 };
    const dx = o.x2 - o.x1;
    const dy = o.y2 - o.y1;
    const len = Math.hypot(dx, dy) || 1;
    let ux = dx / len;
    let uy = dy / len;
    // 文字の並び方向は「左→右」優先（ほぼ垂直なら「上→下」）にそろえる
    if (ux < -0.01 || (Math.abs(ux) <= 0.01 && uy < 0)) {
      ux = -ux;
      uy = -uy;
    }
    const fs = c.label_size ?? 12;
    const chars = [...labelStr];
    // 1文字間隔が詰まりすぎないよう、文字サイズに対して十分なピッチを確保
    const pitch = Math.max(8, fs * 1.1);
    const total = pitch * Math.max(0, chars.length - 1);
    const cx = (o.x1 + o.x2) / 2;
    const cy = (o.y1 + o.y2) / 2;
    const sx = cx - ux * (total / 2);
    const sy = cy - uy * (total / 2);

    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i];
      const px = sx + ux * (pitch * i);
      const py = sy + uy * (pitch * i);
      const chEl = ownerDoc.createElementNS(NS, "text");
      chEl.setAttribute("x", String(px));
      chEl.setAttribute("y", String(py));
      chEl.setAttribute("text-anchor", "middle");
      chEl.setAttribute("dominant-baseline", "middle");
      chEl.setAttribute("font-size", String(fs));
      chEl.setAttribute("font-family", "Segoe UI, Meiryo, sans-serif");
      chEl.setAttribute("fill", stroke);
      chEl.setAttribute("pointer-events", "none");
      chEl.textContent = ch;
      g.append(chEl);
    }
  }

  g.append(hitPath);
  parent.append(g);
}

/** @type {DiagramData} */
let data = emptyData();
let currentTool = "select";
/**
 * 削除ツール時、ポインタ下の削除対象（余白なら null）。
 * @type {{ kind: string, id: string, handle?: string } | null}
 */
let deleteHover = null;
/** @type {{ start_id: string, start_type: string } | null} */
let connectPending = null;
/** @type {string | null} */
let draggingId = null;
/** @type {'element'|'group'|null} */
let draggingType = null;
let dragOffset = { x: 0, y: 0 };
/** @type {ElementImage|ElementText|Group|null} */
let pendingConnStyle = null;
/** 既存グループ編集モードのときの group id（新規時は null） */
let editingGroupId = null;

/** 接続編集ダイアログが「既存の線」の編集モードのときの接続 ID */
let editingConnectionId = null;

/** 盤面の表示（viewBox）。データ座標系と同一。 */
let viewState = { vx: 0, vy: 0, vw: DEFAULT_CANVAS.width, vh: DEFAULT_CANVAS.height };

function resetView() {
  const w = data.canvas_info.width;
  const h = data.canvas_info.height;
  viewState = { vx: 0, vy: 0, vw: w, vh: h };
}

const svg = /** @type {SVGSVGElement} */ (document.getElementById("diagram"));
const canvasWrap = document.getElementById("canvas-wrap");
const rubber = document.getElementById("group-rubber");
const statusEl = document.getElementById("status");

const layers = {
  defs: null,
  groups: null,
  connections: null,
  elements: null,
};

function setStatus(msg) {
  statusEl.textContent = msg;
}

function ensureLayers() {
  if (layers.defs) return;
  const NS = "http://www.w3.org/2000/svg";
  svg.innerHTML = "";
  layers.defs = document.createElementNS(NS, "defs");
  layers.groups = document.createElementNS(NS, "g");
  layers.groups.setAttribute("class", "layer-groups");
  layers.connections = document.createElementNS(NS, "g");
  layers.connections.setAttribute("class", "layer-connections");
  layers.elements = document.createElementNS(NS, "g");
  layers.elements.setAttribute("class", "layer-elements");
  svg.append(layers.defs, layers.groups, layers.connections, layers.elements);
  injectArrowMarkers();
}

function injectArrowMarkers() {
  const NS = "http://www.w3.org/2000/svg";
  const markerEnd = document.createElementNS(NS, "marker");
  markerEnd.setAttribute("id", "arrow-end");
  markerEnd.setAttribute("markerWidth", "10");
  markerEnd.setAttribute("markerHeight", "10");
  markerEnd.setAttribute("refX", "9");
  markerEnd.setAttribute("refY", "3");
  markerEnd.setAttribute("orient", "auto");
  const pathEnd = document.createElementNS(NS, "path");
  pathEnd.setAttribute("d", "M0,0 L0,6 L9,3 z");
  pathEnd.setAttribute("fill", "context-stroke");
  markerEnd.append(pathEnd);

  const markerStart = document.createElementNS(NS, "marker");
  markerStart.setAttribute("id", "arrow-start");
  markerStart.setAttribute("markerWidth", "10");
  markerStart.setAttribute("markerHeight", "10");
  markerStart.setAttribute("refX", "1");
  markerStart.setAttribute("refY", "3");
  markerStart.setAttribute("orient", "auto");
  const pathStart = document.createElementNS(NS, "path");
  pathStart.setAttribute("d", "M9,0 L9,6 L0,3 z");
  pathStart.setAttribute("fill", "context-stroke");
  markerStart.append(pathStart);

  layers.defs.append(markerEnd, markerStart);
}

function applySvgSize() {
  const { width, height } = data.canvas_info;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("viewBox", `${viewState.vx} ${viewState.vy} ${viewState.vw} ${viewState.vh}`);
}

function redraw() {
  ensureLayers();
  applySvgSize();
  layers.groups.replaceChildren();
  layers.connections.replaceChildren();
  layers.elements.replaceChildren();
  const NS = "http://www.w3.org/2000/svg";

  for (const g of data.groups) {
    const [x1, y1, x2, y2] = normalizedBounds(g.bounds);
    const gs = getGroupStyle(g);
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", String(x1));
    rect.setAttribute("y", String(y1));
    rect.setAttribute("width", String(x2 - x1));
    rect.setAttribute("height", String(y2 - y1));
    rect.setAttribute("fill", gs.fill);
    rect.setAttribute("stroke", gs.stroke);
    rect.setAttribute("stroke-width", String(gs.strokeWidth));
    if (gs.dasharray) rect.setAttribute("stroke-dasharray", gs.dasharray);
    else rect.removeAttribute("stroke-dasharray");
    rect.dataset.kind = "group";
    rect.dataset.id = g.id;
    rect.style.cursor = currentTool === "delete" ? "not-allowed" : "move";
    const groupDelHl =
      currentTool === "delete" &&
      deleteHover &&
      (deleteHover.kind === "group" || deleteHover.kind === "group-handle") &&
      deleteHover.id === g.id;
    if (groupDelHl) {
      rect.setAttribute("stroke", "#f97316");
      rect.setAttribute("stroke-width", "3");
      rect.removeAttribute("stroke-dasharray");
    }
    const hitRect = document.createElementNS(NS, "rect");
    hitRect.setAttribute("x", String(x1));
    hitRect.setAttribute("y", String(y1));
    hitRect.setAttribute("width", String(x2 - x1));
    hitRect.setAttribute("height", String(y2 - y1));
    hitRect.setAttribute("fill", "none");
    hitRect.setAttribute("stroke", "rgba(0,0,0,0.02)");
    hitRect.setAttribute("stroke-width", String(Math.max(12, gs.strokeWidth + 10)));
    hitRect.setAttribute("pointer-events", "stroke");
    hitRect.dataset.kind = "group";
    hitRect.dataset.id = g.id;
    hitRect.style.cursor = currentTool === "delete" ? "not-allowed" : "move";
    const label = document.createElementNS(NS, "text");
    label.setAttribute("x", String(x1));
    label.setAttribute("y", String(y1 - 6));
    label.setAttribute("fill", gs.stroke);
    label.setAttribute("font-size", "12");
    label.textContent = g.label || "Group";
    label.dataset.kind = "group-label";
    label.dataset.id = g.id;
    label.style.pointerEvents = "none";
    layers.groups.append(rect, hitRect, label);
    if (currentTool === "select") {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const h2 = GROUP_HANDLE / 2;
      /** @type {[string, number, number, string][]} */
      const specs = [
        ["nw", x1, y1, "nwse-resize"],
        ["n", cx, y1, "ns-resize"],
        ["ne", x2, y1, "nesw-resize"],
        ["e", x2, cy, "ew-resize"],
        ["se", x2, y2, "nwse-resize"],
        ["s", cx, y2, "ns-resize"],
        ["sw", x1, y2, "nesw-resize"],
        ["w", x1, cy, "ew-resize"],
      ];
      for (const [handle, px, py, cur] of specs) {
        const hr = document.createElementNS(NS, "rect");
        hr.setAttribute("x", String(px - h2));
        hr.setAttribute("y", String(py - h2));
        hr.setAttribute("width", String(GROUP_HANDLE));
        hr.setAttribute("height", String(GROUP_HANDLE));
        hr.setAttribute("fill", "#ffffff");
        hr.setAttribute("stroke", "#1d4ed8");
        hr.setAttribute("stroke-width", "1");
        hr.dataset.kind = "group-handle";
        hr.dataset.id = g.id;
        hr.dataset.handle = handle;
        hr.style.cursor = cur;
        layers.groups.append(hr);
      }
    }
  }

  const connDup = data.connections;
  for (const c of data.connections) {
    renderConnectionInto(layers.connections, document, data, c, connDup);
  }

  for (const el of data.elements) {
    if (el.type === "image") {
      const g = document.createElementNS(NS, "g");
      g.setAttribute("transform", `translate(${el.x},${el.y})`);
      g.dataset.kind = "element";
      g.dataset.id = el.id;
      g.dataset.sub = "image";
      const img = document.createElementNS(NS, "image");
      img.setAttribute("href", el.path);
      img.setAttribute("x", String(-el.width / 2));
      img.setAttribute("y", String(-el.height / 2));
      img.setAttribute("width", String(el.width));
      img.setAttribute("height", String(el.height));
      img.style.cursor = currentTool === "delete" ? "not-allowed" : "move";
      g.append(img);
      const titleText = String(el.profile?.title || "（無題）").trim() || "（無題）";
      const caption = document.createElementNS(NS, "text");
      caption.setAttribute("x", "0");
      caption.setAttribute("y", String(el.height / 2 + 14));
      caption.setAttribute("text-anchor", "middle");
      caption.setAttribute("dominant-baseline", "hanging");
      caption.setAttribute("font-size", "12");
      caption.setAttribute("font-family", "Segoe UI, Meiryo, sans-serif");
      caption.setAttribute("fill", "#3a4350");
      caption.setAttribute("pointer-events", "none");
      caption.textContent = titleText;
      g.append(caption);
      if (currentTool === "delete" && deleteHover?.kind === "element" && deleteHover.id === el.id) {
        const ring = document.createElementNS(NS, "rect");
        ring.setAttribute("x", String(-el.width / 2 - 3));
        ring.setAttribute("y", String(-el.height / 2 - 3));
        ring.setAttribute("width", String(el.width + 6));
        ring.setAttribute("height", String(el.height + 6));
        ring.setAttribute("fill", "none");
        ring.setAttribute("stroke", "#f97316");
        ring.setAttribute("stroke-width", "3");
        ring.setAttribute("pointer-events", "none");
        g.append(ring);
      }
      layers.elements.append(g);
    } else if (el.type === "text") {
      const te = document.createElementNS(NS, "text");
      te.setAttribute("x", String(el.x));
      te.setAttribute("y", String(el.y));
      te.setAttribute("text-anchor", "middle");
      te.setAttribute("dominant-baseline", "middle");
      te.setAttribute("fill", el.color || "#111");
      te.setAttribute("font-size", String(el.size ?? 14));
      te.setAttribute("font-family", el.font || "Segoe UI, Meiryo, sans-serif");
      te.textContent = String(el.content).replace(/\r\n/g, "\n").replace(/\n/g, " ");
      te.dataset.kind = "element";
      te.dataset.id = el.id;
      te.dataset.sub = "text";
      te.style.cursor = currentTool === "delete" ? "not-allowed" : "move";
      if (currentTool === "delete" && deleteHover?.kind === "element" && deleteHover.id === el.id) {
        te.setAttribute("stroke", "#f97316");
        te.setAttribute("stroke-width", "4");
        te.setAttribute("paint-order", "stroke fill");
      }
      layers.elements.append(te);
    }
  }

  updateToolClass();
}

function updateToolClass() {
  svg.classList.remove("tool-select", "tool-connect", "tool-group", "tool-delete");
  svg.classList.add(`tool-${currentTool}`);
  document.getElementById("edit-tools")?.classList.toggle("tool-delete-active", currentTool === "delete");
}

function clientToSvg(ev) {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX;
  pt.y = ev.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

function hitTarget(ev) {
  const { x, y } = clientToSvg(ev);
  // elementsFromPoint は Document の API（SVGSVGElement にはない環境がある）
  const doc = svg.ownerDocument ?? document;
  const list =
    typeof doc.elementsFromPoint === "function"
      ? doc.elementsFromPoint(ev.clientX, ev.clientY)
      : [];
  for (const node of list) {
    if (!(node instanceof SVGElement)) continue;
    if (node === svg) continue;
    const hitEl = node.closest("[data-kind]");
    if (!hitEl || !svg.contains(hitEl)) continue;
    const kind = hitEl.dataset.kind;
    const id = hitEl.dataset.id;
    if (kind === "connection" && id) return { kind: "connection", id, x, y };
    if (kind === "group-handle" && id && hitEl.dataset.handle) {
      return { kind: "group-handle", id, handle: hitEl.dataset.handle, x, y };
    }
    if (kind === "element" && id) {
      const sub = hitEl.dataset.sub || (hitEl.tagName === "text" ? "text" : "image");
      return { kind: "element", id, sub, x, y };
    }
    if (kind === "group" && id) return { kind: "group", id, x, y };
  }
  return { kind: "canvas", id: null, x, y };
}

function deleteByHit(hit) {
  if (hit.kind === "element") {
    data.elements = data.elements.filter((e) => e.id !== hit.id);
    data.connections = data.connections.filter(
      (c) => c.start_id !== hit.id && c.end_id !== hit.id
    );
    setStatus("要素を削除しました。");
  } else if (hit.kind === "group" || hit.kind === "group-handle") {
    const gid = hit.id;
    data.groups = data.groups.filter((g) => g.id !== gid);
    setStatus("グループを削除しました。");
  } else if (hit.kind === "connection") {
    data.connections = data.connections.filter((c) => c.id !== hit.id);
    setStatus("接続線を削除しました。");
  }
  redraw();
}

function startDrag(hit) {
  if (hit.kind === "element") {
    const el = getById(data, hit.id, "element");
    if (!el) return;
    draggingId = hit.id;
    draggingType = "element";
    dragOffset = { x: hit.x - el.x, y: hit.y - el.y };
  } else if (hit.kind === "group") {
    const g = getById(data, hit.id, "group");
    if (!g) return;
    normalizeGroupBounds(g);
    draggingId = hit.id;
    draggingType = "group";
    const [x1, y1, x2, y2] = g.bounds;
    dragOffset = { x: hit.x - x1, y: hit.y - y1 };
    dragOffset._w = x2 - x1;
    dragOffset._h = y2 - y1;
  }
}

function moveDrag(hit) {
  if (!draggingId || !draggingType) return;
  if (draggingType === "element") {
    const el = getById(data, draggingId, "element");
    if (!el) return;
    el.x = hit.x - dragOffset.x;
    el.y = hit.y - dragOffset.y;
  } else if (draggingType === "group") {
    const g = getById(data, draggingId, "group");
    if (!g) return;
    const w = dragOffset._w;
    const h = dragOffset._h;
    const nx1 = hit.x - dragOffset.x;
    const ny1 = hit.y - dragOffset.y;
    g.bounds = normalizedBounds([nx1, ny1, nx1 + w, ny1 + h]);
  }
  redraw();
}

function endDrag() {
  draggingId = null;
  draggingType = null;
}

/** グループ選択ドラッグ */
let groupDragging = false;
let groupStart = { x: 0, y: 0 };

/** グループ枠のリサイズ中（選択ツール） */
let groupResize = null;

/** 盤面の空き領域をドラッグしてパン（選択ツール） */
let boardPanning = false;
/** @type {{ clientX: number, clientY: number } | null} */
let lastPanClient = null;

const GROUP_MIN_SIZE = 24;
const GROUP_HANDLE = 9;

/**
 * @param {Group} g
 */
function refreshGroupMembers(g) {
  const [x1, y1, x2, y2] = normalizedBounds(g.bounds);
  const ids = data.elements
    .filter((el) => el.x >= x1 && el.x <= x2 && el.y >= y1 && el.y <= y2)
    .map((el) => el.id);
  if (ids.length) g.members = ids;
}

/**
 * @param {{ x: number, y: number }} hit
 */
function applyGroupResize(hit) {
  if (!groupResize) return;
  const g = getById(data, groupResize.id, "group");
  if (!g) return;
  const { handle, l0, t0, r0, b0, x0, y0 } = groupResize;
  const dx = hit.x - x0;
  const dy = hit.y - y0;
  let l = l0;
  let t = t0;
  let r = r0;
  let b = b0;
  switch (handle) {
    case "nw":
      l = l0 + dx;
      t = t0 + dy;
      break;
    case "n":
      t = t0 + dy;
      break;
    case "ne":
      r = r0 + dx;
      t = t0 + dy;
      break;
    case "e":
      r = r0 + dx;
      break;
    case "se":
      r = r0 + dx;
      b = b0 + dy;
      break;
    case "s":
      b = b0 + dy;
      break;
    case "sw":
      l = l0 + dx;
      b = b0 + dy;
      break;
    case "w":
      l = l0 + dx;
      break;
    default:
      return;
  }
  let ll = Math.min(l, r);
  let rr = Math.max(l, r);
  let tt = Math.min(t, b);
  let bb = Math.max(t, b);
  if (rr - ll < GROUP_MIN_SIZE) rr = ll + GROUP_MIN_SIZE;
  if (bb - tt < GROUP_MIN_SIZE) bb = tt + GROUP_MIN_SIZE;
  g.bounds = [ll, tt, rr, bb];
}

function showRubber(x1, y1, x2, y2) {
  const wrap = canvasWrap.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  const vx = viewState.vx;
  const vy = viewState.vy;
  const vw = viewState.vw;
  const vh = viewState.vh;
  const left = svgRect.left - wrap.left + ((Math.min(x1, x2) - vx) / vw) * svgRect.width;
  const top = svgRect.top - wrap.top + ((Math.min(y1, y2) - vy) / vh) * svgRect.height;
  const w = (Math.abs(x2 - x1) / vw) * svgRect.width;
  const h = (Math.abs(y2 - y1) / vh) * svgRect.height;
  rubber.classList.remove("hidden");
  rubber.style.left = `${left}px`;
  rubber.style.top = `${top}px`;
  rubber.style.width = `${w}px`;
  rubber.style.height = `${h}px`;
}

function hideRubber() {
  rubber.classList.add("hidden");
}

function openDialog(dlg) {
  if (!dlg.open) dlg.showModal();
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** ファイル名から最後の拡張子を除く（先頭のみ「.」の名前はそのまま） */
function basenameWithoutExtension(filename) {
  const n = String(filename);
  const i = n.lastIndexOf(".");
  if (i <= 0 || i === n.length - 1) return n;
  return n.slice(0, i);
}

function normalizeHexColor(value) {
  const s = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return "";
}

function syncColorPicker(textId, pickerId, fallback, allowEmpty = false) {
  const txt = /** @type {HTMLInputElement|null} */ (document.getElementById(textId));
  const pick = /** @type {HTMLInputElement|null} */ (document.getElementById(pickerId));
  if (!txt || !pick) return;
  const c = normalizeHexColor(txt.value);
  if (c) {
    pick.value = c;
  } else if (!allowEmpty) {
    txt.value = fallback;
    pick.value = fallback;
  } else {
    pick.value = fallback;
  }
}

function wireColorPicker(textId, pickerId, fallback, allowEmpty = false) {
  const txt = /** @type {HTMLInputElement|null} */ (document.getElementById(textId));
  const pick = /** @type {HTMLInputElement|null} */ (document.getElementById(pickerId));
  if (!txt || !pick) return;
  pick.addEventListener("input", () => {
    txt.value = pick.value;
  });
  txt.addEventListener("input", () => syncColorPicker(textId, pickerId, fallback, allowEmpty));
  syncColorPicker(textId, pickerId, fallback, allowEmpty);
}

function downloadBlob(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * SVG の <a href> 用。http / https のみ許可。
 * @param {string} raw
 */
function sanitizeHttpUrlForSvg(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.href;
  } catch {
    return "";
  }
}

/**
 * プロフィールから SVG 用リンク URL を得る（link_url 優先。無ければ詳細が URL のみのとき）。
 * @param {*} [prof]
 */
function profileLinkUrlForExport(prof) {
  if (!prof) return "";
  const explicit = sanitizeHttpUrlForSvg(prof.link_url || "");
  if (explicit) return explicit;
  const d = String(prof.details || "").trim();
  if (!d || d.includes("\n") || d.includes("\r")) return "";
  if (/^https?:\/\/\S+$/i.test(d)) return sanitizeHttpUrlForSvg(d);
  return "";
}

function wrapTooltipLines(text, maxLen, maxLines) {
  const lines = [];
  const raw = text.replace(/\r\n/g, "\n").split("\n");
  for (const para of raw) {
    let rest = para;
    while (rest.length && lines.length < maxLines) {
      if (rest.length <= maxLen) {
        lines.push(rest);
        break;
      }
      lines.push(rest.slice(0, maxLen));
      rest = rest.slice(maxLen);
    }
    if (lines.length >= maxLines) break;
  }
  if (raw.join("\n").length && lines.length === 0) lines.push("");
  return lines.slice(0, maxLines);
}

function estimateTooltipCharWidth(ch) {
  if (!ch) return 0;
  // 日本語・全角はやや広く、ASCII はやや狭く見積もる
  return /[ -~]/.test(ch) ? 0.56 : 1;
}

function trimLineToVisualWidth(text, maxVisualWidth, withEllipsis = false) {
  const src = String(text || "");
  const ell = withEllipsis ? "…" : "";
  const limit = Math.max(0, maxVisualWidth - (withEllipsis ? 1 : 0));
  let acc = 0;
  let out = "";
  for (const ch of src) {
    const w = estimateTooltipCharWidth(ch);
    if (acc + w > limit) break;
    out += ch;
    acc += w;
  }
  return `${out}${ell}`;
}

function wrapTooltipLinesByWidth(text, maxVisualWidth, maxLines = Infinity) {
  const src = String(text || "-").replace(/\r\n/g, "\n");
  const paras = src.split("\n");
  /** @type {string[]} */
  const lines = [];
  for (let p = 0; p < paras.length && lines.length < maxLines; p += 1) {
    const para = paras[p];
    if (!para.length) {
      lines.push("");
      continue;
    }
    let i = 0;
    while (i < para.length && lines.length < maxLines) {
      let acc = 0;
      let j = i;
      while (j < para.length) {
        const w = estimateTooltipCharWidth(para[j]);
        if (acc + w > maxVisualWidth) break;
        acc += w;
        j += 1;
      }
      if (j <= i) j = i + 1;
      const chunk = para.slice(i, j);
      lines.push(chunk);
      i = j;
    }
  }
  if (!lines.length) lines.push("-");
  return lines.slice(0, maxLines);
}

function maxLinesForHeight(heightPx, fontSizePx, lineHeightFactor = 1.25) {
  const linePx = Math.max(1, fontSizePx * lineHeightFactor);
  return Math.max(1, Math.floor(heightPx / linePx));
}

function panelHeightFromLineCounts(titleLines, descLines, detailsLines, hasLink) {
  const titleRows = Math.max(1, titleLines);
  const descRows = Math.max(1, descLines);
  const detailRows = Math.max(1, detailsLines);
  const linkSpace = hasLink ? 22 : 0;
  const h =
    14 + // top pad
    44 + // icon
    18 + // gap below icon block
    14 + // "説明" label
    descRows * 14 +
    14 + // gap + "詳細" label
    detailRows * 14 +
    linkSpace +
    16; // bottom pad
  // 最低限の見た目を担保
  return Math.max(228, h);
}

function truncateForPanel(text, maxChars) {
  const s = String(text || "");
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(1, maxChars - 1))}…`;
}

/**
 * 図面上の実体のバウンディング（余白なし）。空なら null。
 * @param {DiagramData} d
 */
function computeContentBounds(d) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const bumpRect = (x1, y1, x2, y2) => {
    const a = Math.min(x1, x2);
    const b = Math.min(y1, y2);
    const c = Math.max(x1, x2);
    const e = Math.max(y1, y2);
    minX = Math.min(minX, a);
    minY = Math.min(minY, b);
    maxX = Math.max(maxX, c);
    maxY = Math.max(maxY, e);
  };
  let any = false;
  for (const el of d.elements) {
    const b = getElementBounds(/** @type {*} */ (el));
    bumpRect(b[0], b[1], b[2], b[3]);
    if (el.type === "image") {
      const prof = el.profile || {};
      const hasTip = Boolean(prof.title || prof.description || prof.details);
      if (hasTip) {
        const head = 140;
        bumpRect(b[0], b[1] - head, b[2], b[1]);
      }
    }
    any = true;
  }
  for (const g of d.groups) {
    const [x1, y1, x2, y2] = g.bounds;
    bumpRect(x1, y1, x2, y2);
    bumpRect(Math.min(x1, x2), Math.min(y1, y2) - 14, Math.max(x1, x2), Math.min(y1, y2));
    any = true;
  }
  for (const c of d.connections) {
    const coords = getConnectionLineCoords(d, c, d.connections);
    if (!coords) continue;
    bumpRect(coords.x1, coords.y1, coords.x2, coords.y2);
    const lab = String(c.label || "").trim();
    if (lab) {
      const mx = (coords.x1 + coords.x2) / 2;
      const my = (coords.y1 + coords.y2) / 2;
      const fs = c.label_size ?? 12;
      const pad = Math.max(28, lab.length * fs * 0.35);
      bumpRect(mx - pad, my - fs * 0.85, mx + pad, my + fs * 0.85);
    }
    any = true;
  }
  if (!any) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * @param {DiagramData} d
 * @param {{ trimToContent?: boolean }} [opts] trimToContent が false のときキャンバス全体（既定は true＝SVG/PNG 共通の内容＋余白）
 * @returns {{ svg: string, width: number, height: number }}
 */
function buildSvgString(d, opts = {}) {
  const trimToContent = opts.trimToContent !== false;
  const cw = d.canvas_info.width;
  const ch = d.canvas_info.height;
  let vbX;
  let vbY;
  let vbW;
  let vbH;
  if (trimToContent) {
    const bb = computeContentBounds(d);
    if (bb) {
      vbX = bb.minX - EXPORT_PAD;
      vbY = bb.minY - EXPORT_PAD;
      vbW = bb.maxX - bb.minX + EXPORT_PAD * 2;
      vbH = bb.maxY - bb.minY + EXPORT_PAD * 2;
      vbW = Math.max(vbW, 48);
      vbH = Math.max(vbH, 48);
    } else {
      vbX = 0;
      vbY = 0;
      vbW = cw;
      vbH = ch;
    }
  } else {
    vbX = 0;
    vbY = 0;
    vbW = cw;
    vbH = ch;
  }
  const PANEL_W = 272;
  const PANEL_H_BASE = 228;
  const PANEL_MARGIN = 16;
  const PANEL_SHADOW = 6;
  const PANEL_TITLE_WIDTH = 18;
  const PANEL_BODY_WIDTH = 22;
  const TITLE_FS = 13;
  const BODY_FS = 11;
  let panelMaxH = PANEL_H_BASE;
  for (const el of d.elements) {
    if (el.type !== "image") continue;
    const prof = el.profile || {};
    const tLines = wrapTooltipLinesByWidth(prof.title || "（無題）", PANEL_TITLE_WIDTH).length;
    const dLines = wrapTooltipLinesByWidth(prof.description || "-", PANEL_BODY_WIDTH).length;
    const detLines = wrapTooltipLinesByWidth(prof.details || "-", PANEL_BODY_WIDTH).length;
    const hasLink = Boolean(profileLinkUrlForExport(prof));
    panelMaxH = Math.max(panelMaxH, panelHeightFromLineCounts(tLines, dLines, detLines, hasLink));
  }
  const MIN_EXPORT_W = PANEL_W + PANEL_MARGIN * 2 + PANEL_SHADOW;
  const MIN_EXPORT_H = panelMaxH + PANEL_MARGIN * 2 + PANEL_SHADOW;
  vbW = Math.max(vbW, MIN_EXPORT_W);
  vbH = Math.max(vbH, MIN_EXPORT_H);

  const panelX = vbX + vbW - PANEL_MARGIN - PANEL_W;
  const panelY = vbY + PANEL_MARGIN;
  const panelTextX = panelX + 16;
  const NS = "http://www.w3.org/2000/svg";
  const doc = document.implementation.createDocument(NS, "svg", null);
  const root = doc.documentElement;
  root.setAttribute("xmlns", NS);
  root.setAttribute("width", String(vbW));
  root.setAttribute("height", String(vbH));
  root.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);

  const style = doc.createElementNS(NS, "style");
  style.textContent = `
    .sk-bg { fill: #ffffff; }
    .sk-person { cursor: default; }
    .sk-person-open { cursor: pointer; }
    .sk-person .sk-hit { fill: transparent; stroke: none; }
    .sk-person .sk-hit { cursor: pointer; }
    .sk-panel { display: none; }
    .sk-panel:target { display: inline; }
    .sk-panel-shadow { fill: rgba(15, 23, 42, 0.18); }
    .sk-panel-bg { fill: rgba(15, 20, 25, 0.96); stroke: #2d3a4d; stroke-width: 1; }
    .sk-panel-title { fill: #f0f4f8; font-weight: 700; font-size: 13px; font-family: Segoe UI, Meiryo, sans-serif; }
    .sk-panel-label { fill: #93a8c5; font-size: 10px; font-family: Segoe UI, Meiryo, sans-serif; }
    .sk-panel-body { fill: #d2ddec; font-size: 11px; font-family: Segoe UI, Meiryo, sans-serif; }
    .sk-panel-close { fill: #fca5a5; font-size: 13px; font-family: Segoe UI, Meiryo, sans-serif; cursor: pointer; }
    .sk-panel-link { fill: #93c5fd; font-size: 10px; font-family: Segoe UI, Meiryo, sans-serif; text-decoration: underline; }
  `;
  const defs = doc.createElementNS(NS, "defs");
  const markerEnd = doc.createElementNS(NS, "marker");
  markerEnd.setAttribute("id", "arrow-end");
  markerEnd.setAttribute("markerWidth", "10");
  markerEnd.setAttribute("markerHeight", "10");
  markerEnd.setAttribute("refX", "9");
  markerEnd.setAttribute("refY", "3");
  markerEnd.setAttribute("orient", "auto");
  const pe = doc.createElementNS(NS, "path");
  pe.setAttribute("d", "M0,0 L0,6 L9,3 z");
  pe.setAttribute("fill", "#222222");
  markerEnd.append(pe);
  const markerStart = doc.createElementNS(NS, "marker");
  markerStart.setAttribute("id", "arrow-start");
  markerStart.setAttribute("markerWidth", "10");
  markerStart.setAttribute("markerHeight", "10");
  markerStart.setAttribute("refX", "1");
  markerStart.setAttribute("refY", "3");
  markerStart.setAttribute("orient", "auto");
  const ps = doc.createElementNS(NS, "path");
  ps.setAttribute("d", "M9,0 L9,6 L0,3 z");
  ps.setAttribute("fill", "#222222");
  markerStart.append(ps);
  defs.append(markerEnd, markerStart);

  const bg = doc.createElementNS(NS, "rect");
  bg.setAttribute("class", "sk-bg");
  bg.setAttribute("x", String(vbX));
  bg.setAttribute("y", String(vbY));
  bg.setAttribute("width", String(vbW));
  bg.setAttribute("height", String(vbH));

  const lg = doc.createElementNS(NS, "g");
  lg.setAttribute("class", "layer-groups");
  for (const g of d.groups) {
    const gs = getGroupStyle(g);
    const [x1, y1, x2, y2] = g.bounds;
    const rect = doc.createElementNS(NS, "rect");
    rect.setAttribute("x", String(Math.min(x1, x2)));
    rect.setAttribute("y", String(Math.min(y1, y2)));
    rect.setAttribute("width", String(Math.abs(x2 - x1)));
    rect.setAttribute("height", String(Math.abs(y2 - y1)));
    rect.setAttribute("fill", escapeXml(gs.fill));
    rect.setAttribute("stroke", escapeXml(gs.stroke));
    rect.setAttribute("stroke-width", String(gs.strokeWidth));
    if (gs.dasharray) rect.setAttribute("stroke-dasharray", gs.dasharray);
    const label = doc.createElementNS(NS, "text");
    label.setAttribute("x", String(Math.min(x1, x2)));
    label.setAttribute("y", String(Math.min(y1, y2) - 6));
    label.setAttribute("fill", escapeXml(gs.stroke));
    label.setAttribute("font-size", "12");
    label.textContent = g.label || "Group";
    lg.append(rect, label);
  }

  const lc = doc.createElementNS(NS, "g");
  lc.setAttribute("class", "layer-connections");
  for (const c of d.connections) {
    renderConnectionInto(lc, doc, d, c, d.connections);
  }

  const le = doc.createElementNS(NS, "g");
  le.setAttribute("class", "layer-elements");
  const lp = doc.createElementNS(NS, "g");
  lp.setAttribute("class", "layer-panels");
  for (const el of d.elements) {
    if (el.type === "text") {
      const te = doc.createElementNS(NS, "text");
      te.setAttribute("x", String(el.x));
      te.setAttribute("y", String(el.y));
      te.setAttribute("text-anchor", "middle");
      te.setAttribute("dominant-baseline", "middle");
      te.setAttribute("fill", escapeXml(el.color || "#111111"));
      te.setAttribute("font-size", String(el.size ?? 14));
      te.setAttribute("font-family", "Segoe UI, Meiryo, sans-serif");
      te.textContent = String(el.content).replace(/\r\n/g, "\n").replace(/\n/g, " ");
      le.append(te);
    } else if (el.type === "image") {
      const prof = el.profile || {};
      const title = prof.title || "（無題）";
      const desc = prof.description || "";
      const details = prof.details || "";
      const panelId = `sk-panel-${el.id}`;
      const linkHref = profileLinkUrlForExport(prof);
      const titleLines = wrapTooltipLinesByWidth(title || "（無題）", PANEL_TITLE_WIDTH);
      const descLines = wrapTooltipLinesByWidth(desc || "-", PANEL_BODY_WIDTH);
      const detailsLines = wrapTooltipLinesByWidth(details || "-", PANEL_BODY_WIDTH);
      const panelH = panelHeightFromLineCounts(
        titleLines.length,
        descLines.length,
        detailsLines.length,
        Boolean(linkHref)
      );
      const labelDescY = panelY + 76;
      const descBodyY = panelY + 92;
      const labelDetailsY = descBodyY + Math.max(1, descLines.length) * 14 + 16;
      const detailsBodyY = labelDetailsY + 16;
      const linkY = panelY + panelH - 10;

      const g = doc.createElementNS(NS, "g");
      g.setAttribute("class", "sk-person");
      g.setAttribute("transform", `translate(${el.x},${el.y})`);

      const img = doc.createElementNS(NS, "image");
      img.setAttribute("href", el.path);
      img.setAttribute("x", String(-el.width / 2));
      img.setAttribute("y", String(-el.height / 2));
      img.setAttribute("width", String(el.width));
      img.setAttribute("height", String(el.height));
      const titleLabel = doc.createElementNS(NS, "text");
      titleLabel.setAttribute("x", "0");
      titleLabel.setAttribute("y", String(el.height / 2 + 14));
      titleLabel.setAttribute("text-anchor", "middle");
      titleLabel.setAttribute("dominant-baseline", "hanging");
      titleLabel.setAttribute("font-size", "12");
      titleLabel.setAttribute("font-family", "Segoe UI, Meiryo, sans-serif");
      titleLabel.setAttribute("fill", "#3a4350");
      titleLabel.textContent = title;

      const hit = doc.createElementNS(NS, "rect");
      hit.setAttribute("class", "sk-hit");
      hit.setAttribute("x", String(-el.width / 2));
      hit.setAttribute("y", String(-el.height / 2));
      hit.setAttribute("width", String(el.width));
      hit.setAttribute("height", String(el.height));
      const open = doc.createElementNS(NS, "a");
      open.setAttribute("class", "sk-person-open");
      open.setAttribute("href", `#${panelId}`);
      open.append(img, titleLabel, hit);
      g.append(open);
      le.append(g);

      const panel = doc.createElementNS(NS, "g");
      panel.setAttribute("id", panelId);
      panel.setAttribute("class", "sk-panel");

      const panelShadow = doc.createElementNS(NS, "rect");
      panelShadow.setAttribute("class", "sk-panel-shadow");
      panelShadow.setAttribute("x", String(panelX + PANEL_SHADOW));
      panelShadow.setAttribute("y", String(panelY + PANEL_SHADOW));
      panelShadow.setAttribute("width", String(PANEL_W));
      panelShadow.setAttribute("height", String(panelH));
      panelShadow.setAttribute("rx", "10");

      const panelBg = doc.createElementNS(NS, "rect");
      panelBg.setAttribute("class", "sk-panel-bg");
      panelBg.setAttribute("x", String(panelX));
      panelBg.setAttribute("y", String(panelY));
      panelBg.setAttribute("width", String(PANEL_W));
      panelBg.setAttribute("height", String(panelH));
      panelBg.setAttribute("rx", "10");

      const panelIcon = doc.createElementNS(NS, "image");
      panelIcon.setAttribute("x", String(panelTextX));
      panelIcon.setAttribute("y", String(panelY + 14));
      panelIcon.setAttribute("width", "44");
      panelIcon.setAttribute("height", "44");
      panelIcon.setAttribute("href", el.path);
      panelIcon.setAttribute("preserveAspectRatio", "xMidYMid slice");

      const panelTitle = doc.createElementNS(NS, "text");
      panelTitle.setAttribute("class", "sk-panel-title");
      panelTitle.setAttribute("x", String(panelX + 70));
      panelTitle.setAttribute("y", String(panelY + 30));
      titleLines.forEach((line, i) => {
        const t = doc.createElementNS(NS, "tspan");
        t.setAttribute("x", String(panelX + 70));
        t.setAttribute("dy", i === 0 ? "0" : "1.2em");
        t.textContent = line;
        panelTitle.append(t);
      });

      const closeLink = doc.createElementNS(NS, "a");
      closeLink.setAttribute("href", "#");
      const closeBtn = doc.createElementNS(NS, "text");
      closeBtn.setAttribute("class", "sk-panel-close");
      closeBtn.setAttribute("x", String(panelX + PANEL_W - 18));
      closeBtn.setAttribute("y", String(panelY + 18));
      closeBtn.textContent = "×";
      closeLink.append(closeBtn);

      const labelDesc = doc.createElementNS(NS, "text");
      labelDesc.setAttribute("class", "sk-panel-label");
      labelDesc.setAttribute("x", String(panelTextX));
      labelDesc.setAttribute("y", String(labelDescY));
      labelDesc.textContent = "説明";
      const descBody = doc.createElementNS(NS, "text");
      descBody.setAttribute("class", "sk-panel-body");
      descBody.setAttribute("x", String(panelTextX));
      descBody.setAttribute("y", String(descBodyY));
      descLines.forEach((line, i) => {
        const t = doc.createElementNS(NS, "tspan");
        t.setAttribute("x", String(panelTextX));
        t.setAttribute("dy", i === 0 ? "0" : "1.25em");
        t.textContent = line;
        descBody.append(t);
      });

      const labelDetails = doc.createElementNS(NS, "text");
      labelDetails.setAttribute("class", "sk-panel-label");
      labelDetails.setAttribute("x", String(panelTextX));
      labelDetails.setAttribute("y", String(labelDetailsY));
      labelDetails.textContent = "詳細";
      const detailsBody = doc.createElementNS(NS, "text");
      detailsBody.setAttribute("class", "sk-panel-body");
      detailsBody.setAttribute("x", String(panelTextX));
      detailsBody.setAttribute("y", String(detailsBodyY));
      detailsLines.forEach((line, i) => {
        const t = doc.createElementNS(NS, "tspan");
        t.setAttribute("x", String(panelTextX));
        t.setAttribute("dy", i === 0 ? "0" : "1.25em");
        t.textContent = line;
        detailsBody.append(t);
      });

      panel.append(panelShadow, panelBg, panelIcon, panelTitle, closeLink, labelDesc, descBody, labelDetails, detailsBody);
      if (linkHref) {
        const ext = doc.createElementNS(NS, "a");
        ext.setAttribute("href", linkHref);
        ext.setAttribute("target", "_blank");
        ext.setAttribute("rel", "noopener noreferrer");
        const extText = doc.createElementNS(NS, "text");
        extText.setAttribute("class", "sk-panel-link");
        extText.setAttribute("x", String(panelTextX));
        extText.setAttribute("y", String(linkY));
        extText.textContent = "リンクを開く";
        ext.append(extText);
        panel.append(ext);
      }
      lp.append(panel);
    }
  }
  root.append(style, defs, bg, lg, lc, le, lp);
  const serializer = new XMLSerializer();
  const xml = serializer.serializeToString(root);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${xml}\n`;
  return { svg, width: vbW, height: vbH };
}

/**
 * SVG 書き出しと同じ viewBox（内容＋余白）でラスタライズし PNG を返す。
 * @param {DiagramData} d
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
async function rasterizeDiagramToPngBlob(d) {
  const { svg: svgStr, width, height } = buildSvgString(d);
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = () => resolve(undefined);
      img.onerror = () => reject(new Error("SVG を画像として読み込めませんでした"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D コンテキストを取得できません");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG のエンコードに失敗しました"))), "image/png");
    });
    return { blob: /** @type {Blob} */ (pngBlob), width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// --- UI イベント ---
document.querySelectorAll(".tool").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tool").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentTool = /** @type {*} */ (btn).dataset.tool;
    connectPending = null;
    deleteHover = null;
    updateToolClass();
    redraw();
    setStatus(`ツール: ${currentTool}`);
  });
});

wireColorPicker("fld-text-color", "fld-text-color-picker", "#111111");
wireColorPicker("fld-conn-color", "fld-conn-color-picker", "#111111");
wireColorPicker("fld-group-color", "fld-group-color-picker", "#3b82f6");
wireColorPicker("fld-group-fill-color", "fld-group-fill-color-picker", "#eff6ff", true);

const groupFillNoneEl = /** @type {HTMLInputElement|null} */ (document.getElementById("fld-group-fill-none"));
const groupFillTextEl = /** @type {HTMLInputElement|null} */ (document.getElementById("fld-group-fill-color"));
const groupFillPickerEl = /** @type {HTMLInputElement|null} */ (document.getElementById("fld-group-fill-color-picker"));
function applyGroupFillNoneState() {
  if (!groupFillNoneEl || !groupFillTextEl || !groupFillPickerEl) return;
  const isNone = groupFillNoneEl.checked;
  groupFillTextEl.disabled = isNone;
  groupFillPickerEl.disabled = isNone;
  if (isNone) groupFillTextEl.value = "";
  else syncColorPicker("fld-group-fill-color", "fld-group-fill-color-picker", "#eff6ff", true);
}
groupFillNoneEl?.addEventListener("change", applyGroupFillNoneState);

document.getElementById("btn-new").addEventListener("click", () => {
  if (!confirm("編集中の内容を破棄して新規にしますか？")) return;
  data = emptyData();
  resetView();
  redraw();
  setStatus("新規キャンバスを開始しました。");
});

document.getElementById("btn-import").addEventListener("click", () => {
  document.getElementById("file-import").click();
});

document.getElementById("file-import").addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed.canvas_info || !Array.isArray(parsed.elements)) throw new Error("形式が不正です");
    data = {
      canvas_info: {
        width: Number(parsed.canvas_info.width) || DEFAULT_CANVAS.width,
        height: Number(parsed.canvas_info.height) || DEFAULT_CANVAS.height,
      },
      elements: parsed.elements || [],
      groups: parsed.groups || [],
      connections: parsed.connections || [],
    };
    resetView();
    redraw();
    setStatus(`読み込み: ${file.name}`);
  } catch (e) {
    alert(`JSON の読み込みに失敗しました: ${e}`);
  }
});

document.getElementById("btn-reset-view").addEventListener("click", () => {
  resetView();
  redraw();
  setStatus("表示を全体に合わせました。");
});

canvasWrap.addEventListener(
  "wheel",
  (ev) => {
    if (!canvasWrap.contains(/** @type {Node} */ (ev.target))) return;
    ev.preventDefault();
    const { x: sx, y: sy } = clientToSvg(ev);
    const factor = Math.exp(ev.deltaY * 0.0011);
    const minW = 40;
    const maxW = Math.max(data.canvas_info.width, data.canvas_info.height) * 30;
    let newVw = viewState.vw * factor;
    newVw = Math.min(maxW, Math.max(minW, newVw));
    const newVh = newVw * (viewState.vh / viewState.vw);
    const u = (sx - viewState.vx) / viewState.vw;
    const v = (sy - viewState.vy) / viewState.vh;
    viewState.vx = sx - u * newVw;
    viewState.vy = sy - v * newVh;
    viewState.vw = newVw;
    viewState.vh = newVh;
    applySvgSize();
  },
  { passive: false }
);

document.getElementById("btn-add-image").addEventListener("click", () => {
  document.getElementById("image-file").click();
});

document.getElementById("image-file").addEventListener("change", async (ev) => {
  const files = Array.from(ev.target.files || []);
  ev.target.value = "";
  if (!files.length) return;
  let added = 0;
  const errs = [];
  const base = data.elements.length;
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    try {
      const dataUrl = await readImageFile(file);
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = dataUrl;
      });
      const idx = base + added;
      const el = /** @type {ElementImage} */ ({
        type: "image",
        id: uuid(),
        path: dataUrl,
        x: 120 + (idx % 8) * 24,
        y: 120 + (idx % 8) * 18,
        width: DEFAULT_IMAGE_SIZE,
        height: DEFAULT_IMAGE_SIZE,
        profile: { title: basenameWithoutExtension(file.name), description: "", details: "" },
      });
      data.elements.push(el);
      added += 1;
    } catch (e) {
      errs.push(`${file.name}: ${e}`);
    }
  }
  if (added) redraw();
  if (errs.length) alert(`一部の画像を読み込めませんでした:\n${errs.join("\n")}`);
  if (added) {
    setStatus(`${added} 件の画像を追加しました（パスは data URL として保存されます）。`);
  }
});

document.getElementById("btn-add-text").addEventListener("click", () => {
  const el = /** @type {ElementText} */ ({
    type: "text",
    id: uuid(),
    content: "新規テキスト",
    x: 300 + (data.elements.length % 8) * 16,
    y: 280 + (data.elements.length % 8) * 14,
    font: "Segoe UI",
    size: 14,
    color: "#111111",
  });
  data.elements.push(el);
  redraw();
  setStatus("テキストを追加しました。ダブルクリックまたは右クリックで編集できます。");
});

document.querySelectorAll('input[name="export-format"]').forEach((r) => {
  r.addEventListener("change", () => {});
});

document.getElementById("btn-export").addEventListener("click", async () => {
  const fmt = /** @type {HTMLInputElement} */ (document.querySelector('input[name="export-format"]:checked')).value;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  if (fmt === "json") {
    const json = JSON.stringify(data, null, 2);
    downloadBlob(`diagram-${stamp}.json`, "application/json", json);
    setStatus("JSON をダウンロードしました。");
    return;
  }
  if (fmt === "svg") {
    const { svg: svgStr, width, height } = buildSvgString(data);
    downloadBlob(`diagram-${stamp}.svg`, "image/svg+xml", svgStr);
    setStatus(
      `SVG をダウンロードしました（${width}×${height} px 相当の viewBox・内容＋余白）。ブラウザで開き、画像にマウスを乗せてください。`
    );
    return;
  }
  if (fmt === "png") {
    try {
      const { blob: pngBlob, width: pw, height: ph } = await rasterizeDiagramToPngBlob(data);
      const a = document.createElement("a");
      const href = URL.createObjectURL(pngBlob);
      a.href = href;
      a.download = `diagram-${stamp}.png`;
      a.click();
      URL.revokeObjectURL(href);
      setStatus(`PNG をダウンロードしました（${pw}×${ph} px・SVG と同じ切り出し・標準 PNG）。`);
    } catch (e) {
      alert(`PNG 出力に失敗しました: ${e}`);
      setStatus("PNG 出力に失敗しました。");
    }
  }
});

// モーダルキャンセル
["dlg-text-cancel", "dlg-profile-cancel", "dlg-group-cancel"].forEach((id) => {
  document.getElementById(id)?.addEventListener("click", (e) => {
    const dlg = /** @type {HTMLDialogElement} */ (e.target.closest("dialog"));
    dlg?.close();
  });
});

function enableDialogDismiss(dlgId) {
  const dlg = /** @type {HTMLDialogElement|null} */ (document.getElementById(dlgId));
  if (!dlg) return;
  // Esc キーでも確実に閉じる
  dlg.addEventListener("cancel", (ev) => {
    ev.preventDefault();
    dlg.close();
  });
  // ダイアログ外（backdrop）クリックで閉じる
  dlg.addEventListener("click", (ev) => {
    if (ev.target === dlg) dlg.close();
  });
}

["dlg-text", "dlg-profile", "dlg-connection", "dlg-group"].forEach(enableDialogDismiss);

document.getElementById("dlg-conn-cancel")?.addEventListener("click", () => {
  editingConnectionId = null;
  pendingConnStyle = null;
  document.getElementById("dlg-connection").close();
});

document.getElementById("dlg-connection")?.addEventListener("close", () => {
  if (!editingConnectionId) pendingConnStyle = null;
});

document.getElementById("dlg-group-cancel")?.addEventListener("click", () => {
  editingGroupId = null;
  document.getElementById("form-group")._rubber = null;
});
document.getElementById("dlg-group")?.addEventListener("close", () => {
  if (!editingGroupId) document.getElementById("form-group")._rubber = null;
});
if (groupFillNoneEl) {
  groupFillNoneEl.checked = true;
  applyGroupFillNoneState();
}

/** @type {ElementText|null} */
let editingText = null;
function saveEditingText() {
  if (!editingText) return;
  editingText.content = document.getElementById("fld-text-content").value.replace(/\r\n/g, "\n");
  editingText.color = document.getElementById("fld-text-color").value || "#111";
  editingText.size = parseInt(document.getElementById("fld-text-size").value, 10) || 14;
  editingText = null;
  redraw();
  setStatus("テキストを更新しました。");
}
document.getElementById("form-text").addEventListener("submit", (e) => {
  e.preventDefault();
  saveEditingText();
  document.getElementById("dlg-text").close();
});
document.getElementById("dlg-text")?.addEventListener("close", () => {
  saveEditingText();
});

/** @type {ElementImage|null} */
let editingProfile = null;
function saveEditingProfile() {
  if (!editingProfile) return;
  editingProfile.profile = {
    title: document.getElementById("fld-profile-title").value,
    description: document.getElementById("fld-profile-desc").value,
    details: document.getElementById("fld-profile-details").value,
    link_url: document.getElementById("fld-profile-link-url").value.trim(),
  };
  editingProfile = null;
  redraw();
  setStatus("プロフィールを保存しました。");
}
document.getElementById("form-profile").addEventListener("submit", (e) => {
  e.preventDefault();
  saveEditingProfile();
  document.getElementById("dlg-profile").close();
});
document.getElementById("dlg-profile")?.addEventListener("close", () => {
  saveEditingProfile();
});

/** @param {Connection} c */
function openConnectionEditor(c) {
  editingConnectionId = c.id;
  document.getElementById("fld-conn-type").value = c.type || "line";
  document.getElementById("fld-conn-color").value = c.color || "#111111";
  syncColorPicker("fld-conn-color", "fld-conn-color-picker", "#111111");
  document.getElementById("fld-conn-width").value = String(c.width ?? 2);
  document.getElementById("fld-conn-label").value = c.label || "";
  document.getElementById("fld-conn-label-size").value = String(c.label_size ?? 12);
  const lo = c.label_offset;
  document.getElementById("fld-conn-label-offset").value = String(Number.isFinite(lo) ? lo : 0);
  openDialog(document.getElementById("dlg-connection"));
}

/** @param {Group} g */
function openGroupEditor(g) {
  editingGroupId = g.id;
  document.getElementById("form-group")._rubber = null;
  document.getElementById("fld-group-label").value = g.label || "グループ";
  document.getElementById("fld-group-color").value = g.color || "#3b82f6";
  syncColorPicker("fld-group-color", "fld-group-color-picker", "#3b82f6");
  document.getElementById("fld-group-line-type").value = g.line_type || "dash";
  document.getElementById("fld-group-stroke-width").value = String(Math.max(1, Number(g.stroke_width) || 1));
  document.getElementById("fld-group-fill-color").value = g.fill_color || "";
  syncColorPicker("fld-group-fill-color", "fld-group-fill-color-picker", "#eff6ff", true);
  if (groupFillNoneEl) {
    groupFillNoneEl.checked = !String(g.fill_color || "").trim();
    applyGroupFillNoneState();
  }
  openDialog(document.getElementById("dlg-group"));
}

document.getElementById("form-connection").addEventListener("submit", (e) => {
  e.preventDefault();
  const isEdit = Boolean(editingConnectionId);
  const isNew = pendingConnStyle && "start_id" in pendingConnStyle;
  if (!isEdit && !isNew) return;

  const type = document.getElementById("fld-conn-type").value;
  const color = document.getElementById("fld-conn-color").value || "#111";
  const width = parseInt(document.getElementById("fld-conn-width").value, 10) || 2;
  const label = document.getElementById("fld-conn-label").value.trim();
  const labelSize = parseInt(document.getElementById("fld-conn-label-size").value, 10) || 12;
  const labelOffRaw = parseFloat(document.getElementById("fld-conn-label-offset").value);
  const labelOffset = Number.isFinite(labelOffRaw) ? labelOffRaw : 0;

  if (isEdit) {
    const c = data.connections.find((x) => x.id === editingConnectionId);
    if (c) {
      c.type = type;
      c.color = color;
      c.width = width;
      if (label) {
        c.label = label;
        c.label_size = labelSize;
        c.label_offset = labelOffset;
      } else {
        delete c.label;
        delete c.label_size;
        delete c.label_offset;
      }
      setStatus("接続線を更新しました。");
    }
    editingConnectionId = null;
  } else {
    /** @type {{start_id:string,start_type:string,end_id:string,end_type:string}} */
    const p = /** @type {*} */ (pendingConnStyle);
    /** @type {Connection} */
    const conn = {
      id: uuid(),
      start_id: p.start_id,
      start_type: p.start_type,
      end_id: p.end_id,
      end_type: p.end_type,
      type,
      color,
      width,
    };
    if (label) {
      conn.label = label;
      conn.label_size = labelSize;
      conn.label_offset = labelOffset;
    }
    data.connections.push(conn);
    setStatus("接続を追加しました。");
  }

  document.getElementById("dlg-connection").close();
  pendingConnStyle = null;
  redraw();
});

function saveEditingConnectionOnClose() {
  if (!editingConnectionId) return;
  const c = data.connections.find((x) => x.id === editingConnectionId);
  if (!c) {
    editingConnectionId = null;
    return;
  }
  const type = document.getElementById("fld-conn-type").value;
  const color = document.getElementById("fld-conn-color").value || "#111";
  const width = parseInt(document.getElementById("fld-conn-width").value, 10) || 2;
  const label = document.getElementById("fld-conn-label").value.trim();
  const labelSize = parseInt(document.getElementById("fld-conn-label-size").value, 10) || 12;
  const labelOffRaw = parseFloat(document.getElementById("fld-conn-label-offset").value);
  const labelOffset = Number.isFinite(labelOffRaw) ? labelOffRaw : 0;
  c.type = type;
  c.color = color;
  c.width = width;
  if (label) {
    c.label = label;
    c.label_size = labelSize;
    c.label_offset = labelOffset;
  } else {
    delete c.label;
    delete c.label_size;
    delete c.label_offset;
  }
  editingConnectionId = null;
  redraw();
  setStatus("接続線を更新しました。");
}
document.getElementById("dlg-connection")?.addEventListener("close", () => {
  saveEditingConnectionOnClose();
});

document.getElementById("form-group").addEventListener("submit", (e) => {
  e.preventDefault();
  const label = document.getElementById("fld-group-label").value;
  const color = document.getElementById("fld-group-color").value || "#3b82f6";
  const lineType = document.getElementById("fld-group-line-type").value || "dash";
  const strokeWidth = Math.max(1, parseInt(document.getElementById("fld-group-stroke-width").value, 10) || 1);
  const fillColor = groupFillNoneEl?.checked ? "" : document.getElementById("fld-group-fill-color").value.trim();

  if (editingGroupId) {
    const g = getById(data, editingGroupId, "group");
    if (!g) return;
    g.label = label;
    g.color = color;
    g.line_type = lineType;
    g.stroke_width = strokeWidth;
    g.fill_color = fillColor;
    refreshGroupMembers(g);
    setStatus(`グループ「${label}」を更新しました。`);
  } else {
    const r = /** @type {*} */ (document.getElementById("form-group")._rubber);
    if (!r) return;
    const x1 = Math.min(r.x1, r.x2);
    const y1 = Math.min(r.y1, r.y2);
    const x2 = Math.max(r.x1, r.x2);
    const y2 = Math.max(r.y1, r.y2);
    const members = data.elements.filter((el) => el.x >= x1 && el.x <= x2 && el.y >= y1 && el.y <= y2).map((el) => el.id);
    if (!members.length) {
      alert("範囲内に要素がありません。");
      return;
    }
    data.groups.push({
      id: uuid(),
      members,
      bounds: [x1, y1, x2, y2],
      label,
      color,
      line_type: lineType,
      stroke_width: strokeWidth,
      fill_color: fillColor,
    });
    setStatus(`グループ「${label}」を作成しました。`);
  }
  document.getElementById("dlg-group").close();
  editingGroupId = null;
  document.getElementById("form-group")._rubber = null;
  redraw();
});

function saveEditingGroupOnClose() {
  if (!editingGroupId) return;
  const g = getById(data, editingGroupId, "group");
  if (!g) {
    editingGroupId = null;
    return;
  }
  const label = document.getElementById("fld-group-label").value;
  const color = document.getElementById("fld-group-color").value || "#3b82f6";
  const lineType = document.getElementById("fld-group-line-type").value || "dash";
  const strokeWidth = Math.max(1, parseInt(document.getElementById("fld-group-stroke-width").value, 10) || 1);
  const fillColor = groupFillNoneEl?.checked ? "" : document.getElementById("fld-group-fill-color").value.trim();
  g.label = label;
  g.color = color;
  g.line_type = lineType;
  g.stroke_width = strokeWidth;
  g.fill_color = fillColor;
  refreshGroupMembers(g);
  editingGroupId = null;
  redraw();
  setStatus(`グループ「${label}」を更新しました。`);
}
document.getElementById("dlg-group")?.addEventListener("close", () => {
  saveEditingGroupOnClose();
});

svg.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  const hit = hitTarget(ev);
  if (currentTool === "delete") {
    if (hit.kind !== "canvas") {
      if (confirm("このアイテムを削除しますか？")) deleteByHit(hit);
    }
    return;
  }
  if (currentTool === "connect") {
    if (hit.kind === "element" || hit.kind === "group") {
      const typ = hit.kind === "group" ? "group" : "element";
      if (!connectPending) {
        connectPending = { start_id: hit.id, start_type: typ };
        setStatus("終点となる要素をクリックしてください。");
      } else {
        if (connectPending.start_id === hit.id) {
          setStatus("同じ要素は選べません。");
          return;
        }
        pendingConnStyle = {
          start_id: connectPending.start_id,
          start_type: connectPending.start_type,
          end_id: hit.id,
          end_type: typ,
        };
        connectPending = null;
        document.getElementById("fld-conn-type").value = "arrow";
        document.getElementById("fld-conn-color").value = "#111111";
        syncColorPicker("fld-conn-color", "fld-conn-color-picker", "#111111");
        document.getElementById("fld-conn-width").value = "2";
        document.getElementById("fld-conn-label").value = "";
        document.getElementById("fld-conn-label-size").value = "12";
        document.getElementById("fld-conn-label-offset").value = "0";
        editingConnectionId = null;
        openDialog(document.getElementById("dlg-connection"));
      }
    }
    return;
  }
  if (currentTool === "group") {
    groupDragging = true;
    groupStart = { x: hit.x, y: hit.y };
    showRubber(hit.x, hit.y, hit.x, hit.y);
    return;
  }
  if (currentTool === "select" && hit.kind === "group-handle") {
    const g = getById(data, hit.id, "group");
    if (!g) return;
    normalizeGroupBounds(g);
    const [l, t, r, b] = g.bounds;
    groupResize = {
      id: g.id,
      handle: hit.handle,
      l0: l,
      t0: t,
      r0: r,
      b0: b,
      x0: hit.x,
      y0: hit.y,
    };
    try {
      svg.setPointerCapture(ev.pointerId);
    } catch (_) {}
    return;
  }
  if (currentTool === "select" && hit.kind === "canvas") {
    boardPanning = true;
    lastPanClient = { clientX: ev.clientX, clientY: ev.clientY };
    svg.style.cursor = "grabbing";
    try {
      svg.setPointerCapture(ev.pointerId);
    } catch (_) {}
    return;
  }
  if (currentTool === "select" && (hit.kind === "element" || hit.kind === "group")) {
    try {
      svg.setPointerCapture(ev.pointerId);
    } catch (_) {}
    startDrag(hit);
  }
});

svg.addEventListener("pointermove", (ev) => {
  const hit = hitTarget(ev);
  if (groupResize) {
    applyGroupResize(hit);
    redraw();
    return;
  }
  if (groupDragging) {
    showRubber(groupStart.x, groupStart.y, hit.x, hit.y);
    return;
  }
  if (boardPanning && lastPanClient) {
    const rect = svg.getBoundingClientRect();
    const dw = rect.width || 1;
    const dh = rect.height || 1;
    const dcx = ev.clientX - lastPanClient.clientX;
    const dcy = ev.clientY - lastPanClient.clientY;
    viewState.vx -= (dcx / dw) * viewState.vw;
    viewState.vy -= (dcy / dh) * viewState.vh;
    lastPanClient = { clientX: ev.clientX, clientY: ev.clientY };
    applySvgSize();
    return;
  }
  if (currentTool === "delete" && !groupResize && !groupDragging && !boardPanning && !draggingId) {
    /** @type {{ kind: string, id: string, handle?: string } | null} */
    const next =
      hit.kind === "canvas"
        ? null
        : hit.kind === "group-handle"
          ? { kind: hit.kind, id: hit.id, handle: hit.handle }
          : { kind: hit.kind, id: hit.id };
    const changed =
      (deleteHover?.kind !== next?.kind) ||
      (deleteHover?.id !== next?.id) ||
      (deleteHover?.handle !== next?.handle);
    if (changed) {
      deleteHover = next;
      redraw();
    }
    return;
  }
  if (draggingId) moveDrag(hit);
});

svg.addEventListener("pointerup", (ev) => {
  if (groupDragging) {
    groupDragging = false;
    hideRubber();
    const hit = hitTarget(ev);
    document.getElementById("form-group")._rubber = {
      x1: groupStart.x,
      y1: groupStart.y,
      x2: hit.x,
      y2: hit.y,
    };
    editingGroupId = null;
    document.getElementById("fld-group-label").value = "グループ";
    document.getElementById("fld-group-color").value = "#3b82f6";
    syncColorPicker("fld-group-color", "fld-group-color-picker", "#3b82f6");
    document.getElementById("fld-group-line-type").value = "dash";
    document.getElementById("fld-group-stroke-width").value = "1";
    document.getElementById("fld-group-fill-color").value = "";
    syncColorPicker("fld-group-fill-color", "fld-group-fill-color-picker", "#eff6ff", true);
    if (groupFillNoneEl) {
      groupFillNoneEl.checked = true;
      applyGroupFillNoneState();
    }
    openDialog(document.getElementById("dlg-group"));
    return;
  }
  if (groupResize) {
    const g = getById(data, groupResize.id, "group");
    if (g) {
      normalizeGroupBounds(g);
      refreshGroupMembers(g);
    }
    groupResize = null;
    try {
      if (svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
    } catch (_) {}
    redraw();
    setStatus("グループの枠を更新しました（範囲内の要素で members を更新）。");
    return;
  }
  if (boardPanning) {
    boardPanning = false;
    lastPanClient = null;
    svg.style.cursor = "";
    try {
      if (svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
    } catch (_) {}
    return;
  }
  endDrag();
  try {
    if (svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
  } catch (_) {}
  redraw();
});

svg.addEventListener("pointerleave", () => {
  if (currentTool !== "delete" || !deleteHover) return;
  deleteHover = null;
  redraw();
});

svg.addEventListener("pointercancel", () => {
  groupDragging = false;
  hideRubber();
  boardPanning = false;
  lastPanClient = null;
  svg.style.cursor = "";
  if (groupResize) {
    const g = getById(data, groupResize.id, "group");
    if (g) {
      normalizeGroupBounds(g);
      refreshGroupMembers(g);
    }
    groupResize = null;
  }
  endDrag();
  redraw();
});

svg.addEventListener("dblclick", (ev) => {
  const hit = hitTarget(ev);
  if (hit.kind === "group") {
    const g = getById(data, hit.id, "group");
    if (g) openGroupEditor(g);
    return;
  }
  if (hit.kind === "connection") {
    const c = getById(data, hit.id, "connection");
    if (c) openConnectionEditor(c);
    return;
  }
  if (hit.kind !== "element") return;
  const el = getById(data, hit.id, "element");
  if (!el || el.type !== "text") return;
  editingText = el;
  document.getElementById("fld-text-content").value = el.content;
  document.getElementById("fld-text-color").value = el.color || "#111111";
  syncColorPicker("fld-text-color", "fld-text-color-picker", "#111111");
  document.getElementById("fld-text-size").value = String(el.size ?? 14);
  openDialog(document.getElementById("dlg-text"));
});

svg.addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  const hit = hitTarget(ev);
  if (hit.kind === "group") {
    const g = getById(data, hit.id, "group");
    if (g) openGroupEditor(g);
    return;
  }
  if (hit.kind === "connection") {
    const c = getById(data, hit.id, "connection");
    if (c) openConnectionEditor(c);
    return;
  }
  if (hit.kind !== "element") return;
  const el = getById(data, hit.id, "element");
  if (!el) return;
  if (el.type === "image") {
    editingProfile = el;
    const p = el.profile || {};
    document.getElementById("fld-profile-title").value = p.title || "";
    document.getElementById("fld-profile-desc").value = p.description || "";
    document.getElementById("fld-profile-details").value = p.details || "";
    document.getElementById("fld-profile-link-url").value = p.link_url || "";
    openDialog(document.getElementById("dlg-profile"));
    return;
  }
  if (el.type === "text") {
    editingText = el;
    document.getElementById("fld-text-content").value = el.content;
    document.getElementById("fld-text-color").value = el.color || "#111111";
    syncColorPicker("fld-text-color", "fld-text-color-picker", "#111111");
    document.getElementById("fld-text-size").value = String(el.size ?? 14);
    openDialog(document.getElementById("dlg-text"));
  }
});

// 初期描画
resetView();
redraw();
setStatus("準備完了。JSON を開くか、画像・テキストを追加して相関図を作成できます。ホイールで拡大縮小できます。");
