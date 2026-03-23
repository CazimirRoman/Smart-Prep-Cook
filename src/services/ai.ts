import { GoogleGenAI, Type } from "@google/genai";
import { Meal, CategorizedGroceries, RecipeDetails } from "../types";

// @ts-ignore
const API_KEY = process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey: API_KEY });

const MODEL = "gemini-3-flash-preview";

export async function generateMealPlan(favorites: Meal[] = []): Promise<Meal[]> {
  let prompt = "Generate a 5-day weekday dinner meal plan for a family of 3 (2 adults, 1 child). The meals MUST take around 30 minutes total to cook. No dietary restrictions. Make them easy to implement. IMPORTANT: Use ONLY metric units (grams, kilograms, liters, milliliters) for all ingredients. DO NOT use cups, ounces, pounds, tablespoons, or teaspoons.";
  
  if (favorites.length > 0) {
    const favTitles = favorites.map(f => f.title).join(", ");
    prompt += `\n\nHere are some of the user's favorite meals: ${favTitles}. Please include 2 or 3 of these favorites in the 5-day plan, and generate new ideas for the remaining days.`;
  }

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            day: { type: Type.STRING, description: "e.g., Monday, Tuesday" },
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            prepTime: { type: Type.NUMBER, description: "Time in minutes" },
            cookTime: { type: Type.NUMBER, description: "Time in minutes" },
            ingredients: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "List of ingredients with quantities"
            }
          },
          required: ["id", "day", "title", "description", "prepTime", "cookTime", "ingredients"]
        }
      }
    }
  });

  return JSON.parse(response.text || "[]");
}

export async function swapMeal(day: string, rejectedMealTitle: string): Promise<Meal> {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `Suggest a new 30-minute dinner for a family of 3 for ${day} to replace "${rejectedMealTitle}". It should be easy to implement. IMPORTANT: Use ONLY metric units (grams, kilograms, liters, milliliters) for all ingredients. DO NOT use cups, ounces, pounds, tablespoons, or teaspoons.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          day: { type: Type.STRING },
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          prepTime: { type: Type.NUMBER },
          cookTime: { type: Type.NUMBER },
          ingredients: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["id", "day", "title", "description", "prepTime", "cookTime", "ingredients"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}

export async function generateGroceryList(meals: Meal[]): Promise<CategorizedGroceries> {
  const allIngredients = meals.flatMap(m => m.ingredients).join("\\n");
  
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `Categorize the following ingredients into a standard grocery shopping list.\\n\\nIMPORTANT: You MUST combine and aggregate quantities for identical or similar ingredients. For example, if you see "200g chicken" and "300g chicken", combine them into a single entry "500g chicken". Do not output duplicate items.\\n\\nIngredients:\\n${allIngredients}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING, description: "e.g., Produce, Meat, Dairy, Pantry" },
            items: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING } 
            }
          },
          required: ["category", "items"]
        }
      }
    }
  });

  const rawCategories: { category: string, items: string[] }[] = JSON.parse(response.text || "[]");
  
  // Convert to our UI format
  const categorized: CategorizedGroceries = {};
  for (const cat of rawCategories) {
    categorized[cat.category] = cat.items.map(item => ({ item, checked: false }));
  }
  
  return categorized;
}

export async function generateRecipeFromIngredients(ingredients: string[]): Promise<Meal> {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `Suggest a 30-minute dinner recipe that uses some or all of the following ingredients: ${ingredients.join(', ')}. You can assume basic pantry staples (salt, pepper, oil, etc.) are available. IMPORTANT: Use ONLY metric units (grams, kilograms, liters, milliliters) for all ingredients. DO NOT use cups, ounces, pounds, tablespoons, or teaspoons.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          day: { type: Type.STRING },
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          prepTime: { type: Type.NUMBER },
          cookTime: { type: Type.NUMBER },
          ingredients: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["id", "day", "title", "description", "prepTime", "cookTime", "ingredients"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}

export async function generateCookingSteps(meal: Meal): Promise<RecipeDetails> {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: `Create a highly optimized, parallelized step-by-step cooking guide for "${meal.title}". 
    Ingredients: ${meal.ingredients.join(', ')}.
    The total time should be around 30 minutes.
    Identify steps that have a duration (like boiling, baking, simmering).
    For those steps, explicitly provide "parallelTasks" - what the user should do WHILE waiting for that step to finish (e.g., chopping veggies, setting the table).
    This is crucial for saving time.
    IMPORTANT: If you mention measurements in the steps, use ONLY metric units (grams, liters, milliliters). DO NOT use cups, ounces, or spoons.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          steps: {
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
          }
        },
        required: ["steps"]
      }
    }
  });

  return JSON.parse(response.text || '{"steps": []}');
}
