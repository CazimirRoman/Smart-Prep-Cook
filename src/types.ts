export interface Meal {
  id: string;
  day: string;
  title: string;
  description: string;
  prepTime: number;
  cookTime: number;
  ingredients: string[];
}

export interface CategorizedGroceries {
  [category: string]: { item: string; checked: boolean }[];
}

export interface CookingStep {
  id: string;
  instruction: string;
  durationMinutes?: number;
  parallelTasks?: string[];
}

export interface RecipeDetails {
  steps: CookingStep[];
}
