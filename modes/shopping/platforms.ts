import { Platform } from "./types.ts";
import { askClaude } from "../../ai/index.ts";

export const PLATFORMS: Record<string, Platform[]> = {
  grocery: [
    { name: "Blinkit",          searchUrl: "https://blinkit.com/s/?q=",                          category: ["grocery"] },
    { name: "Zepto",            searchUrl: "https://www.zeptonow.com/search?query=",              category: ["grocery"] },
    { name: "Swiggy Instamart", searchUrl: "https://www.swiggy.com/instamart/search?query=",     category: ["grocery"] },
    { name: "BigBasket",        searchUrl: "https://www.bigbasket.com/ps/?q=",                   category: ["grocery"] },
    { name: "JioMart",          searchUrl: "https://www.jiomart.com/search/",                    category: ["grocery"] },
    { name: "Flipkart",         searchUrl: "https://www.flipkart.com/search?q=",                 category: ["grocery"] },
  ],
  food: [
    { name: "Swiggy",           searchUrl: "https://www.swiggy.com/search?query=",               category: ["food"] },
    { name: "Zomato",           searchUrl: "https://www.zomato.com/search?q=",                   category: ["food"] },
    { name: "Blinkit",          searchUrl: "https://blinkit.com/s/?q=",                          category: ["food"] },
    { name: "Zepto",            searchUrl: "https://www.zeptonow.com/search?query=",             category: ["food"] },
    { name: "Swiggy Instamart", searchUrl: "https://www.swiggy.com/instamart/search?query=",    category: ["food"] },
    { name: "Magicpin",         searchUrl: "https://magicpin.in/search/?query=",                 category: ["food"] },
  ],
  electronics: [
    { name: "Amazon",           searchUrl: "https://www.amazon.in/s?k=",                         category: ["electronics"] },
    { name: "Flipkart",         searchUrl: "https://www.flipkart.com/search?q=",                 category: ["electronics"] },
    { name: "Croma",            searchUrl: "https://www.croma.com/searchB?q=",                   category: ["electronics"] },
    { name: "Vijay Sales",      searchUrl: "https://www.vijaysales.com/search/",                 category: ["electronics"] },
    { name: "Reliance Digital", searchUrl: "https://www.reliancedigital.in/search?q=",           category: ["electronics"] },
  ],
  fashion: [
    { name: "Myntra",           searchUrl: "https://www.myntra.com/",                            category: ["fashion"] },
    { name: "Ajio",             searchUrl: "https://www.ajio.com/search/?text=",                 category: ["fashion"] },
    { name: "Nykaa Fashion",    searchUrl: "https://www.nykaafashion.com/search/result/?q=",     category: ["fashion"] },
    { name: "Meesho",           searchUrl: "https://www.meesho.com/search?q=",                   category: ["fashion"] },
    { name: "Flipkart",         searchUrl: "https://www.flipkart.com/search?q=",                 category: ["fashion"] },
    { name: "Amazon",           searchUrl: "https://www.amazon.in/s?k=",                         category: ["fashion"] },
  ],
  home: [
    { name: "Amazon",           searchUrl: "https://www.amazon.in/s?k=",                         category: ["home"] },
    { name: "Flipkart",         searchUrl: "https://www.flipkart.com/search?q=",                 category: ["home"] },
    { name: "Pepperfry",        searchUrl: "https://www.pepperfry.com/site-search.html#q=",      category: ["home"] },
    { name: "Ikea",             searchUrl: "https://www.ikea.com/in/en/search/?q=",              category: ["home"] },
    { name: "Wooden Street",    searchUrl: "https://www.woodenstreet.com/search?q=",             category: ["home"] },
  ],
  beauty: [
    { name: "Nykaa",            searchUrl: "https://www.nykaa.com/search/result/?q=",            category: ["beauty"] },
    { name: "The Minimalist",   searchUrl: "https://www.theminimalist.in/search?q=",             category: ["beauty"] },
    { name: "Purplle",          searchUrl: "https://www.purplle.com/search?q=",                  category: ["beauty"] },
    { name: "MyGlamm",          searchUrl: "https://www.myglamm.com/search?q=",                  category: ["beauty"] },
    { name: "Plum Goodness",    searchUrl: "https://plumgoodness.com/search?q=",                 category: ["beauty"] },
    { name: "Dot & Key",        searchUrl: "https://www.dotandkey.com/search?q=",                category: ["beauty"] },
    { name: "Mamaearth",        searchUrl: "https://mamaearth.in/search?q=",                     category: ["beauty"] },
    { name: "Blinkit",          searchUrl: "https://blinkit.com/s/?q=",                          category: ["beauty"] },
    { name: "Zepto",            searchUrl: "https://www.zeptonow.com/search?query=",             category: ["beauty"] },
    { name: "Flipkart",         searchUrl: "https://www.flipkart.com/search?q=",                 category: ["beauty"] },
    { name: "Amazon",           searchUrl: "https://www.amazon.in/s?k=",                         category: ["beauty"] },
  ],
  general: [
    { name: "Amazon",           searchUrl: "https://www.amazon.in/s?k=",                         category: ["general"] },
    { name: "Flipkart",         searchUrl: "https://www.flipkart.com/search?q=",                 category: ["general"] },
    { name: "Blinkit",          searchUrl: "https://blinkit.com/s/?q=",                          category: ["general"] },
    { name: "Zepto",            searchUrl: "https://www.zeptonow.com/search?query=",             category: ["general"] },
    { name: "Swiggy Instamart", searchUrl: "https://www.swiggy.com/instamart/search?query=",    category: ["general"] },
    { name: "Nykaa",            searchUrl: "https://www.nykaa.com/search/result/?q=",            category: ["general"] },
    { name: "Meesho",           searchUrl: "https://www.meesho.com/search?q=",                   category: ["general"] },
    { name: "Snapdeal",         searchUrl: "https://www.snapdeal.com/search?keyword=",           category: ["general"] },
  ],
};

export async function detectCategory(query: string): Promise<string> {
  const prompt = `You are an AI assistant classifying a shopping search query.
Analyze the following user query: "${query}"
Determine which shopping category it belongs to. You MUST respond with ONLY one word from this exact list:
- grocery (for raw ingredients, vegetables, fruits, packaged food, dairy)
- food (for cooked/restaurant food, meals, dishes, cuisines, fast food, desserts, anything to eat that is prepared/delivered from a restaurant)
- electronics (for gadgets, phones, laptops, appliances)
- fashion (for clothing, shoes, accessories, bags)
- home (for furniture, decor, kitchen, bedding)
- beauty (for skincare, haircare, makeup, personal care, grooming, fragrances)
- general (if none of the above fit clearly)

Do not include punctuation, explanation, markdown, or spaces. One word only.`;

  try {
    const response = await askClaude(prompt);
    const cleaned = response.trim().toLowerCase();

    if (["grocery", "food", "electronics", "fashion", "home", "beauty", "general"].includes(cleaned)) {
      return cleaned;
    }
    return "general";
  } catch (error) {
    console.error("Error detecting category, falling back to general:", error);
    return "general";
  }
}
