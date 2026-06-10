import { askClaude } from "../../ai/index.ts";

export interface QueryAnalysis {
  isSpecific: boolean;
  questions?: string[];
  refinedQuery?: string;
}

/**
 * Analyzes a user's shopping query to determine if it's specific enough
 * to search directly, or if clarifying questions are needed.
 *
 * If the user types something like "Nike Air Max 90 White Size 10",
 * it's specific — go straight to search.
 *
 * If the user types "pillow" or "tshirt", it's vague — we need to ask
 * context-specific questions about brand, material, quality, etc.
 */
export async function analyzeQuery(query: string): Promise<QueryAnalysis> {
  const prompt = `You are a smart shopping assistant. Analyze this shopping query: "${query}"

Determine if the query is SPECIFIC enough to search for directly, or if it's VAGUE and needs clarifying questions.

A query is SPECIFIC if it includes:
- A clear product name with brand OR model OR specific variant
- Examples: "Apple iPhone 15 128GB", "Nike Air Max 90 White", "Samsung Galaxy S24 Ultra", "Levi's 501 Original Jeans 32W", "Sony WH-1000XM5 headphones"

A query is VAGUE if it's just a generic product type:
- Examples: "pillow", "tshirt", "headphones", "laptop", "shoes", "phone", "bag"

If the query is SPECIFIC, respond with EXACTLY this JSON (no markdown, no explanation):
{"isSpecific": true, "refinedQuery": "<the search-optimized version of their query>"}

If the query is VAGUE, generate 3-4 highly relevant, CONTEXT-SPECIFIC questions to narrow down what they want. The questions MUST be tailored to the product category:

For clothing (tshirt, jeans, etc.): ask about brand preference, fabric type (cotton/polyester/blend), fit (slim/regular/oversized), design/color, size
For electronics (phone, laptop, headphones): ask about brand, budget range, key features they need, specific use case
For home items (pillow, mattress, curtains): ask about material, size, firmness/quality level, brand preference
For footwear (shoes, sneakers): ask about brand, type (running/casual/formal), size, color preference
For beauty/personal care: ask about brand, skin/hair type, specific concerns, budget

IMPORTANT: Make the questions conversational and friendly, not robotic. Each question should help narrow down exactly what product they want.

Respond with EXACTLY this JSON (no markdown, no explanation):
{"isSpecific": false, "questions": ["question1", "question2", "question3"]}`;

  try {
    const response = await askClaude(prompt);
    let cleaned = response.trim();

    // Strip markdown fences if present
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch?.[1]) {
      cleaned = fenceMatch[1].trim();
    }

    const result = JSON.parse(cleaned);

    if (result.isSpecific) {
      return {
        isSpecific: true,
        refinedQuery: result.refinedQuery || query,
      };
    }

    if (Array.isArray(result.questions) && result.questions.length > 0) {
      return {
        isSpecific: false,
        questions: result.questions.slice(0, 4),
      };
    }

    // Fallback: treat as specific
    return { isSpecific: true, refinedQuery: query };
  } catch (error) {
    console.error("Error analyzing query, treating as specific:", error);
    return { isSpecific: true, refinedQuery: query };
  }
}

/**
 * Takes the user's original query and their answers to clarifying questions,
 * and builds a precise, search-optimized query string.
 */
export async function refineQuery(
  originalQuery: string,
  questions: string[],
  answers: string[],
): Promise<string> {
  const qaPairs = questions
    .map((q, i) => `Q: ${q}\nA: ${answers[i] || "not specified"}`)
    .join("\n\n");

  const prompt = `Based on the user's original shopping request and their answers to clarifying questions, construct a precise, search-optimized product query that would find exactly what they want on e-commerce sites.

Original request: "${originalQuery}"

Clarifying Q&A:
${qaPairs}

IMPORTANT: Return ONLY the optimized search query string. No quotes, no explanation, no markdown. Just the search terms that would find the exact product.
Example output: Nike Air Max 90 White Men Size 10
Example output: Memory Foam Pillow Medium Firmness Queen Size Sleepwell`;

  try {
    const response = await askClaude(prompt);
    const refined = response.trim().replace(/^["']|["']$/g, "");
    return refined || originalQuery;
  } catch (error) {
    console.error("Error refining query, using original:", error);
    return originalQuery;
  }
}

/**
 * Validates whether a product actually exists and is available for purchase online.
 * Returns whether it exists and a reason if not.
 */
export async function validateProductExists(
  query: string,
): Promise<{ exists: boolean; reason?: string }> {
  const prompt = `You are a product knowledge expert. Determine if the following product exists and is available for purchase online in India.

Product query: "${query}"

Consider:
- Is this a real product that exists in the market?
- Is it something that can actually be bought online?
- Don't reject generic categories (like "cotton pillow" or "running shoes") — those always exist
- Only reject things that are clearly non-existent, nonsensical, or not a real product

Respond with EXACTLY this JSON (no markdown, no explanation):
If it exists: {"exists": true}
If it doesn't: {"exists": false, "reason": "<brief explanation why this product doesn't exist>"}`;

  try {
    const response = await askClaude(prompt);
    let cleaned = response.trim();

    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch?.[1]) {
      cleaned = fenceMatch[1].trim();
    }

    const result = JSON.parse(cleaned);
    return {
      exists: result.exists !== false,
      reason: result.reason,
    };
  } catch (error) {
    console.error("Error validating product, assuming it exists:", error);
    return { exists: true };
  }
}
