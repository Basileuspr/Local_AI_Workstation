import word from "./assets/application-icons/word.svg";
import excel from "./assets/application-icons/excel.svg";
import powerpoint from "./assets/application-icons/powerpoint.svg";
import outlook from "./assets/application-icons/outlook.svg";
import onenote from "./assets/application-icons/onenote.svg";
import teams from "./assets/application-icons/teams.svg";
import onedrive from "./assets/application-icons/onedrive.svg";
import access from "./assets/application-icons/access.svg";

export const REGISTRY_ICONS_KEY = "local-ai-workstation-shortcut-icons-v1";
export const ICON_FILE_LIMIT = 128 * 1024;
const icons = { word, excel, powerpoint, outlook, onenote, teams, onedrive, access };
const prefixes = ["", "microsoft ", "ms ", "office ", "microsoft office ", "microsoft 365 ", "office 365 "];
export const applicationIconKey = application => application.trim().toLowerCase().replace(/\s+/g, " ");

export function automaticApplicationIcon(application) {
  const name = applicationIconKey(application).replace(/[®™]/g, "").replace(/\s+(?:20\d{2}|365)$/, "").trim();
  for (const [product, source] of Object.entries(icons)) {
    if (prefixes.some(prefix => name === prefix + product)) return source;
  }
  return null;
}

export function applicationInitials(application) {
  return application.trim().split(/\s+/).slice(0, 2).map(word => [...word][0] || "").join("").toUpperCase() || "?";
}

function validateIcons(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 200)
    throw new Error("Invalid saved application icons.");
  const clean = Object.create(null);
  for (const [application, source] of Object.entries(value)) {
    if (!application.trim() || application.length > 300 || typeof source !== "string" ||
      source.length > Math.ceil(ICON_FILE_LIMIT / 3) * 4 + 80 ||
      !/^data:image\/(?:png|jpeg|webp|x-icon);base64,[A-Za-z0-9+/]+={0,2}$/.test(source))
      throw new Error("Invalid saved application icon.");
    clean[applicationIconKey(application)] = source;
  }
  return clean;
}

export function loadRegistryIcons() {
  return validateIcons(JSON.parse(localStorage.getItem(REGISTRY_ICONS_KEY) || "{}"));
}

export function saveRegistryIcons(value) {
  const clean = validateIcons(value);
  localStorage.setItem(REGISTRY_ICONS_KEY, JSON.stringify(clean));
  return clean;
}

export function applicationIconMime(bytes) {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if ([82, 73, 70, 70].every((byte, index) => bytes[index] === byte) &&
    [87, 69, 66, 80].every((byte, index) => bytes[index + 8] === byte)) return "image/webp";
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0 && (bytes[4] || bytes[5])) return "image/x-icon";
  throw new Error("Choose a PNG, JPG, WebP, or ICO image.");
}

export async function readApplicationIcon(file) {
  if (!file || !file.size || file.size > ICON_FILE_LIMIT) throw new Error("Choose an icon image up to 128 KB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = applicationIconMime(bytes);
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The icon image could not be read."));
    reader.readAsDataURL(new Blob([bytes], { type }));
  });
  await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The file could not be opened as an icon image."));
    image.src = source;
  });
  return source;
}
