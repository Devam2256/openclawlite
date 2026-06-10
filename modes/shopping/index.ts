// index.ts (shopping mode)
import chalk from "chalk";
import { detectCategory, PLATFORMS } from "./platforms.ts";
import { scrapePlatforms, filterRelevantProducts } from "./scraper.ts";
import { rankByPrice } from "./ranker.ts";
import { analyzeQuery, refineQuery, validateProductExists } from "./questioner.ts";
import {
  getQuestionSession,
  setQuestionSession,
  deleteQuestionSession,
  hasQuestionSession,
  setSession,
  deleteSession,
  hasSession,
  getSession,
} from "./session.ts";
import { QuestionSession, ShoppingSession } from "./types.ts";
import { askClaude } from "../../ai/index.ts";

export { hasQuestionSession } from "./session.ts";

// ─── Query Pre-validation ─────────────────────────────────────────────────────

export interface QueryValidation {
  valid: boolean;
  reason?: string;
  sanitized?: string;
  products?: string[]; // if multiple products detected
}

/**
 * Validates and sanitizes the raw query before any search happens.
 * Catches: empty, too short, gibberish, multiple products, offensive, non-product queries.
 */
export async function validateQuery(raw: string): Promise<QueryValidation> {
  // 1. Basic checks before hitting Claude
  if (!raw || raw.trim().length === 0) {
    return { valid: false, reason: "empty" };
  }

  const trimmed = raw.trim();

  if (trimmed.length < 2) {
    return { valid: false, reason: "too_short" };
  }

  if (trimmed.length > 300) {
    return { valid: false, reason: "too_long" };
  }

  // 2. Gibberish check — if more than 40% chars are non-alphanumeric/space it's likely garbage
  const nonAlpha = (trimmed.match(/[^a-zA-Z0-9\s₹\-\.]/g) || []).length;
  if (nonAlpha / trimmed.length > 0.4) {
    return { valid: false, reason: "gibberish" };
  }

  // 3. Ask Claude to validate deeply
  const prompt = `You are a shopping query validator. Analyze this user query: "${trimmed}"

Respond with ONLY a JSON object in this exact format:
{
  "valid": true/false,
  "reason": "one of: ok | gibberish | not_a_product | multiple_products | offensive | too_vague_no_category | non_shopping",
  "sanitized": "cleaned up version of the query if valid, else null",
  "products": ["product1", "product2"] // only if multiple_products detected, else null
}

Rules:
- valid=true only if it's a single, real, searchable product or product category
- "not_a_product": query is a concept, place, person, question, or non-buyable thing (e.g. "love", "Delhi", "how are you", "what is AI")
- "multiple_products": user listed 2+ distinct products (e.g. "shoes and a laptop", "rice and dal and oil")
- "gibberish": random characters, keyboard mashing, meaningless text
- "offensive": contains hate speech, illegal items, adult content
- "non_shopping": greeting, question, command not related to buying (e.g. "hello", "thanks", "cancel")
- "too_vague_no_category": single word that could mean anything (e.g. just "thing", "item", "stuff")
- sanitized: fix typos, remove filler words like "I want to buy", "search for", "find me", "get me", keep the actual product name
- If multiple products: list each as a separate string in products array

No markdown, no explanation, only the JSON object.`;

  try {
    const response = await askClaude(prompt);
    let cleaned = response.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch?.[1]) cleaned = fenceMatch[1].trim();

    const parsed = JSON.parse(cleaned);
    return {
      valid: parsed.valid === true,
      reason: parsed.reason,
      sanitized: parsed.sanitized || trimmed,
      products: parsed.products || undefined,
    };
  } catch {
    // If Claude fails, fall through with sanitized query
    return { valid: true, sanitized: trimmed };
  }
}

// ─── Main Command Handler ─────────────────────────────────────────────────────

export async function handleShoppingCommand(ctx: any): Promise<void> {
  const chatId = ctx.chat.id;
  const fullText = ctx.message.text || "";
  const raw = fullText.replace(/^\/shopping\s*/i, "").trim();

  try {
    // Edge case: no query provided
    if (!raw) {
      await ctx.reply(
        "🛍️ *What would you like to search for?*\n\nExamples:\n• `/shopping Nike Air Max 90`\n• `/shopping pillow`\n• `/shopping iPhone 15 Pro`",
        { parse_mode: "Markdown" },
      );
      return;
    }

    await ctx.reply("🧠 Analyzing your request...");

    // Step 1: Validate the query
    const validation = await validateQuery(raw);

    // Handle invalid queries
    if (!validation.valid) {
      switch (validation.reason) {
        case "empty":
        case "too_short":
          await ctx.reply(
            "❌ Please enter a product name to search for.\n\nExample: `/shopping running shoes`",
            { parse_mode: "Markdown" },
          );
          return;

        case "too_long":
          await ctx.reply(
            "❌ Your query is too long. Please keep it under 300 characters and focus on the product name.",
          );
          return;

        case "gibberish":
          await ctx.reply(
            "❌ That doesn't look like a product name. Please enter something like:\n• `/shopping blue jeans`\n• `/shopping protein powder`",
            { parse_mode: "Markdown" },
          );
          return;

        case "not_a_product":
          await ctx.reply(
            `❌ *"${raw}"* doesn't seem to be a product I can search for.\n\nI can help you find physical products like electronics, groceries, clothes, beauty products, and more.\n\nTry: \`/shopping wireless earbuds\``,
            { parse_mode: "Markdown" },
          );
          return;

        case "offensive":
          await ctx.reply(
            "❌ I can't search for that. Please search for legitimate products.",
          );
          return;

        case "non_shopping":
          await ctx.reply(
            "👋 Looks like that's not a shopping query. Use `/shopping <product name>` to search for products.\n\nExample: `/shopping face moisturizer`",
            { parse_mode: "Markdown" },
          );
          return;

        case "too_vague_no_category":
          await ctx.reply(
            `❓ *"${raw}"* is quite vague. Could you be more specific?\n\nFor example instead of just "thing", try "wireless bluetooth speaker" or "cotton t-shirt".`,
            { parse_mode: "Markdown" },
          );
          return;

        default:
          await ctx.reply(
            "❌ I couldn't understand that query. Please try again with a specific product name.",
          );
          return;
      }
    }

    // Edge case: multiple products detected
    if (validation.reason === "multiple_products" && validation.products && validation.products.length > 1) {
      const productList = validation.products
        .map((p, i) => `${i + 1}. \`/shopping ${p}\``)
        .join("\n");

      await ctx.reply(
        `🛍️ I noticed you mentioned multiple products. Please search for them one at a time:\n\n${productList}`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // Use sanitized query from here on
    const query = validation.sanitized || raw;

    // Log if query was cleaned up
    if (query !== raw) {
      console.log(chalk.dim(`Query sanitized: "${raw}" → "${query}"`));
    }

    // Step 2: Analyze if query needs clarification
    const analysis = await analyzeQuery(query);

    if (analysis.isSpecific) {
      await performSearch(ctx, chatId, query);
    } else {
      const questions = analysis.questions || [];
      if (questions.length === 0) {
        await performSearch(ctx, chatId, query);
        return;
      }

      const questionSession: QuestionSession = {
        chatId,
        originalQuery: query,
        questions,
        answers: [],
        currentQuestionIndex: 0,
        createdAt: new Date(),
      };

      setQuestionSession(chatId, questionSession);

      await ctx.reply(
        `🤔 I need a few details to find the best *"${query}"* for you.\n\n*Question 1/${questions.length}:*\n${questions[0]}`,
        { parse_mode: "Markdown" },
      );
    }
  } catch (err: any) {
    console.error(chalk.red(`Error in /shopping command: ${err.message}`));
    await ctx.reply("❌ Something went wrong. Please try again in a moment.");
  }
}

// ─── Question Reply Handler ───────────────────────────────────────────────────

export async function handleQuestionReply(ctx: any): Promise<void> {
  const chatId = ctx.chat.id;
  const text = (ctx.message.text || "").trim();
  const session = getQuestionSession(chatId);

  if (!session) return;

  if (text.toLowerCase() === "/cancel" || text.toLowerCase() === "cancel") {
    deleteQuestionSession(chatId);
    await ctx.reply("❌ Shopping search cancelled.");
    return;
  }

  // Edge case: empty reply
  if (!text) {
    const qNum = session.currentQuestionIndex + 1;
    await ctx.reply(
      `Please answer Question ${qNum}:\n${session.questions[session.currentQuestionIndex]}`,
    );
    return;
  }

  // Edge case: reply is another command
  if (text.startsWith("/") && !text.startsWith("/cancel")) {
    await ctx.reply(
      "⚠️ You have an active shopping search. Please answer the current question or type /cancel to exit.",
    );
    return;
  }

  session.answers.push(text);
  session.currentQuestionIndex++;

  if (session.currentQuestionIndex < session.questions.length) {
    const nextQ = session.questions[session.currentQuestionIndex];
    const qNum = session.currentQuestionIndex + 1;
    const total = session.questions.length;

    await ctx.reply(
      `*Question ${qNum}/${total}:*\n${nextQ}`,
      { parse_mode: "Markdown" },
    );
  } else {
    deleteQuestionSession(chatId);
    await ctx.reply("✅ Got it! Searching now...");

    const refinedSearchQuery = await refineQuery(
      session.originalQuery,
      session.questions,
      session.answers,
    );

    console.log(chalk.dim(`Refined: "${session.originalQuery}" → "${refinedSearchQuery}"`));
    await performSearch(ctx, chatId, refinedSearchQuery);
  }
}

// ─── Core Search ─────────────────────────────────────────────────────────────

async function performSearch(
  ctx: any,
  chatId: number,
  query: string,
): Promise<void> {
  try {
    console.log(`\n=== SEARCH START: "${query}" ===`);

    // Step 1: Validate product exists online
    await ctx.reply(`🔎 Verifying *"${query}"* exists online...`, {
      parse_mode: "Markdown",
    });

    console.log("A: validateProductExists start");
    const validation = await validateProductExists(query);
    console.log("A: validateProductExists end");

    if (!validation.exists) {
      await ctx.reply(
        `❌ *"${query}"* doesn't appear to exist as a purchasable product.\n\n${validation.reason || "It may be misspelled or not available online in India."}\n\nPlease check the spelling and try again.`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // Step 2: Detect category
    await ctx.reply(`🔍 Searching across platforms for the best prices...`);

    console.log("B: detectCategory start");
    const category = await detectCategory(query);
    console.log("B: detectCategory end");

    console.log(chalk.dim(`Category detected: ${category} for "${query}"`));

    // Step 3: Scrape platforms
    const platforms = PLATFORMS[category] || PLATFORMS.general || [];

    if (platforms.length === 0) {
      await ctx.reply(
        "❌ No platforms configured for this product category. Please try again.",
      );
      return;
    }

    console.log("C: scrapePlatforms start");
    const rawProducts = await scrapePlatforms(platforms, query);
    console.log("C: scrapePlatforms end");
    console.log(`C: Products found = ${rawProducts.length}`);

    if (rawProducts.length === 0) {
      await ctx.reply(
        `😕 Couldn't find *"${query}"* on any platform right now.\n\nThis could be because:\n• The product is temporarily unavailable\n• Platforms are blocking automated searches\n• Try a slightly different product name\n\nPlease try again in a few minutes.`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // Step 4: AI relevance + price filter
    console.log("D: filterRelevantProducts start");
    const relevantProducts = await filterRelevantProducts(
      rawProducts,
      query,
    );
    console.log("D: filterRelevantProducts end");
    console.log(`D: Relevant products = ${relevantProducts.length}`);

    if (relevantProducts.length === 0) {
      await ctx.reply(
        `😕 Found ${rawProducts.length} result(s) but none closely matched *"${query}"* with valid prices.\n\nTry a more specific product name or brand.`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // Step 5: Rank by price
    console.log("E: rankByPrice start");
    const top5 = rankByPrice(relevantProducts);
    console.log("E: rankByPrice end");
    console.log(`E: Top products = ${top5.length}`);

    if (top5.length === 1) {
      const p = top5[0]!;

      const msg =
        `🛒 Found *1 result* for *"${query}"*:\n\n` +
        `*${p.platform}* — ₹${p.price.toLocaleString("en-IN")}\n` +
        `${p.name.slice(0, 60)}\n` +
        `🔗 [Buy here](${p.url})\n\n` +
        `⚠️ _Only 1 platform had this product. Prices may vary — verify before purchasing._`;

      console.log("F: sending single-result reply");

      await ctx.reply(msg, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      });

      console.log("F: single-result reply sent");
      return;
    }

    // Step 6: Format results
    console.log("G: building response message");

    let msg = `🛒 *Top ${top5.length} Cheapest Prices for:*\n_"${query}"_\n\n`;

    for (let i = 0; i < top5.length; i++) {
      const p = top5[i]!;
      const name =
        p.name.length > 50
          ? p.name.substring(0, 50) + "…"
          : p.name;

      msg += `${["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"][i]} *${p.platform}* — ₹${p.price.toLocaleString("en-IN")}\n`;
      msg += `   ${name}\n`;
      msg += `   🔗 [Buy here](${p.url})\n\n`;
    }

    msg += `⚠️ _Prices are scraped in real-time and may vary. Always verify on the platform before purchasing._`;

    // Save session
    const session: ShoppingSession = {
      chatId,
      query,
      category,
      results: relevantProducts,
      top5,
      createdAt: new Date(),
      status: "done",
    };

    setSession(chatId, session);

    console.log("H: sending final Telegram reply");

    await ctx.reply(msg, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });

    console.log("H: final Telegram reply sent");
    console.log("=== SEARCH COMPLETE ===\n");
  } catch (err: any) {
    console.error(chalk.red(`Error in performSearch: ${err.message}`));
    console.error(err);

    if (
      err.message?.includes("timeout") ||
      err.message?.includes("ETIMEDOUT")
    ) {
      await ctx.reply(
        "⏱️ The search timed out. Platforms may be slow right now. Please try again in a moment.",
      );
      return;
    }

    if (
      err.message?.includes("429") ||
      err.message?.includes("rate limit")
    ) {
      await ctx.reply(
        "⚠️ Too many searches at once. Please wait 30 seconds and try again.",
      );
      return;
    }

    await ctx.reply(
      "❌ Something went wrong during search. Please try again.",
    );
  }
}
