export interface CookingStep {
  id: string;
  instruction: string;
  durationMinutes?: number;
  parallelTasks?: string[];
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
  ingredients: string[];
  steps: CookingStep[];
}

export interface CategorizedGroceries {
  [category: string]: { item: string; checked: boolean }[];
}
