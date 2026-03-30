export interface CookingStep {
  id: string;
  instruction: string;
  durationMinutes?: number;
  parallelTasks?: string[];
}

export interface Ingredient {
  name: string;
  category: string;
  icon: string;
}

export interface Meal {
  id: string;
  type: 'breakfast' | 'dinner';
  prepStyle: 'make-ahead' | 'fresh' | 'batch';
  portions: number;
  title: string;
  description: string;
  prepTime: number;
  cookTime: number;
  ingredients: Ingredient[] | string[];
  miseEnPlace: string[];
  steps: CookingStep[];
  lastCookedAt?: string;
  imageUrl?: string;
}

export interface CategorizedGroceries {
  [category: string]: { item: string; icon: string; checked: boolean }[];
}
