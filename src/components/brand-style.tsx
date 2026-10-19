import { brandCss } from "@/lib/brand";

/** Applies a pharmacy's brand colour to the page (server component; nothing is rendered without a colour). */
export function BrandStyle({ color }: { color: string | null | undefined }) {
  const css = color ? brandCss(color) : null;
  return css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null;
}
