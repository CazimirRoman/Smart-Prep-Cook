import { GoogleGenAI, Type } from "@google/genai";
import { Meal, CategorizedGroceries } from "../types";

// @ts-ignore
const API_KEY = process.env.GEMINI_API_KEY || (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_GEMINI_API_KEY : "") || "";
const ai = new GoogleGenAI({ apiKey: API_KEY });

const MODEL = "gemini-3-flash-preview";

const stepsSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      instruction: { type: Type.STRING, description: "The main action to take." },
      durationMinutes: { type: Type.NUMBER, description: "Duration of this step in minutes, if it involves waiting/cooking." },
      parallelTasks: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Tasks to perform while this step's duration is elapsing."
      }
    },
    required: ["id", "instruction"]
  }
};

export async function generateMealPlan(favorites: Meal[] = [], currentMeals: Meal[] = []): Promise<Meal[]> {
  // Find which current meals are favorited
  let keptMeals = currentMeals.filter(m => favorites.some(f => f.title === m.title));
  
  // If we have no kept meals from the current plan, but we have favorites, randomly pick up to 2
  if (keptMeals.length === 0 && favorites.length > 0) {
    const shuffledFavs = [...favorites].sort(() => 0.5 - Math.random());
    // Try to pick up to 2 favorites that fit the criteria
    let added = 0;
    for (const fav of shuffledFavs) {
      if (added >= 2) break;
      // Make sure we don't exceed the required amounts
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
  
  // Ensure we don't ask for negative amounts
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

IMPORTANT: Use ONLY metric units (grams, milliliters) for all ingredients. DO NOT use cups, ounces, pounds, or spoons.
${previousTitles ? `DO NOT generate any of these previous meals: ${previousTitles}. ` : ''}Be creative and varied!`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      temperature: 0.9,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          meals: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                type: { type: Type.STRING, description: "'breakfast' or 'dinner'" },
                prepStyle: { type: Type.STRING, description: "'make-ahead', 'fresh', or 'batch'" },
                portions: { type: Type.NUMBER, description: "Number of portions the recipe yields" },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                prepTime: { type: Type.NUMBER, description: "Time in minutes" },
                cookTime: { type: Type.NUMBER, description: "Time in minutes" },
                ingredients: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING, description: "Ingredient name with quantity" },
                      category: { type: Type.STRING, description: "Produce, Meat, Dairy, Pantry, etc." },
                      icon: { type: Type.STRING, description: "A single emoji representing the ingredient" }
                    },
                    required: ["name", "category", "icon"]
                  },
                  description: "List of ingredients with quantities, categories, and icons"
                },
                miseEnPlace: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Mise en place steps: what to wash, chop, measure, or prepare before starting to cook."
                },
                steps: stepsSchema
              },
              required: ["id", "type", "prepStyle", "portions", "title", "description", "prepTime", "cookTime", "ingredients", "miseEnPlace", "steps"]
            }
          }
        },
        required: ["meals"]
      }
    }
  });

  if (!response.text) {
    console.error("Empty response from AI", response);
    throw new Error("The AI returned an empty response. Please try again.");
  }

  try {
    const parsed = JSON.parse(response.text);
    return [...keptMeals, ...(parsed.meals || [])];
  } catch (e) {
    console.error("Failed to parse AI response:", response.text);
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

IMPORTANT: Use ONLY metric units (grams, milliliters) for all ingredients. DO NOT use cups, ounces, pounds, or spoons.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: replacementPrompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          type: { type: Type.STRING },
          prepStyle: { type: Type.STRING },
          portions: { type: Type.NUMBER },
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          prepTime: { type: Type.NUMBER },
          cookTime: { type: Type.NUMBER },
          ingredients: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "Ingredient name with quantity" },
                category: { type: Type.STRING, description: "Produce, Meat, Dairy, Pantry, etc." },
                icon: { type: Type.STRING, description: "A single emoji representing the ingredient" }
              },
              required: ["name", "category", "icon"]
            }
          },
          miseEnPlace: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Mise en place steps: what to wash, chop, measure, or prepare before starting to cook."
          },
          steps: stepsSchema
        },
        required: ["id", "type", "prepStyle", "portions", "title", "description", "prepTime", "cookTime", "ingredients", "miseEnPlace", "steps"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}

export async function generateGroceryList(meals: Meal[]): Promise<CategorizedGroceries> {
  const allIngredients = meals.flatMap(m => (m.ingredients as any[]) || []).map((ing: any) => typeof ing === 'string' ? ing : ing.name).join("\\n");
  
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `Categorize the following ingredients into a standard grocery shopping list.\\n\\nIMPORTANT: You MUST combine and aggregate quantities for identical or similar ingredients. For example, if you see "200g chicken" and "300g chicken", combine them into a single entry "500g chicken". Do not output duplicate items. For each item, provide a fitting emoji icon.\\n\\nIngredients:\\n${allIngredients}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          categories: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                category: { type: Type.STRING, description: "e.g., Produce, Meat, Dairy, Pantry" },
                items: { 
                  type: Type.ARRAY, 
                  items: { 
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      icon: { type: Type.STRING, description: "A single emoji representing the item" }
                    },
                    required: ["name", "icon"]
                  } 
                }
              },
              required: ["category", "items"]
            }
          }
        },
        required: ["categories"]
      }
    }
  });

  if (!response.text) {
    throw new Error("Empty response from AI");
  }

  const parsed = JSON.parse(response.text);
  const rawCategories: { category: string, items: { name: string, icon: string }[] }[] = parsed.categories || [];
  
  // Convert to our UI format
  const categorized: CategorizedGroceries = {};
  for (const cat of rawCategories) {
    categorized[cat.category] = cat.items.map(i => ({ item: i.name, icon: i.icon, checked: false }));
  }
  
  return categorized;
}

export async function importRecipeFromUrl(url: string): Promise<Meal> {
  const prompt = `Extract the recipe from this URL: ${url}
  
Convert all ingredients to metric units (grams, milliliters). DO NOT use cups, ounces, pounds, or spoons.
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

Return the recipe matching the JSON schema.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      tools: [{ urlContext: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          type: { type: Type.STRING, description: "'breakfast' or 'dinner'" },
          prepStyle: { type: Type.STRING, description: "'make-ahead', 'fresh', or 'batch'" },
          portions: { type: Type.NUMBER, description: "Number of portions the recipe yields" },
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          prepTime: { type: Type.NUMBER, description: "Time in minutes" },
          cookTime: { type: Type.NUMBER, description: "Time in minutes" },
          ingredients: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "Ingredient name with quantity" },
                category: { type: Type.STRING, description: "Produce, Meat, Dairy, Pantry, etc." },
                icon: { type: Type.STRING, description: "A single emoji representing the ingredient" }
              },
              required: ["name", "category", "icon"]
            },
            description: "List of ingredients with quantities, categories, and icons"
          },
          miseEnPlace: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Mise en place steps: what to wash, chop, measure, or prepare before starting to cook."
          },
          steps: stepsSchema
        },
        required: ["id", "type", "prepStyle", "portions", "title", "description", "prepTime", "cookTime", "ingredients", "miseEnPlace", "steps"]
      }
    }
  });

  if (!response.text) {
    throw new Error("Empty response from AI");
  }

  return JSON.parse(response.text);
}

export async function generateRecipeFromIngredients(ingredients: string[]): Promise<Meal> {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `Suggest a dinner recipe for 2 people that uses some or all of the following ingredients: ${ingredients.join(', ')}. You can assume basic pantry staples (salt, pepper, oil, etc.) are available. 
    
For this recipe, also provide a highly optimized, parallelized step-by-step cooking guide. Identify steps that have a duration (like boiling, baking, simmering). For those steps, explicitly provide "parallelTasks" - what the user should do WHILE waiting for that step to finish (e.g., chopping veggies, setting the table).

IMPORTANT: Use ONLY metric units (grams, kilograms, liters, milliliters) for all ingredients. DO NOT use cups, ounces, pounds, tablespoons, or teaspoons. Adjust portion sizes for exactly 2 people.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          type: { type: Type.STRING },
          prepStyle: { type: Type.STRING },
          portions: { type: Type.NUMBER },
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          prepTime: { type: Type.NUMBER },
          cookTime: { type: Type.NUMBER },
          ingredients: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "Ingredient name with quantity" },
                category: { type: Type.STRING, description: "Produce, Meat, Dairy, Pantry, etc." },
                icon: { type: Type.STRING, description: "A single emoji representing the ingredient" }
              },
              required: ["name", "category", "icon"]
            }
          },
          miseEnPlace: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Mise en place steps: what to wash, chop, measure, or prepare before starting to cook."
          },
          steps: stepsSchema
        },
        required: ["id", "type", "prepStyle", "portions", "title", "description", "prepTime", "cookTime", "ingredients", "miseEnPlace", "steps"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}
