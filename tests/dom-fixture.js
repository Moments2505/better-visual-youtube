"use strict";
// Small tree-backed DOM contract for Node VM tests. Selector matching is limited
// to the tag/id/class/attribute, descendant and selector-list syntax used here;
// unknown syntax throws rather than returning invented hits.
function matchesSimple(el, selector) {
  const tokens = selector.match(/^[\w-]+|[#.][\w-]+|\[[\w-]+(?:=["']?[^\]"']+["']?)?\]/g) || [];
  if (tokens.join("") !== selector) throw new Error("Unsupported fixture selector: " + selector);
  return tokens.every(token => {
    if (token[0] === "#") return el.getAttribute("id") === token.slice(1);
    if (token[0] === ".") return el.classList.contains(token.slice(1));
    if (token[0] === "[") {
      const [, name, value] = token.match(/^\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]$/);
      return value === undefined ? el.hasAttribute(name) : el.getAttribute(name) === value;
    }
    return el.tagName === token.toUpperCase();
  });
}
function matches(el, selectors) {
  return selectors.split(",").some(selector => {
    const parts = selector.trim().split(/\s+/);
    if (!matchesSimple(el, parts.pop())) return false;
    let ancestor = el.parentElement;
    while (parts.length) {
      const part = parts.pop();
      while (ancestor && !matchesSimple(ancestor, part)) ancestor = ancestor.parentElement;
      if (!ancestor) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
}
function queryAll(scope, selector) {
  const out = [];
  function walk(node) {
    for (const child of node.children) {
      if (matches(child, selector)) out.push(child);
      walk(child);
    }
  }
  walk(scope);
  return out;
}
function makeEl(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(), nodeType: 1, children: [], parentNode: null,
    attrs: {}, classes: new Set(), rect: { left: 0, top: 0, width: 640, height: 360 },
    style: { _: {}, setProperty(k, v) { this._[k] = String(v); },
      getPropertyValue(k) { return this._[k] || ""; },
      removeProperty(k) { const old = this._[k] || ""; delete this._[k]; delete this[k]; return old; } },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; }, hasAttribute(k) { return k in this.attrs; },
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); this.children.push(c); c.parentNode = this; return c; },
    insertBefore(c, ref) { if (c.parentNode) c.parentNode.removeChild(c); const i = ref ? this.children.indexOf(ref) : this.children.length; if (i < 0) throw new Error("NotFoundError"); this.children.splice(i, 0, c); c.parentNode = this; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i < 0) throw new Error("NotFoundError"); this.children.splice(i, 1); c.parentNode = null; return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    contains(c) { for (let n = c; n; n = n.parentNode) if (n === this) return true; return false; },
    querySelector(selector) { return queryAll(this, selector)[0] || null; },
    querySelectorAll(selector) { return queryAll(this, selector); },
    closest(selector) { for (let n = this; n; n = n.parentElement) if (matches(n, selector)) return n; return null; },
    getBoundingClientRect() { const { left, top, width, height } = this.rect; return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height }; },
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, drawImage() {}, fillRect() {}, getImageData: () => ({ data: new Uint8ClampedArray(64).fill(60) }) }),
    toDataURL: () => "data:image/png;base64,TEST"
  };
  Object.defineProperties(el, {
    id: { get: () => el.getAttribute("id") || "", set: value => el.setAttribute("id", value) },
    className: { get: () => [...el.classes].join(" "), set(value) { el.classes = new Set(String(value).split(/\s+/).filter(Boolean)); } },
    hidden: { get: () => el.hasAttribute("hidden"), set(value) { if (value) el.setAttribute("hidden", ""); else el.removeAttribute("hidden"); } },
    parentElement: { get: () => el.parentNode && el.parentNode.nodeType === 1 ? el.parentNode : null },
    isConnected: { get() { let n = el; while (n.parentNode) n = n.parentNode; return n.tagName === "HTML"; } },
    classList: { value: { add: (...cs) => cs.forEach(c => el.classes.add(c)), remove: (...cs) => cs.forEach(c => el.classes.delete(c)), contains: c => el.classes.has(c) } }
  });
  return el;
}
function getComputedStyle(el) {
  return { display: el.style.display || el.style._.display || "block", visibility: el.style.visibility || el.style._.visibility || "visible", opacity: el.style.opacity || el.style._.opacity || "1" };
}
module.exports = { makeEl, queryAll, matches, getComputedStyle };
