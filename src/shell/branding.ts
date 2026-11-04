// Enterprise branding: the customer profile from /runtime-config.js
// (`window.__AGENT_RELAY_DASHBOARD_CONFIG__.customerProfile`, written by the
// image from DASHBOARD_CUSTOMER_PROFILE). No profile means today's Agent Relay
// look, and the hosted build has no runtime config at all, so it never
// changes. Every field is optional; invalid fields are ignored on their own.
import { z } from "zod";

export type Branding = {
  /** Shown in copy and as the logo's accessible name. */
  productName: string;
  /** The document title. */
  title: string;
  logo: { light: string; dark: string } | null;
  favicon: string | null;
  /** Links, focus rings, active navigation icons. */
  accentColor: string | null;
  /** The primary (solid) button. */
  brandColor: string | null;
  supportUrl: string | null;
  /** "Powered by Agent Relay" under a custom brand. */
  poweredBy: boolean;
  /** True when a customer profile is in effect. */
  custom: boolean;
};

export const DEFAULT_BRANDING: Branding = {
  productName: "Agent Relay",
  title: "Agent Relay · Dashboard",
  logo: null,
  favicon: null,
  accentColor: null,
  brandColor: null,
  supportUrl: null,
  poweredBy: false,
  custom: false,
};

// Colors are only ever written into CSS custom properties, so accept plain
// color syntax and nothing else (no `;`, `}`, url() or var()).
const COLOR =
  /^(#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|rgba|hsl|hsla|oklch|oklab)\((\s*[+-]?[0-9.]+(%|deg|turn|rad)?\s*[,/]?){3,4}\s*\))$/i;

/** Same-origin path, data: image, or an http(s) URL. */
function assetUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  // Embedded images may use most of the 64 KiB profile; links stay short.
  if (!text || text.length > 60_000) return null;
  if (/^data:image\/(png|svg\+xml|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon);/i.test(text))
    return text;
  if (text.length > 2048) return null;
  if (/^\/(?![/\\])/.test(text)) return text;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function linkUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^mailto:[^\s<>"]+@[^\s<>"]+$/i.test(text)) return text;
  const url = assetUrl(text);
  return url && !url.startsWith("data:") ? url : null;
}

const text = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(max))
    .optional()
    .catch(undefined);

const profileSchema = z
  .object({
    productName: text(80),
    title: text(120),
    logo: z
      .union([
        z.string(),
        z.object({ light: z.unknown().optional(), dark: z.unknown().optional() }),
      ])
      .optional()
      .catch(undefined),
    favicon: z.unknown().optional(),
    accentColor: z.unknown().optional(),
    brandColor: z.unknown().optional(),
    supportUrl: z.unknown().optional(),
    poweredByAgentRelay: z.boolean().optional().catch(undefined),
  })
  .passthrough();

/** A color the browser accepts; anything else keeps the default token. */
const color = (value: unknown) => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!COLOR.test(text)) return null;
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && !CSS.supports("color", text))
    return null;
  return text;
};

/** Dark text on a light brand color, white otherwise (hex and rgb() only). */
export function readableOn(colorValue: string): string {
  let rgb: number[] | null = null;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(colorValue)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  } else {
    const parts = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(colorValue);
    if (parts) rgb = parts.slice(1, 4).map(Number);
  }
  if (!rgb || rgb.some((n) => !Number.isFinite(n))) return "#ffffff";
  const [r, g, b] = rgb.map((n) => {
    const c = Math.min(255, n) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // White when it has the better contrast against the color.
  return (1.05 / (luminance + 0.05)) >= ((luminance + 0.05) / 0.05) ? "#ffffff" : "#111827";
}

/** Read a customer profile; anything unusable falls back to the default. */
export function parseBranding(raw: unknown): Branding {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_BRANDING;
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) return DEFAULT_BRANDING;
  const profile = parsed.data;
  const logo =
    typeof profile.logo === "string"
      ? { light: assetUrl(profile.logo), dark: assetUrl(profile.logo) }
      : profile.logo
        ? { light: assetUrl(profile.logo.light), dark: assetUrl(profile.logo.dark) }
        : null;
  const light = logo?.light ?? logo?.dark ?? null;
  const dark = logo?.dark ?? logo?.light ?? null;
  const productName = profile.productName ?? DEFAULT_BRANDING.productName;
  const branding: Branding = {
    productName,
    title: profile.title ?? (profile.productName ? productName : DEFAULT_BRANDING.title),
    logo: light && dark ? { light, dark } : null,
    favicon: assetUrl(profile.favicon),
    accentColor: color(profile.accentColor),
    brandColor: color(profile.brandColor),
    supportUrl: linkUrl(profile.supportUrl),
    poweredBy: false,
    custom: false,
  };
  branding.custom =
    branding.productName !== DEFAULT_BRANDING.productName ||
    branding.title !== DEFAULT_BRANDING.title ||
    !!(branding.logo || branding.favicon || branding.accentColor || branding.brandColor || branding.supportUrl);
  // Shown by default under a custom brand; the profile can turn it off.
  branding.poweredBy = branding.custom && profile.poweredByAgentRelay !== false;
  return branding;
}

let cached: Branding | null = null;

/** The branding for this page load (runtime config is fixed per load). */
export function branding(): Branding {
  if (!cached)
    cached = parseBranding(
      typeof window !== "undefined"
        ? (window.__AGENT_RELAY_DASHBOARD_CONFIG__ as { customerProfile?: unknown } | undefined)
            ?.customerProfile
        : undefined,
    );
  return cached;
}

/** Tests only: forget the cached profile. */
export function resetBrandingForTests() {
  cached = null;
}

/**
 * Apply the document-level parts: title, favicon and the color tokens.
 * Does nothing without a customer profile, so the default look is untouched.
 */
export function applyBranding(brand: Branding = branding()) {
  if (!brand.custom) return;
  document.documentElement.dataset.customerBrand = "";
  document.title = brand.title;
  if (brand.favicon) {
    const link =
      document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
      document.head.appendChild(Object.assign(document.createElement("link"), { rel: "icon" }));
    link.href = brand.favicon;
  }
  const rules: string[] = [];
  if (brand.accentColor)
    rules.push(
      `--primary: ${brand.accentColor} !important;`,
      `--ring: ${brand.accentColor} !important;`,
      `--sidebar-primary: ${brand.accentColor} !important;`,
      `--sidebar-ring: ${brand.accentColor} !important;`,
      `--status-info: ${brand.accentColor} !important;`,
      `--brand-primary: ${brand.accentColor} !important;`,
      `--nav-logo-mark: ${brand.accentColor} !important;`,
    );
  if (brand.brandColor)
    rules.push(
      `--brand-button: ${brand.brandColor} !important;`,
      `--brand-button-hover: color-mix(in srgb, ${brand.brandColor} 82%, white) !important;`,
      `--brand-button-border: color-mix(in srgb, ${brand.brandColor} 75%, black) !important;`,
      `--brand-button-fg: ${readableOn(brand.brandColor)} !important;`,
    );
  if (!rules.length) return;
  const style = document.createElement("style");
  style.dataset.customerBrand = "";
  // Declared on the shell and body too: the shell redefines these tokens.
  style.textContent = `:root[data-customer-brand], :root[data-customer-brand] body, :root[data-customer-brand] [data-workspace-shell] { ${rules.join(" ")} }`;
  document.head.appendChild(style);
}
