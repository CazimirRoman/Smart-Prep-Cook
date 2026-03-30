# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Smart Prep & Cook is an AI-powered cooking assistant built as a Google AI Studio applet. It generates weekly meal plans (batch dinners + creative breakfasts), smart grocery lists, parallelized step-by-step cooking instructions, and a pantry-based recipe generator. Uses Gemini AI for all content generation.

## Commands

- `npm run dev` - Start dev server on port 3000
- `npm run build` - Production build via Vite
- `npm run lint` - Type-check with `tsc --noEmit` (no separate linter)
- `npm run preview` - Preview production build
- `npm run clean` - Remove dist/

No test framework is configured.

## Architecture

**Single-page React app** (React 19) with Vite, Tailwind CSS v4, and TypeScript. No router — navigation is tab-based via `activeTab` state in `App.tsx`.

### Key Files

- `src/App.tsx` — Monolithic component containing all UI: main `App` function plus `EditRecipeModal`, `RecipeDetailModal`, and `CookingModeView` components defined in the same file. All app state lives in `App()` via `useState` hooks.
- `src/services/ai.ts` — OpenAI API integration (`openai`). Exports: `generateMealPlan`, `swapMeal`, `generateGroceryList`, `importRecipeFromUrl`, `generateRecipeFromIngredients`. All use structured JSON output schemas. Model: `gpt-5.3-chat-latest`.
- `src/types.ts` — Core types: `Meal`, `CookingStep`, `Ingredient`, `CategorizedGroceries`.
- `src/firebase.ts` — Firebase init, exports `auth`, `provider` (Google), `db` (Firestore).

### Data Persistence

Dual persistence strategy: localStorage for anonymous users, Firestore for authenticated (Google sign-in) users. The `App` component uses `isCloudUpdate` and `initialLoadDone` refs to prevent write loops between Firestore snapshots and local state updates. User data is stored as a single Firestore document at `/users/{userId}` with `meals`, `groceries`, and `favorites` stored as JSON strings.

### Meal Plan Structure

The app generates a fixed weekly plan: 2 batch dinners (4-6 portions each), 2 make-ahead breakfasts, and 2 fresh breakfasts. Favorites from previous plans are carried over. All recipes use metric units only.

## Configuration

- `OPENAI_API_KEY` — Required. Set in `.env.local` (injected at build time via `vite.config.ts` `define` block as `process.env.OPENAI_API_KEY`)
- `firebase-applet-config.json` — Firebase project config (checked into repo, used by AI Studio)
- `firestore.rules` — Security rules enforcing per-user document ownership
- Path alias: `@/` maps to project root (both in `tsconfig.json` and `vite.config.ts`)

## UI Conventions

- Tailwind CSS v4 (via `@tailwindcss/vite` plugin, no `tailwind.config` file)
- `lucide-react` for icons
- `motion` (Framer Motion) for animations (`AnimatePresence`, `motion.div`)
- Stone/emerald color palette throughout