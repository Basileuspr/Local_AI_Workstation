// Executed in the source renderer. Copies DOM state only; never changes the live
// page, runs React in a second window, or submits requests. Keep dependencies inside.
async function snapshotDocument({ tab, label, embedded = false }) {
  const root = embedded ? document.body : document.querySelector("#app");
  if (!root) throw new Error("The page is not ready to capture.");
  if (!embedded && !root.querySelector(`[data-capture-tab="${tab}"]`)) throw new Error("This tab is not ready to capture.");
  const images = [], tasks = [], warnings = [];
  let nodeCount = 0;
  function clone(source) {
    if (++nodeCount > 100000) throw new Error("This view is too large to capture.");
    if (source.nodeType !== Node.ELEMENT_NODE) return source.cloneNode(false);
    const tag = source.tagName.toLowerCase();
    if (["script", "iframe", "object", "embed", "link", "meta", "base"].includes(tag)) return document.createTextNode("");
    if (source.matches("[data-capture-tab]") && source.dataset.captureTab !== tab) return document.createTextNode("");
    const copy = source.cloneNode(false);
    for (const attribute of [...copy.attributes]) {
      if (/^on/i.test(attribute.name) || ["autofocus", "inert", "srcset", "formaction"].includes(attribute.name)) copy.removeAttribute(attribute.name);
    }
    if (source.matches("[data-capture-tab]")) copy.hidden = false;
    if (tag === "input") {
      if (!["password", "file"].includes(source.type)) copy.setAttribute("value", source.value);
      else copy.removeAttribute("value");
      copy.toggleAttribute("checked", source.checked);
    }
    if (tag === "textarea") { copy.textContent = source.value; return copy; }
    if (tag === "option") copy.toggleAttribute("selected", source.selected);
    if (source.getClientRects().length && (source.scrollTop || source.scrollLeft)) {
      copy.dataset.captureScrollTop = source.scrollTop; copy.dataset.captureScrollLeft = source.scrollLeft;
    }
    if (tag === "canvas" || tag === "video") {
      const image = document.createElement("img");
      image.className = source.className; image.setAttribute("style", source.getAttribute("style") || "");
      try {
        let canvas = source;
        if (tag === "video") { canvas = document.createElement("canvas"); canvas.width = source.videoWidth; canvas.height = source.videoHeight; canvas.getContext("2d").drawImage(source, 0, 0); }
        image.src = canvas.toDataURL("image/png"); image.width = source.width || canvas.width; image.height = source.height || canvas.height;
      } catch { image.alt = "Preview unavailable"; warnings.push("A canvas or video preview could not be captured."); }
      return image;
    }
    if (tag === "img") { images.push([source.currentSrc || source.src, copy]); copy.removeAttribute("src"); copy.loading = "eager"; }
    if (source.shadowRoot) {
      const template = document.createElement("template"); template.setAttribute("shadowrootmode", "open");
      for (const child of source.shadowRoot.childNodes) template.content.append(clone(child));
      for (const sheet of source.shadowRoot.adoptedStyleSheets || []) {
        const style = document.createElement("style"); style.textContent = [...sheet.cssRules].map(rule => rule.cssText).join("\n"); template.content.append(style);
      }
      copy.append(template);
    }
    for (const child of source.childNodes) copy.append(clone(child));
    return copy;
  }
  const copy = clone(root);
  if (!embedded) {
    copy.classList.remove("navigation-open");
    copy.querySelectorAll(".navigation-backdrop, .sidebar-group-current").forEach(node => node.remove());
    const title = copy.querySelector(".workspace-navigation > span"); if (title) title.textContent = label;
    copy.querySelectorAll("[data-sidebar-route]").forEach(button => {
      button.removeAttribute("aria-current");
      if (button.dataset.sidebarRoute === tab) button.setAttribute("aria-current", "page");
    });
    copy.querySelectorAll(".sidebar-nav-group").forEach(group => {
      const selected = !!group.querySelector('[aria-current="page"]');
      group.classList.toggle("contains-current", selected);
      group.querySelector(".sidebar-group-toggle")?.setAttribute("aria-expanded", String(selected));
      const items = group.querySelector(".sidebar-group-items"); if (items) items.hidden = !selected;
    });
    // Sidebar collections are separate from the main panes.
    const sidebarContent = copy.querySelector("#sidebar-content");
    if (sidebarContent && !["chats", "generate", "images"].includes(tab)) sidebarContent.replaceChildren();
    copy.querySelectorAll("[data-capture-sidebar]").forEach(node => { node.hidden = node.dataset.captureSidebar !== tab; });
    const heading = copy.querySelector(".sidebar-content-heading");
    if (heading) heading.textContent = { chats: "Chats", generate: "Prompt buttons", images: "Image library" }[tab] || "";
  }
  const assets = new Map();
  async function dataUrl(url) {
    if (assets.has(url)) return assets.get(url);
    const pending = (async () => {
      if (url.startsWith("data:image/")) return url;
      const parsed = new URL(url, location.href);
      if (!["blob:", "app:", "http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported asset");
      if (["http:", "https:"].includes(parsed.protocol) && !["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.origin !== location.origin) throw new Error("Remote asset blocked");
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("Asset unavailable");
      const blob = await response.blob(); if (!blob.type.startsWith("image/") || blob.size > 32 * 1024 * 1024) throw new Error("Invalid asset");
      return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    })();
    assets.set(url, pending); return pending;
  }
  // A small pool avoids flooding the backend for large galleries.
  let next = 0;
  for (let worker = 0; worker < 6; worker++) tasks.push((async () => {
    while (next < images.length) {
      const [url, image] = images[next++];
      try { image.src = await dataUrl(url); }
      catch { image.alt = image.alt || "Image unavailable"; warnings.push("An image was unavailable in this capture."); }
    }
  })());
  await Promise.all(tasks);
  let css = "";
  for (const sheet of document.styleSheets) {
    try { css += [...sheet.cssRules].map(rule => rule.cssText).join("\n") + "\n"; }
    catch { warnings.push("A stylesheet could not be captured."); }
  }
  css += "\n*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;}";
  return { html: copy.outerHTML, css, warnings: [...new Set(warnings)] };
}

module.exports = { snapshotDocument };
