import type OpenAI from "openai";
import { Meal, CategorizedGroceries } from "../types";

const MODEL = "gpt-5.3-chat-latest";

async function callAI(
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
): Promise<OpenAI.Chat.ChatCompletion> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const error: any = new Error(err.error || `API request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

async function generateWithRetry(
  args: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  onProgress?: (msg: string) => void,
): Promise<OpenAI.Chat.ChatCompletion> {
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callAI(args);
    } catch (e: any) {
      const status = e?.status;
      if ((status === 503 || status === 429) && attempt < maxRetries) {
        const delay = (attempt + 1) * 3000;
        console.warn(`[AI] Retrying after ${status} (attempt ${attempt + 1}/${maxRetries})...`);
        onProgress?.("Server busy, retrying...");
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw new Error("Unreachable");
}

const stepsSchema = {
  type: "array" as const,
  items: {
    type: "object" as const,
    properties: {
      id: { type: "string" as const },
      instruction: { type: "string" as const, description: "The main action to take." },
      durationMinutes: {
        type: ["number", "null"] as const,
        description: "Duration of this step in minutes, if it involves waiting/cooking."
      },
      parallelTasks: {
        type: ["array", "null"] as const,
        items: { type: "string" as const },
        description: "Tasks to perform while this step's duration is elapsing."
      }
    },
    required: ["id", "instruction", "durationMinutes", "parallelTasks"] as const,
    additionalProperties: false as const,
  }
};

const ingredientSchema = {
  type: "object" as const,
  properties: {
    name: { type: "string" as const, description: "Ingredient name with quantity" },
    category: { type: "string" as const, description: "Produce, Meat, Dairy, Pantry, etc." },
    icon: { type: "string" as const, description: "A single emoji representing the ingredient" }
  },
  required: ["name", "category", "icon"] as const,
  additionalProperties: false as const,
};

const mealSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const },
    type: { type: "string" as const, description: "'breakfast' or 'dinner'" },
    prepStyle: { type: "string" as const, description: "'make-ahead', 'fresh', or 'batch'" },
    portions: { type: "number" as const, description: "Number of portions the recipe yields" },
    title: { type: "string" as const },
    description: { type: "string" as const },
    prepTime: { type: "number" as const, description: "Time in minutes" },
    cookTime: { type: "number" as const, description: "Time in minutes" },
    ingredients: {
      type: "array" as const,
      items: ingredientSchema,
      description: "List of ingredients with quantities, categories, and icons"
    },
    miseEnPlace: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Mise en place steps: what to wash, chop, measure, or prepare before starting to cook."
    },
    steps: stepsSchema,
  },
  required: ["id", "type", "prepStyle", "portions", "title", "description", "prepTime", "cookTime", "ingredients", "miseEnPlace", "steps"] as const,
  additionalProperties: false as const,
};

export async function generateMealPlan(favorites: Meal[] = [], currentMeals: Meal[] = []): Promise<Meal[]> {
  // Find which current meals are favorited
  let keptMeals = currentMeals.filter(m => favorites.some(f => f.title === m.title));

  // If we have no kept meals from the current plan, but we have favorites, randomly pick up to 2
  if (keptMeals.length === 0 && favorites.length > 0) {
    const shuffledFavs = [...favorites].sort(() => 0.5 - Math.random());
    let added = 0;
    for (const fav of shuffledFavs) {
      if (added >= 2) break;
      const batchDinners = keptMeals.filter(m => m.type === 'dinner' && m.prepStyle === 'batch').length;
      const makeAheadBreakfasts = keptMeals.filter(m => m.type === 'breakfast' && m.prepStyle === 'make-ahead').length;
      const freshBreakfasts = keptMeals.filter(m => m.type === 'breakfast' && m.prepStyle === 'fresh').length;

      if (fav.type === 'dinner' && fav.prepStyle === 'batch' && batchDinners < 2) {
        keptMeals.push(fav);
        added++;
      } else if (fav.type === 'breakfast' && fav.prepStyle === 'make-ahead' && makeAheadBreakfasts < 2) {
        keptMeals.push(fav);
        added++;
      } else if (fav.type === 'breakfast' && fav.prepStyle === 'fresh' && freshBreakfasts < 2) {
        keptMeals.push(fav);
        added++;
      }
    }
  }

  // Count how many of each type we already have
  let batchDinnersNeeded = 2 - keptMeals.filter(m => m.type === 'dinner' && m.prepStyle === 'batch').length;
  let makeAheadBreakfastsNeeded = 2 - keptMeals.filter(m => m.type === 'breakfast' && m.prepStyle === 'make-ahead').length;
  let freshBreakfastsNeeded = 2 - keptMeals.filter(m => m.type === 'breakfast' && m.prepStyle === 'fresh').length;

  batchDinnersNeeded = Math.max(0, batchDinnersNeeded);
  makeAheadBreakfastsNeeded = Math.max(0, makeAheadBreakfastsNeeded);
  freshBreakfastsNeeded = Math.max(0, freshBreakfastsNeeded);

  const totalNeeded = batchDinnersNeeded + makeAheadBreakfastsNeeded + freshBreakfastsNeeded;

  if (totalNeeded === 0) {
    return keptMeals;
  }

  const previousTitles = currentMeals.map(m => m.title).join(", ");

  let prompt = `Generate a meal plan for 2 people with a specific batch-cooking and creative breakfast routine.
Return EXACTLY ${totalNeeded} meals:
${batchDinnersNeeded > 0 ? `- ${batchDinnersNeeded} "Batch Dinners": Hearty, fridge-friendly meals (stews, curries, casseroles, hearty pastas) that yield 4-6 portions each and last for 2-3 days. Cook time can be 45-60 mins.\n` : ''}${makeAheadBreakfastsNeeded > 0 ? `- ${makeAheadBreakfastsNeeded} "Make-Ahead Breakfasts": Creative breakfasts prepared the night before (e.g., overnight oats with a twist, chia puddings, baked egg cups). Yield 2 portions.\n` : ''}${freshBreakfastsNeeded > 0 ? `- ${freshBreakfastsNeeded} "Fresh Breakfasts": Creative, interesting morning meals made fresh (e.g., savory scallion pancakes, Turkish eggs, unique omelets - NO classic plain pancakes). Yield 2 portions.\n` : ''}
For EACH recipe, also provide a highly optimized, parallelized step-by-step cooking guide. Identify steps that have a duration (like boiling, baking, simmering). For those steps, explicitly provide "parallelTasks" - what the user should do WHILE waiting for that step to finish (e.g., chopping veggies, setting the table).

IMPORTANT: Use metric units (grams, kilograms, milliliters, liters) for ingredients measured by weight or volume (e.g., "500g chicken", "200ml cream"). For naturally countable items, use natural units instead (e.g., "3 eggs", "2 avocados", "4 slices of bread", "1 can of tomatoes"). NEVER use cups, ounces, pounds, tablespoons, teaspoons, or fractions like "1/2 teaspoon". Convert small amounts to grams or milliliters (e.g., "2g cinnamon", "5ml vanilla extract", "3g salt").
Combine duplicate ingredients into a single entry with the total quantity (e.g., "83g flour" and "219g flour" must become "302g all-purpose flour").
List ingredients in order of importance: main proteins/carbs first, then vegetables/dairy, then spices/seasonings last.
${previousTitles ? `DO NOT generate any of these previous meals: ${previousTitles}. ` : ''}Be creative and varied!`;

  const response = await callAI({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "meal_plan",
        strict: true,
        schema: {
          type: "object",
          properties: {
            meals: {
              type: "array",
              items: mealSchema,
            }
          },
          required: ["meals"],
          additionalProperties: false,
        }
      }
    }
  });

  const text = response.choices[0].message.content;
  if (!text) {
    console.error("Empty response from AI", response);
    throw new Error("The AI returned an empty response. Please try again.");
  }

  try {
    const parsed = JSON.parse(text);
    return [...keptMeals, ...(parsed.meals || [])];
  } catch (e) {
    console.error("Failed to parse AI response:", text);
    throw new Error("The AI returned an invalid response format. Please try again.");
  }
}

export async function swapMeal(mealToSwap: Meal): Promise<Meal> {
  let replacementPrompt = `Suggest a new recipe to replace "${mealToSwap.title}".
Requirements:
- Type: ${mealToSwap.type}
- Prep Style: ${mealToSwap.prepStyle}
- Portions: ${mealToSwap.portions}
`;

  if (mealToSwap.type === 'dinner') {
    replacementPrompt += `- Must be a batch-cooking recipe (fridge-friendly, lasts 2-3 days, yields 4-6 portions). Cook time can be 45-60 mins.\n`;
  } else if (mealToSwap.type === 'breakfast' && mealToSwap.prepStyle === 'make-ahead') {
    replacementPrompt += `- Must be a creative breakfast prepared the night before (e.g., overnight oats with a twist, chia puddings, baked egg cups). Yield 2 portions.\n`;
  } else if (mealToSwap.type === 'breakfast' && mealToSwap.prepStyle === 'fresh') {
    replacementPrompt += `- Must be a creative breakfast made fresh in the morning (e.g., savory scallion pancakes, Turkish eggs, unique omelets - NO classic plain pancakes). Yield 2 portions.\n`;
  }

  replacementPrompt += `
For this recipe, also provide a highly optimized, parallelized step-by-step cooking guide. Identify steps that have a duration (like boiling, baking, simmering). For those steps, explicitly provide "parallelTasks" - what the user should do WHILE waiting for that step to finish (e.g., chopping veggies, setting the table).

IMPORTANT: Use metric units (grams, kilograms, milliliters, liters) for ingredients measured by weight or volume (e.g., "500g chicken", "200ml cream"). For naturally countable items, use natural units instead (e.g., "3 eggs", "2 avocados", "4 slices of bread", "1 can of tomatoes"). NEVER use cups, ounces, pounds, tablespoons, teaspoons, or fractions like "1/2 teaspoon". Convert small amounts to grams or milliliters (e.g., "2g cinnamon", "5ml vanilla extract", "3g salt").
Combine duplicate ingredients into a single entry with the total quantity (e.g., "83g flour" and "219g flour" must become "302g all-purpose flour").
List ingredients in order of importance: main proteins/carbs first, then vegetables/dairy, then spices/seasonings last.`;

  const response = await callAI({
    model: MODEL,
    messages: [{ role: "user", content: replacementPrompt }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "swap_meal",
        strict: true,
        schema: mealSchema,
      }
    }
  });

  return JSON.parse(response.choices[0].message.content || "{}");
}

export async function generateGroceryList(meals: Meal[]): Promise<CategorizedGroceries> {
  const allIngredients = meals.flatMap(m => (m.ingredients as any[]) || []).map((ing: any) => typeof ing === 'string' ? ing : ing.name).join("\\n");

  const response = await callAI({
    model: MODEL,
    messages: [{ role: "user", content: `Categorize the following ingredients into a standard grocery shopping list.\\n\\nIMPORTANT: You MUST combine and aggregate quantities for identical or similar ingredients. For example, if you see "200g chicken" and "300g chicken", combine them into "500g chicken". Similarly, if you see "2 eggs" and "3 eggs", combine them into "5 eggs". Do not output duplicate items. For each item, provide a fitting emoji icon.\\n\\nIngredients:\\n${allIngredients}` }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "grocery_list",
        strict: true,
        schema: {
          type: "object",
          properties: {
            categories: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string", description: "e.g., Produce, Meat, Dairy, Pantry" },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        icon: { type: "string", description: "A single emoji representing the item" }
                      },
                      required: ["name", "icon"],
                      additionalProperties: false,
                    }
                  }
                },
                required: ["category", "items"],
                additionalProperties: false,
              }
            }
          },
          required: ["categories"],
          additionalProperties: false,
        }
      }
    }
  });

  const text = response.choices[0].message.content;
  if (!text) {
    throw new Error("Empty response from AI");
  }

  const parsed = JSON.parse(text);
  const rawCategories: { category: string, items: { name: string, icon: string }[] }[] = parsed.categories || [];

  const categorized: CategorizedGroceries = {};
  for (const cat of rawCategories) {
    categorized[cat.category] = cat.items.map(i => ({ item: i.name, icon: i.icon, checked: false }));
  }

  return categorized;
}

export async function importRecipeFromUrl(url: string, onProgress?: (msg: string) => void): Promise<Meal> {
  // Step 1: Fetch URL content via server proxy
  onProgress?.("Fetching recipe from URL...");
  console.time('[import] Step 1: fetch URL');

  const proxyResponse = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}`);
  const proxyData = await proxyResponse.json();

  console.timeEnd('[import] Step 1: fetch URL');

  if (!proxyResponse.ok || proxyData.error) {
    throw new Error(`Could not fetch the recipe URL: ${proxyData.error || 'Unknown error'}. Please check the link and try again.`);
  }

  if (proxyData.status && proxyData.status >= 400) {
    if (proxyData.status === 403 || proxyData.status === 401) {
      throw new Error("Could not import recipe: the page is behind a paywall or requires authentication.");
    }
    throw new Error("Could not fetch the recipe URL. Please check the link and try again.");
  }

  const html: string = proxyData.html;
  if (!html || html.length < 100) {
    throw new Error("Could not extract recipe content from the URL. Please check the link and try again.");
  }

  // Extract og:image from HTML
  const ogImageMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i);
  const extractedImageUrl = ogImageMatch?.[1] || undefined;

  // Strip HTML to plain text
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, nav, header, footer').forEach(el => el.remove());
  const rawText = doc.body?.textContent || '';
  const recipeText = rawText.replace(/\s+/g, ' ').trim().slice(0, 15000);

  if (recipeText.length < 50) {
    throw new Error("Could not extract recipe content from the URL. The page may be dynamically loaded. Please try a different link.");
  }

  // Step 2: Structure the extracted text into the Meal JSON schema
  onProgress?.("Recipe found! Converting to metric and optimizing steps...");
  console.time('[import] Step 2: structure into JSON');

  const structureResponse = await generateWithRetry({
    model: MODEL,
    messages: [{ role: "user", content: `Convert the following recipe into the required JSON format.

Convert ingredients to metric units (grams, kilograms, milliliters, liters) for weight/volume items (e.g., "500g chicken", "200ml cream"). For naturally countable items, use natural units instead (e.g., "3 eggs", "2 avocados", "4 slices of bread", "1 can of tomatoes"). NEVER use cups, ounces, pounds, tablespoons, teaspoons, or fractions like "1/2 teaspoon". Convert small amounts to grams or milliliters (e.g., "2g cinnamon", "5ml vanilla extract", "3g salt").
Combine duplicate ingredients into a single entry with the total quantity (e.g., "83g flour" and "219g flour" must become "302g all-purpose flour").
List ingredients in order of importance: main proteins/carbs first, then vegetables/dairy, then spices/seasonings last.
Provide a highly optimized, parallelized step-by-step cooking guide. Identify steps that have a duration (like boiling, baking, simmering). For those steps, explicitly provide "parallelTasks" - what the user should do WHILE waiting for that step to finish.

CRITICAL:
1. Do not omit any ingredients or preparation steps found in the source.
2. Every ingredient listed in the "ingredients" section MUST be explicitly used or mentioned in at least one cooking step.
3. Preserve specific descriptors (e.g., "salted butter", "extra virgin olive oil") as they are important for the recipe's character.
4. If a step involves adding an ingredient, name that ingredient clearly in the instruction.

Classify the recipe into one of these types:
- type: 'breakfast' or 'dinner'
- prepStyle: 'make-ahead', 'fresh', or 'batch'
- portions: number of portions the recipe yields

Recipe:
${recipeText}` }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "import_recipe",
        strict: true,
        schema: mealSchema,
      }
    }
  }, onProgress);

  console.timeEnd('[import] Step 2: structure into JSON');

  const text = structureResponse.choices[0].message.content;
  if (!text) {
    throw new Error("Failed to structure the recipe. Please try again.");
  }

  console.log('[import] Step 2 response length:', text.length, 'chars');

  const meal = JSON.parse(text);
  if (extractedImageUrl) {
    meal.imageUrl = extractedImageUrl;
  }
  return meal;
}

export async function regenerateRecipeWithFeedback(meal: Meal, feedback: string): Promise<Meal> {
  const mealJson = JSON.stringify({
    title: meal.title,
    description: meal.description,
    type: meal.type,
    prepStyle: meal.prepStyle,
    portions: meal.portions,
    ingredients: meal.ingredients,
    steps: meal.steps,
    miseEnPlace: meal.miseEnPlace,
  });

  const response = await callAI({
    model: MODEL,
    messages: [{ role: "user", content: `Here is an existing recipe:\n${mealJson}\n\nThe user has this feedback: "${feedback}"\n\nRegenerate the recipe incorporating that feedback. Keep the same type (${meal.type}), prepStyle (${meal.prepStyle}), and portions (${meal.portions}). Preserve the recipe's identity where possible — only change what the feedback requires.\n\nFor this recipe, also provide a highly optimized, parallelized step-by-step cooking guide. Identify steps that have a duration (like boiling, baking, simmering). For those steps, explicitly provide "parallelTasks" - what the user should do WHILE waiting for that step to finish.\n\nIMPORTANT: Use metric units (grams, kilograms, milliliters, liters) for ingredients measured by weight or volume (e.g., "500g chicken", "200ml cream"). For naturally countable items, use natural units instead (e.g., "3 eggs", "2 avocados", "4 slices of bread", "1 can of tomatoes"). NEVER use cups, ounces, pounds, tablespoons, teaspoons, or fractions like "1/2 teaspoon". Convert small amounts to grams or milliliters (e.g., "2g cinnamon", "5ml vanilla extract", "3g salt").\nCombine duplicate ingredients into a single entry with the total quantity.\nList ingredients in order of importance: main proteins/carbs first, then vegetables/dairy, then spices/seasonings last.` }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "feedback_recipe",
        strict: true,
        schema: mealSchema,
      }
    }
  });

  return JSON.parse(response.choices[0].message.content || "{}");
}

export async function generateRecipeFromIngredients(ingredients: string[]): Promise<Meal> {
  const response = await callAI({
    model: MODEL,
    messages: [{ role: "user", content: `Suggest a dinner recipe for 2 people that uses some or all of the following ingredients: ${ingredients.join(', ')}. You can assume basic pantry staples (salt, pepper, oil, etc.) are available.

For this recipe, also provide a highly optimized, parallelized step-by-step cooking guide. Identify steps that have a duration (like boiling, baking, simmering). For those steps, explicitly provide "parallelTasks" - what the user should do WHILE waiting for that step to finish (e.g., chopping veggies, setting the table).

IMPORTANT: Use metric units (grams, kilograms, milliliters, liters) for ingredients measured by weight or volume (e.g., "500g chicken", "200ml cream"). For naturally countable items, use natural units instead (e.g., "3 eggs", "2 avocados", "4 slices of bread", "1 can of tomatoes"). NEVER use cups, ounces, pounds, tablespoons, teaspoons, or fractions like "1/2 teaspoon". Convert small amounts to grams or milliliters (e.g., "2g cinnamon", "5ml vanilla extract", "3g salt").
Combine duplicate ingredients into a single entry with the total quantity (e.g., "83g flour" and "219g flour" must become "302g all-purpose flour").
List ingredients in order of importance: main proteins/carbs first, then vegetables/dairy, then spices/seasonings last. Adjust portion sizes for exactly 2 people.` }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "pantry_recipe",
        strict: true,
        schema: mealSchema,
      }
    }
  });

  return JSON.parse(response.choices[0].message.content || "{}");
}
