// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
/** Only inline raster copies captured in history; never fetch transcript URLs. */
export function sessionImage(content: string | null): string | null {
  if (!content || content.length > 1_398_200) return null;
  return /^!\[Attached image\]\((data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2})\)$/.exec(content)?.[1] ?? null;
}
