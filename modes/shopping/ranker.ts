import { Product } from "./types.ts";

/**
 * Ranks products by lowest price first.
 * This is now the primary ranking strategy — the user wants
 * the top 5 cheapest options across platforms.
 *
 * Products are assumed to already be relevance-filtered by the
 * filterRelevantProducts() function in scraper.ts.
 */
export function rankByPrice(products: Product[]): Product[] {
  if (products.length === 0) return [];

  // Deduplicate: if the same product appears on the same platform
  // at the same price, keep only one
  const seen = new Set<string>();
  const unique = products.filter((p) => {
    const key = `${p.platform}:${p.price}:${p.name.toLowerCase().slice(0, 30)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by price ascending (cheapest first)
  return unique.sort((a, b) => a.price - b.price).slice(0, 5);
}
