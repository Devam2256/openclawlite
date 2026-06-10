import chalk from "chalk";
import { text, isCancel } from "@clack/prompts";
import { detectCategory, PLATFORMS } from "./platforms.ts";
import { scrapePlatforms, filterRelevantProducts } from "./scraper.ts";
import { rankByPrice } from "./ranker.ts";
import { analyzeQuery, refineQuery, validateProductExists } from "./questioner.ts";
import { validateQuery } from "./index.ts";

/**
 * Returns a beautiful brand-colorized string for known platform names.
 */
function getColoredPlatformLabel(platform: string): string {
  switch (platform.toLowerCase()) {
    case "amazon":
      return chalk.hex("#FF9900").bold(platform);
    case "flipkart":
      return chalk.hex("#2874F0").bold(platform);
    case "myntra":
      return chalk.hex("#FF3F6C").bold(platform);
    case "ajio":
      return chalk.hex("#1A2D4C").bold(platform);
    case "meesho":
      return chalk.hex("#F43397").bold(platform);
    case "nykaa":
    case "nykaa fashion":
      return chalk.hex("#FC2779").bold(platform);
    case "blinkit":
      return chalk.black.bgYellow.bold(` ${platform} `);
    case "zepto":
      return chalk.hex("#4A0D8A").bold(platform);
    case "swiggy":
    case "swiggy instamart":
      return chalk.hex("#FC8019").bold(platform);
    case "zomato":
      return chalk.hex("#CB202D").bold(platform);
    case "bigbasket":
      return chalk.hex("#84C225").bold(platform);
    case "jiomart":
      return chalk.hex("#00539C").bold(platform);
    case "croma":
      return chalk.hex("#00E6B0").bold(platform);
    case "reliance digital":
      return chalk.hex("#E21D24").bold(platform);
    case "ikea":
      return chalk.hex("#FFDA1A").bgBlue.bold(` ${platform} `);
    default:
      return chalk.bold.white(platform);
  }
}

/**
 * CLI-based shopping mode — interactive terminal experience.
 * Asks questions if query is vague, then searches and shows top 5 cheapest.
 */
export async function runShoppingMode(): Promise<void> {
  console.log(
    chalk.green(
      `\n═══════════════════════════════════════════════\n` +
      `  🛍️  ${chalk.bold("SHOPPING MODE")} — Real-time price comparison\n` +
      `═══════════════════════════════════════════════\n`
    )
  );

  const queryInput = await text({
    message: "What do you want to search for?",
    placeholder: "e.g. Nike Air Max 90, pillow, wireless headphones…",
  });

  if (isCancel(queryInput) || !queryInput.trim()) {
    console.log(chalk.dim("\nSearch cancelled.\n"));
    return;
  }

  let searchQuery = queryInput.trim();

  console.log(chalk.dim("\n🧠 Analyzing your request…\n"));

  // Step 1: Pre-validate query (match Telegram behavior)
  const validation = await validateQuery(searchQuery);

  if (!validation.valid) {
    console.log();
    switch (validation.reason) {
      case "empty":
      case "too_short":
        console.log(
          chalk.red("❌ Please enter a product name to search for.\n") +
          chalk.dim("   Example: Nike Air Max 90\n")
        );
        return;

      case "too_long":
        console.log(
          chalk.red("❌ Your query is too long.\n") +
          chalk.dim("   Please keep it under 300 characters and focus on the product name.\n")
        );
        return;

      case "gibberish":
        console.log(
          chalk.red("❌ That doesn't look like a valid product name.\n") +
          chalk.dim("   Please enter a real product name, e.g. blue jeans or protein powder.\n")
        );
        return;

      case "not_a_product":
        console.log(
          chalk.red(`❌ "${searchQuery}" doesn't seem to be a product I can search for.\n`) +
          chalk.dim("   I can help you find physical products like electronics, groceries, clothes, beauty products, etc.\n   Try: wireless earbuds\n")
        );
        return;

      case "offensive":
        console.log(
          chalk.red("❌ I can't search for that. Please search for legitimate products.\n")
        );
        return;

      case "non_shopping":
        console.log(
          chalk.yellow("👋 Looks like that's not a shopping query.\n") +
          chalk.dim("   Please search for products you want to buy, e.g. face moisturizer.\n")
        );
        return;

      case "too_vague_no_category":
        console.log(
          chalk.yellow(`❓ "${searchQuery}" is quite vague.\n`) +
          chalk.dim("   Could you be more specific? E.g., try 'wireless bluetooth speaker' or 'cotton t-shirt'.\n")
        );
        return;

      default:
        console.log(
          chalk.red("❌ I couldn't understand that query. Please try again with a specific product name.\n")
        );
        return;
    }
  }

  // Edge case: multiple products detected
  if (validation.reason === "multiple_products" && validation.products && validation.products.length > 1) {
    console.log(
      chalk.yellow("\n🛍️  I noticed you mentioned multiple products. Please search for them one at a time:\n")
    );
    for (const p of validation.products) {
      console.log(chalk.cyan(`  • ${p}`));
    }
    console.log();
    return;
  }

  // Use sanitized query from here on
  searchQuery = validation.sanitized || searchQuery;

  // Step 2: Analyze if query is specific or vague
  const analysis = await analyzeQuery(searchQuery);

  if (!analysis.isSpecific && analysis.questions && analysis.questions.length > 0) {
    console.log(
      chalk.cyan(
        `I need a few details to find the best "${searchQuery}" for you:\n`,
      ),
    );

    const answers: string[] = [];
    const totalQ = analysis.questions.length;

    for (let i = 0; i < totalQ; i++) {
      const answer = await text({
        message: chalk.cyan(`[Question ${i + 1}/${totalQ}] `) + chalk.bold(analysis.questions[i]),
        placeholder: "Type your answer...",
      });

      if (isCancel(answer)) {
        console.log(chalk.dim("\nSearch cancelled.\n"));
        return;
      }

      answers.push(answer.trim());
    }

    console.log(chalk.dim("\n✅ Building your search query…\n"));
    searchQuery = await refineQuery(searchQuery, analysis.questions, answers);
    console.log(chalk.dim(`Refined query: "${searchQuery}"\n`));
  } else if (analysis.refinedQuery) {
    searchQuery = analysis.refinedQuery;
  }

  // Step 3: Validate product exists
  console.log(chalk.dim("🔎 Verifying product exists online…\n"));
  const productValidation = await validateProductExists(searchQuery);

  if (!productValidation.exists) {
    console.log(
      chalk.red(
        `\n❌ "${searchQuery}" doesn't appear to exist as a purchasable product.\n${productValidation.reason || "Please check the spelling and try again."}\n`,
      ),
    );
    return;
  }

  // Step 4: Detect category and scrape
  console.log(chalk.dim("🔍 Searching across platforms for the best prices…\n"));
  const category = await detectCategory(searchQuery);
  const platforms = PLATFORMS[category] || PLATFORMS.general || [];
  const rawProducts = await scrapePlatforms(platforms, searchQuery);

  if (rawProducts.length === 0) {
    console.log(
      chalk.yellow(
        `\n😕 Couldn't find "${searchQuery}" on any platform right now.\n`,
      ),
    );
    return;
  }

  // Step 5: AI relevance filter
  const relevantProducts = await filterRelevantProducts(rawProducts, searchQuery);

  if (relevantProducts.length === 0) {
    console.log(
      chalk.yellow(
        `\n😕 Found results but none closely matched "${searchQuery}".\n`,
      ),
    );
    return;
  }

  // Step 6: Rank by price
  const top5 = rankByPrice(relevantProducts);

  // Step 7: Display results
  console.log(
    chalk.bold.cyan(
      `\n🛒 Top ${top5.length} Cheapest Prices for: "${searchQuery}"\n`,
    ),
  );

  const medals = ["1️⃣ ", "2️⃣ ", "3️⃣ ", "4️⃣ ", "5️⃣ "];

  for (let i = 0; i < top5.length; i++) {
    const p = top5[i]!;
    const name = p.name.length > 70 ? p.name.substring(0, 70) + "…" : p.name;
    const platformLabel = getColoredPlatformLabel(p.platform);

    console.log(
      `${medals[i]}${platformLabel} — ${chalk.green.bold(`₹${p.price.toLocaleString("en-IN")}`)}`
    );
    console.log(chalk.dim(`   ${name}`));
    console.log(chalk.blue(`   🔗 ${p.url}`));
    console.log();
  }

  console.log(
    chalk.dim("💡 Click a link above to purchase on that platform.\n"),
  );
}
