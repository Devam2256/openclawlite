// scraper.ts
import { Firecrawl } from "firecrawl";
import chalk from "chalk";
import { Platform, Product } from "./types.ts";
import { askClaude } from "../../ai/index.ts";

export async function scrapePlatforms(
  platforms: Platform[],
  query: string,
): Promise<Product[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.error(chalk.red("FIRECRAWL_API_KEY environment variable is not set."));
    return [];
  }

  const firecrawl = new Firecrawl({ apiKey });

  const productSchema = {
    type: "object",
    properties: {
      products: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name:     { type: "string", description: "The exact product title as shown on the page" },
            price:    { type: "number", description: "Final selling price in INR as a plain number, no symbols or commas. Use discounted price not MRP." },
            url:      { type: "string", description: "Full absolute URL to the product page starting with http/https" },
            imageUrl: { type: "string", description: "Main product image URL if available" },
          },
          required: ["name", "price", "url"],
        },
      },
    },
    required: ["products"],
  };

  const scrapePrompt = `You are extracting product data from an e-commerce search results page.
The user is searching for: "${query}"

CRITICAL PRICE INSTRUCTIONS:
- Extract ONLY the final checkout price — the price the customer actually pays
- This is usually the SMALLEST price shown (after discount)
- NEVER extract MRP, "was price", crossed-out price, or original price
- NEVER extract EMI amounts (e.g. "₹500/month" — ignore these completely)
- NEVER extract price ranges (e.g. "₹200 - ₹500") — skip that product entirely
- If you see "₹999" crossed out and "₹599" in bold — extract 599 only
- Price must be a plain number, no symbols, no commas (e.g. 599 not ₹599 or 5,99)
- If you cannot confidently identify the final price, DO NOT include that product
- Prices below ₹5 or above ₹500000 are almost certainly wrong — exclude them
- Prices that look like per-gram or per-ml pricing (e.g. 0.5, 1.2) — exclude them

PRODUCT MATCHING:
1. ONLY extract products that CLOSELY MATCH "${query}"
2. Extract up to 5 MOST RELEVANT matching products
3. Each product needs: exact name, confirmed final price, full absolute product URL
4. IGNORE ads, sponsored listings, "customers also bought", recommendations sections
5. If the page shows no results or is a login/captcha page, return empty products array`;

  const scrapePromises = platforms.map(async (platform) => {
    const searchUrl = platform.searchUrl + encodeURIComponent(query);
    try {
      console.log(chalk.dim(`  Searching ${platform.name}: ${searchUrl.slice(0, 80)}…`));

      const res = await firecrawl.scrape(searchUrl, {
        formats: [
          {
            type: "json",
            schema: productSchema,
            prompt: scrapePrompt,
          } as any,
        ],
        waitFor: 3000,
        onlyMainContent: true,
      } as any);

      if (!res) {
        throw new Error("No response from Firecrawl");
      }

      const extractData: any = (res as any).json;
      let rawProducts: any[] = [];

      if (extractData) {
        if (Array.isArray(extractData)) {
          rawProducts = extractData;
        } else if (extractData.products && Array.isArray(extractData.products)) {
          rawProducts = extractData.products;
        }
      }

      const products: Product[] = rawProducts
        .map((item: any) => ({
          name:     String(item.name || "").trim(),
          price:    Number(item.price || 0),
          currency: "INR",
          url:      String(item.url || searchUrl).trim(),
          platform: platform.name,
          imageUrl: item.imageUrl ? String(item.imageUrl).trim() : undefined,
        }))
        .filter((p) => {
          if (!p.name || !p.url.startsWith("http")) return false;
          if (p.price <= 5)     return false; // EMI or per-unit price
          if (p.price > 500000) return false; // clearly wrong
          if (p.name.length < 3) return false; // garbage name
          return true;
        });

      console.log(chalk.green(`  ✓ ${platform.name}: found ${products.length} product(s)`));
      return products;
    } catch (err: any) {
      console.error(chalk.red(`  ✗ ${platform.name}: ${err.message?.slice(0, 100)}`));
      return [] as Product[];
    }
  });

  const results = await Promise.allSettled(scrapePromises);
  const allProducts: Product[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allProducts.push(...result.value);
    }
  }

  return allProducts;
}

export async function filterRelevantProducts(
  products: Product[],
  query: string,
): Promise<Product[]> {
  if (products.length === 0) return [];
  if (products.length <= 3) return products;

  const productList = products
    .map((p, i) => `${i}: "${p.name}" — ₹${p.price} on ${p.platform}`)
    .join("\n");

  const prompt = `You are a product matching and price validation expert.
The user searched for: "${query}"

Here are the scraped products:
${productList}

Return ONLY the indices of products that:
1. GENUINELY MATCH what the user is searching for (not accessories, not unrelated items)
2. Have a REALISTIC price for that product

Price validation — REJECT if:
- Price is clearly an EMI amount (too low, e.g. phone for ₹200)
- Price makes no sense for the product (e.g. TV for ₹50, apple for ₹5000/kg)
- Price looks like a per-gram or per-ml value (e.g. 0.5, 1.2)

Product matching — REJECT if:
- Product is an accessory, case, cover, cable, charger (unless that's what was searched)
- Product is a completely different category
- Product name has nothing to do with "${query}"

KEEP if:
- Product matches the search query even if it's a different brand or variant
- Price is reasonable for that type of product in India

Respond with ONLY a JSON array of valid indices e.g.: [0, 2, 4]
No explanation, no markdown, no extra text.`;

  try {
    const response = await askClaude(prompt);
    let cleaned = response.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch?.[1]) cleaned = fenceMatch[1].trim();

    const indices: number[] = JSON.parse(cleaned);
    if (!Array.isArray(indices)) return products;

    const filtered = indices
      .filter((i) => i >= 0 && i < products.length)
      .map((i) => products[i]!);

    return filtered.length > 0 ? filtered : products;
  } catch (error) {
    console.error(chalk.dim("  Relevance filter failed, using all products"));
    return products;
  }
}
