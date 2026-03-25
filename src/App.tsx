import React, { useState, useEffect, useMemo } from 'react';
import { generateMealPlan, swapMeal, generateGroceryList, generateRecipeFromIngredients, importRecipeFromUrl } from './services/ai';
import { Meal, CategorizedGroceries } from './types';
import { ChefHat, ShoppingCart, Calendar, RefreshCw, Play, CheckCircle2, Circle, Clock, ArrowRight, ArrowLeft, Heart, X, Utensils, Plus, LogOut, LogIn } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, provider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp, getDocFromServer } from 'firebase/firestore';

const COMMON_INGREDIENTS = [
  { name: 'Chicken', icon: '🍗' },
  { name: 'Beef', icon: '🥩' },
  { name: 'Pork', icon: '🥓' },
  { name: 'Fish', icon: '🐟' },
  { name: 'Eggs', icon: '🥚' },
  { name: 'Rice', icon: '🍚' },
  { name: 'Pasta', icon: '🍝' },
  { name: 'Potatoes', icon: '🥔' },
  { name: 'Onion', icon: '🧅' },
  { name: 'Garlic', icon: '🧄' },
  { name: 'Tomatoes', icon: '🍅' },
  { name: 'Broccoli', icon: '🥦' },
  { name: 'Carrots', icon: '🥕' },
  { name: 'Spinach', icon: '🥬' },
  { name: 'Cheese', icon: '🧀' },
  { name: 'Milk', icon: '🥛' },
  { name: 'Bread', icon: '🍞' },
  { name: 'Beans', icon: '🫘' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'plan' | 'groceries' | 'pantry' | 'favorites'>('plan');
  const [meals, setMeals] = useState<Meal[]>(() => {
    const saved = localStorage.getItem('smart-cook-meals');
    return saved ? JSON.parse(saved) : [];
  });
  const [groceries, setGroceries] = useState<CategorizedGroceries>(() => {
    const saved = localStorage.getItem('smart-cook-groceries');
    return saved ? JSON.parse(saved) : {};
  });
  
  const [loadingMeals, setLoadingMeals] = useState(false);
  const [loadingGroceries, setLoadingGroceries] = useState(false);
  const [swappingMealId, setSwappingMealId] = useState<string | null>(null);
  
  const [activeCookingMeal, setActiveCookingMeal] = useState<Meal | null>(null);
  const [mealGroceriesState, setMealGroceriesState] = useState<{
    isOpen: boolean;
    meal: Meal | null;
    loading: boolean;
    groceries: CategorizedGroceries | null;
  }>({ isOpen: false, meal: null, loading: false, groceries: null });

  const handleViewMealGroceries = (meal: Meal) => {
    const list: CategorizedGroceries = {};
    meal.ingredients.forEach(ing => {
      if (typeof ing === 'string') {
        if (!list['Other']) list['Other'] = [];
        list['Other'].push({ item: ing, icon: '🛒', checked: false });
      } else {
        if (!list[ing.category]) list[ing.category] = [];
        list[ing.category].push({ item: ing.name, icon: ing.icon, checked: false });
      }
    });
    setMealGroceriesState({ isOpen: true, meal, loading: false, groceries: list });
  };

  // Pantry State
  const [pantryIngredients, setPantryIngredients] = useState<string[]>(() => {
    const saved = localStorage.getItem('smart-cook-pantry');
    return saved ? JSON.parse(saved) : [];
  });
  const [ingredientInput, setIngredientInput] = useState('');
  const [generatedPantryMeal, setGeneratedPantryMeal] = useState<Meal | null>(null);
  const [loadingPantryMeal, setLoadingPantryMeal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [favorites, setFavorites] = useState<Meal[]>(() => {
    const saved = localStorage.getItem('smart-cook-favorites');
    return saved ? JSON.parse(saved) : [];
  });

  const [importUrl, setImportUrl] = useState('');
  const [importingRecipe, setImportingRecipe] = useState(false);

  const handleImportRecipe = async () => {
    if (!importUrl) return;
    setImportingRecipe(true);
    setError(null);
    try {
      const meal = await importRecipeFromUrl(importUrl);
      setFavorites(prev => {
        if (!prev.some(f => f.title === meal.title)) {
          return [...prev, meal];
        }
        return prev;
      });
      setImportUrl('');
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to import recipe from URL.");
    } finally {
      setImportingRecipe(false);
    }
  };

  const [planTab, setPlanTab] = useState<'morning' | 'dinner'>('morning');

  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const isCloudUpdate = React.useRef(false);

  enum OperationType {
    CREATE = 'create',
    UPDATE = 'update',
    DELETE = 'delete',
    LIST = 'list',
    GET = 'get',
    WRITE = 'write',
  }

  interface FirestoreErrorInfo {
    error: string;
    operationType: OperationType;
    path: string | null;
    authInfo: {
      userId: string | undefined;
      email: string | null | undefined;
      emailVerified: boolean | undefined;
      isAnonymous: boolean | undefined;
      tenantId: string | null | undefined;
      providerInfo: {
        providerId: string;
        displayName: string | null;
        email: string | null;
        photoUrl: string | null;
      }[];
    }
  }

  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  };

  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAuthReady) return;
    if (!user) {
      // Load from local storage if not logged in
      const savedMeals = localStorage.getItem('smart-cook-meals');
      if (savedMeals) setMeals(JSON.parse(savedMeals));
      const savedGroceries = localStorage.getItem('smart-cook-groceries');
      if (savedGroceries) setGroceries(JSON.parse(savedGroceries));
      const savedPantry = localStorage.getItem('smart-cook-pantry');
      if (savedPantry) setPantryIngredients(JSON.parse(savedPantry));
      const savedFavorites = localStorage.getItem('smart-cook-favorites');
      if (savedFavorites) setFavorites(JSON.parse(savedFavorites));
      return;
    }

    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        isCloudUpdate.current = true;
        
        if (data.meals) setMeals(JSON.parse(data.meals));
        if (data.groceries) setGroceries(JSON.parse(data.groceries));
        if (data.pantryIngredients) setPantryIngredients(data.pantryIngredients);
        if (data.favorites) setFavorites(JSON.parse(data.favorites));
        
        setTimeout(() => {
          isCloudUpdate.current = false;
        }, 100);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  useEffect(() => {
    if (isCloudUpdate.current) return;
    
    if (user) {
      const saveData = async () => {
        try {
          await setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            meals: JSON.stringify(meals),
            groceries: JSON.stringify(groceries),
            pantryIngredients,
            favorites: JSON.stringify(favorites),
            updatedAt: serverTimestamp()
          }, { merge: true });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
        }
      };
      saveData();
    } else {
      localStorage.setItem('smart-cook-favorites', JSON.stringify(favorites));
      localStorage.setItem('smart-cook-meals', JSON.stringify(meals));
      localStorage.setItem('smart-cook-groceries', JSON.stringify(groceries));
      localStorage.setItem('smart-cook-pantry', JSON.stringify(pantryIngredients));
    }
  }, [meals, groceries, pantryIngredients, favorites, user]);

  useEffect(() => {
    if (isAuthReady && meals.length === 0) {
      loadInitialPlan();
    }
  }, [isAuthReady]);

  const loadInitialPlan = async () => {
    setLoadingMeals(true);
    setGroceries({}); // Reset groceries list when regenerating
    setError(null);
    try {
      const newMeals = await generateMealPlan(favorites, meals);
      if (!newMeals || newMeals.length === 0) {
        setError("AI returned an empty meal plan. Please try again.");
      } else {
        setMeals(newMeals);
      }
    } catch (e: any) {
      console.error(e);
      setError(e.message || "An error occurred while generating the meal plan.");
    } finally {
      setLoadingMeals(false);
    }
  };

  const toggleFavorite = (meal: Meal) => {
    setFavorites(prev => {
      const isFav = prev.some(f => f.title === meal.title);
      if (isFav) {
        return prev.filter(f => f.title !== meal.title);
      } else {
        return [...prev, meal];
      }
    });
  };

  const handleSwapMeal = async (meal: Meal) => {
    setSwappingMealId(meal.id);
    try {
      const newMeal = await swapMeal(meal);
      setMeals(prev => prev.map(m => m.id === meal.id ? newMeal : m));
      setGroceries({}); // Reset groceries list when a meal is swapped
    } catch (e) {
      console.error(e);
    } finally {
      setSwappingMealId(null);
    }
  };

  const handleGenerateGroceries = async () => {
    setActiveTab('groceries');
    setLoadingGroceries(true);
    try {
      const list = await generateGroceryList(meals);
      setGroceries(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingGroceries(false);
    }
  };

  const toggleGroceryItem = (category: string, index: number) => {
    setGroceries(prev => {
      const newGroceries = { ...prev };
      newGroceries[category] = [...prev[category]];
      newGroceries[category][index] = {
        ...newGroceries[category][index],
        checked: !newGroceries[category][index].checked
      };
      return newGroceries;
    });
  };

  const handleAddIngredient = (e: React.FormEvent) => {
    e.preventDefault();
    if (ingredientInput.trim() && !pantryIngredients.includes(ingredientInput.trim())) {
      setPantryIngredients([...pantryIngredients, ingredientInput.trim()]);
      setIngredientInput('');
    }
  };

  const handleRemoveIngredient = (ing: string) => {
    setPantryIngredients(pantryIngredients.filter(i => i !== ing));
  };

  const toggleIngredient = (ing: string) => {
    const lowerIng = ing.toLowerCase();
    if (pantryIngredients.includes(lowerIng)) {
      setPantryIngredients(pantryIngredients.filter(i => i !== lowerIng));
    } else {
      setPantryIngredients([...pantryIngredients, lowerIng]);
    }
  };

  const handleGenerateFromPantry = async () => {
    if (pantryIngredients.length === 0) return;
    setLoadingPantryMeal(true);
    try {
      const meal = await generateRecipeFromIngredients(pantryIngredients);
      meal.type = 'dinner';
      meal.prepStyle = 'fresh';
      meal.portions = 2;
      setGeneratedPantryMeal(meal);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingPantryMeal(false);
    }
  };

  const startCooking = async (meal: Meal) => {
    setActiveCookingMeal(meal);
  };

  const closeCookingMode = () => {
    setActiveCookingMeal(null);
  };

  if (mealGroceriesState.isOpen && mealGroceriesState.meal) {
    return (
      <div className="min-h-screen bg-stone-50 font-sans p-4 sm:p-8 flex items-center justify-center">
        <div className="bg-white rounded-3xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
          <div className="p-6 border-b border-stone-100 flex justify-between items-center bg-stone-900 text-white">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <ShoppingCart size={24} />
              Groceries for {mealGroceriesState.meal.title}
            </h2>
            <button 
              onClick={() => setMealGroceriesState({ isOpen: false, meal: null, loading: false, groceries: null })}
              className="p-2 hover:bg-stone-800 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>
          
          <div className="p-6 overflow-y-auto flex-1">
            {mealGroceriesState.loading ? (
              <div className="flex flex-col items-center justify-center py-12 text-stone-500">
                <RefreshCw size={32} className="animate-spin mb-4 text-emerald-500" />
                <p>Generating grocery list...</p>
              </div>
            ) : mealGroceriesState.groceries ? (
              <div className="space-y-6">
                {Object.entries(mealGroceriesState.groceries).map(([category, items]) => (
                  <div key={category}>
                    <h3 className="text-lg font-semibold text-stone-800 mb-3 capitalize">{category}</h3>
                    <ul className="space-y-2">
                      {(items as { item: string; icon: string; checked: boolean }[]).map((item, idx) => (
                        <li key={idx} className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl border border-stone-100">
                          <span className="text-xl">{item.icon || '🛒'}</span>
                          <span className="text-stone-700 font-medium">{item.item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-stone-500 py-8">
                Failed to load groceries.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (activeCookingMeal) {
    return (
      <CookingModeView 
        meal={activeCookingMeal} 
        onClose={closeCookingMode} 
      />
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans pb-24">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-500 text-white p-2 rounded-xl">
              <ChefHat size={24} />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Smart Prep & Cook</h1>
          </div>
          <div>
            {user ? (
              <button 
                onClick={() => signOut(auth)}
                className="flex items-center gap-2 text-sm text-stone-500 hover:text-stone-800 transition-colors"
              >
                <img src={user.photoURL || ''} alt="" className="w-6 h-6 rounded-full" />
                <LogOut size={16} />
              </button>
            ) : (
              <button 
                onClick={() => signInWithPopup(auth, provider)}
                className="flex items-center gap-2 text-sm bg-stone-100 text-stone-700 px-3 py-1.5 rounded-lg hover:bg-stone-200 transition-colors font-medium"
              >
                <LogIn size={16} />
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          {activeTab === 'plan' ? (
            <motion.div 
              key="plan"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold">This Week's Plan</h2>
                <button 
                  onClick={loadInitialPlan}
                  disabled={loadingMeals}
                  className="text-sm text-stone-500 hover:text-stone-800 flex items-center gap-1 disabled:opacity-50"
                >
                  <RefreshCw size={16} className={loadingMeals ? "animate-spin" : ""} />
                  Regenerate All
                </button>
              </div>

              {error && (
                <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-sm border border-rose-200">
                  {error}
                </div>
              )}

              {loadingMeals ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="bg-white rounded-2xl p-6 border border-stone-200 animate-pulse">
                      <div className="h-6 bg-stone-200 rounded w-1/4 mb-4"></div>
                      <div className="h-4 bg-stone-200 rounded w-3/4 mb-2"></div>
                      <div className="h-4 bg-stone-200 rounded w-1/2"></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex bg-stone-100 p-1 rounded-xl">
                    <button
                      onClick={() => setPlanTab('morning')}
                      className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${planTab === 'morning' ? 'bg-white text-emerald-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
                    >
                      Morning Inspirations
                    </button>
                    <button
                      onClick={() => setPlanTab('dinner')}
                      className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${planTab === 'dinner' ? 'bg-white text-emerald-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
                    >
                      Batch Dinners
                    </button>
                  </div>

                  {planTab === 'morning' && (
                    <section>
                      <h3 className="text-xl font-semibold mb-4 text-stone-800 flex items-center gap-2">
                        <span className="text-2xl">🌅</span> Morning Inspirations
                      </h3>
                      <div className="space-y-4">
                        {meals.filter(m => m.type === 'breakfast').map(meal => (
                        <div key={meal.id} className="bg-white rounded-2xl p-6 border border-stone-200 shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex gap-2 flex-wrap">
                              <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md ${meal.prepStyle === 'make-ahead' ? 'text-indigo-600 bg-indigo-50' : 'text-amber-600 bg-amber-50'}`}>
                                {meal.prepStyle === 'make-ahead' ? 'Make-Ahead' : 'Fresh Morning'}
                              </span>
                              <span className="text-xs font-bold uppercase tracking-wider text-stone-600 bg-stone-100 px-2 py-1 rounded-md">
                                {meal.portions} Portions
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => toggleFavorite(meal)}
                                className={`p-1.5 rounded-full transition-colors ${favorites.some(f => f.title === meal.title) ? 'text-rose-500 hover:bg-rose-50' : 'text-stone-400 hover:text-rose-500 hover:bg-stone-100'}`}
                                title={favorites.some(f => f.title === meal.title) ? "Remove from favorites" : "Add to favorites"}
                              >
                                <Heart size={18} fill={favorites.some(f => f.title === meal.title) ? "currentColor" : "none"} />
                              </button>
                              <button 
                                onClick={() => handleSwapMeal(meal)}
                                disabled={swappingMealId === meal.id}
                                className="text-stone-400 hover:text-stone-700 p-1.5 rounded-full hover:bg-stone-100 transition-colors disabled:opacity-50"
                                title="Swap this meal"
                              >
                                <RefreshCw size={18} className={swappingMealId === meal.id ? "animate-spin" : ""} />
                              </button>
                            </div>
                          </div>
                          <h3 className="text-xl font-semibold mb-1">{meal.title}</h3>
                          <p className="text-stone-500 text-sm mb-4 line-clamp-2">{meal.description}</p>
                          
                          <div className="flex items-center justify-between mt-4 pt-4 border-t border-stone-100">
                            <div className="flex items-center gap-4 text-sm text-stone-500">
                              <span className="flex items-center gap-1"><Clock size={16} /> {meal.prepTime + meal.cookTime} min total</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => handleViewMealGroceries(meal)}
                                className="bg-stone-100 text-stone-700 p-2 rounded-xl hover:bg-stone-200 transition-colors"
                                title="Grocery List for this meal"
                              >
                                <ShoppingCart size={16} />
                              </button>
                              <button 
                                onClick={() => startCooking(meal)}
                                className="bg-stone-900 text-white px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-stone-800 transition-colors"
                              >
                                <Play size={16} fill="currentColor" />
                                Start Cooking
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                  )}

                  {/* Dinners Section */}
                  {planTab === 'dinner' && (
                  <section>
                    <h3 className="text-xl font-semibold mb-4 text-stone-800 flex items-center gap-2">
                      <span className="text-2xl">🍲</span> Batch Dinners
                    </h3>
                    <div className="space-y-4">
                      {meals.filter(m => m.type === 'dinner').map((meal, index) => (
                        <div key={meal.id} className="bg-white rounded-2xl p-6 border border-stone-200 shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex gap-2 flex-wrap">
                              <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
                                Cook Day {index + 1}
                              </span>
                              <span className="text-xs font-bold uppercase tracking-wider text-stone-600 bg-stone-100 px-2 py-1 rounded-md">
                                {meal.portions} Portions (Lasts 2-3 days)
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => toggleFavorite(meal)}
                                className={`p-1.5 rounded-full transition-colors ${favorites.some(f => f.title === meal.title) ? 'text-rose-500 hover:bg-rose-50' : 'text-stone-400 hover:text-rose-500 hover:bg-stone-100'}`}
                                title={favorites.some(f => f.title === meal.title) ? "Remove from favorites" : "Add to favorites"}
                              >
                                <Heart size={18} fill={favorites.some(f => f.title === meal.title) ? "currentColor" : "none"} />
                              </button>
                              <button 
                                onClick={() => handleSwapMeal(meal)}
                                disabled={swappingMealId === meal.id}
                                className="text-stone-400 hover:text-stone-700 p-1.5 rounded-full hover:bg-stone-100 transition-colors disabled:opacity-50"
                                title="Swap this meal"
                              >
                                <RefreshCw size={18} className={swappingMealId === meal.id ? "animate-spin" : ""} />
                              </button>
                            </div>
                          </div>
                          <h3 className="text-xl font-semibold mb-1">{meal.title}</h3>
                          <p className="text-stone-500 text-sm mb-4 line-clamp-2">{meal.description}</p>
                          
                          <div className="flex items-center justify-between mt-4 pt-4 border-t border-stone-100">
                            <div className="flex items-center gap-4 text-sm text-stone-500">
                              <span className="flex items-center gap-1"><Clock size={16} /> {meal.prepTime + meal.cookTime} min total</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => handleViewMealGroceries(meal)}
                                className="bg-stone-100 text-stone-700 p-2 rounded-xl hover:bg-stone-200 transition-colors"
                                title="Grocery List for this meal"
                              >
                                <ShoppingCart size={16} />
                              </button>
                              <button 
                                onClick={() => startCooking(meal)}
                                className="bg-stone-900 text-white px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-stone-800 transition-colors"
                              >
                                <Play size={16} fill="currentColor" />
                                Start Cooking
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                  )}
                </div>
              )}
            </motion.div>
          ) : activeTab === 'groceries' ? (
            <motion.div 
              key="groceries"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold">Grocery List</h2>
                <button 
                  onClick={handleGenerateGroceries}
                  disabled={loadingGroceries || meals.length === 0 || loadingMeals}
                  className="text-sm bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-lg hover:bg-emerald-200 transition-colors disabled:opacity-50 font-medium"
                >
                  {loadingGroceries ? "Generating..." : loadingMeals ? "Waiting for Meal Plan..." : "Regenerate List"}
                </button>
              </div>

              {loadingGroceries ? (
                <div className="flex flex-col items-center justify-center py-20 text-stone-400">
                  <RefreshCw size={32} className="animate-spin mb-4" />
                  <p>Organizing your shopping list...</p>
                </div>
              ) : Object.keys(groceries).length === 0 ? (
                <div className="text-center py-20 text-stone-500 bg-white rounded-2xl border border-stone-200 border-dashed">
                  <ShoppingCart size={48} className="mx-auto mb-4 text-stone-300" />
                  <p className="mb-4">Your list is empty.</p>
                  <button 
                    onClick={handleGenerateGroceries}
                    disabled={meals.length === 0 || loadingMeals}
                    className="bg-stone-900 text-white px-6 py-2 rounded-xl font-medium hover:bg-stone-800 transition-colors disabled:opacity-50"
                  >
                    {loadingMeals ? "Waiting for Meal Plan..." : "Generate from Meal Plan"}
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  {(Object.entries(groceries) as [string, { item: string; icon?: string; checked: boolean }[]][]).map(([category, items]) => (
                    <div key={category} className="bg-white rounded-2xl p-6 border border-stone-200 shadow-sm">
                      <h3 className="text-lg font-semibold mb-4 text-stone-800">{category}</h3>
                      <ul className="space-y-3">
                        {items.map((item, idx) => (
                          <li 
                            key={idx} 
                            className="flex items-start gap-3 cursor-pointer group"
                            onClick={() => toggleGroceryItem(category, idx)}
                          >
                            <div className="mt-0.5 text-emerald-500 shrink-0">
                              {item.checked ? <CheckCircle2 size={20} /> : <Circle size={20} className="text-stone-300 group-hover:text-emerald-400" />}
                            </div>
                            <span className={`text-stone-700 flex items-center gap-2 ${item.checked ? 'line-through opacity-50' : ''}`}>
                              {item.icon && <span>{item.icon}</span>}
                              {item.item}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          ) : activeTab === 'pantry' ? (
            <motion.div 
              key="pantry"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold">Cook from Pantry</h2>
              </div>

              <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-sm">
                <p className="text-stone-500 text-sm mb-4">Enter the ingredients you have on hand, and we'll generate a recipe for you.</p>
                
                <form onSubmit={handleAddIngredient} className="flex gap-2 mb-4">
                  <input 
                    type="text" 
                    value={ingredientInput} 
                    onChange={e => setIngredientInput(e.target.value)} 
                    placeholder="e.g., chicken breast, broccoli, rice" 
                    className="flex-1 px-4 py-3 rounded-xl border border-stone-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-stone-50" 
                  />
                  <button 
                    type="submit" 
                    disabled={!ingredientInput.trim()} 
                    className="bg-stone-900 text-white px-4 py-3 rounded-xl disabled:opacity-50 hover:bg-stone-800 transition-colors"
                  >
                    <Plus size={24} />
                  </button>
                </form>

                <div className="mb-6">
                  <h3 className="text-sm font-medium text-stone-700 mb-3">Quick Add</h3>
                  <div className="flex flex-wrap gap-2">
                    {COMMON_INGREDIENTS.map(item => {
                      const isSelected = pantryIngredients.includes(item.name.toLowerCase());
                      return (
                        <button
                          key={item.name}
                          onClick={() => toggleIngredient(item.name)}
                          className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors ${
                            isSelected 
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-200' 
                              : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
                          } border shadow-sm`}
                        >
                          <span>{item.icon}</span>
                          {item.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {pantryIngredients.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-6">
                    {pantryIngredients.map(ing => (
                      <span key={ing} className="bg-emerald-100 text-emerald-800 px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-2">
                        {ing}
                        <button onClick={() => handleRemoveIngredient(ing)} className="hover:text-emerald-950 p-0.5 rounded-full hover:bg-emerald-200 transition-colors">
                          <X size={14} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <button 
                  onClick={handleGenerateFromPantry} 
                  disabled={pantryIngredients.length === 0 || loadingPantryMeal} 
                  className="w-full bg-emerald-500 text-stone-900 font-bold py-3 rounded-xl disabled:opacity-50 flex justify-center items-center gap-2 hover:bg-emerald-400 transition-colors shadow-sm"
                >
                  {loadingPantryMeal ? <RefreshCw className="animate-spin" size={20} /> : <ChefHat size={20} />}
                  {loadingPantryMeal ? "Creating Recipe..." : "Generate Recipe"}
                </button>
              </div>

              {generatedPantryMeal && (
                <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
                      Pantry Creation
                    </span>
                    <button 
                      onClick={() => toggleFavorite(generatedPantryMeal)}
                      className={`p-1.5 rounded-full transition-colors ${favorites.some(f => f.title === generatedPantryMeal.title) ? 'text-rose-500 hover:bg-rose-50' : 'text-stone-400 hover:text-rose-500 hover:bg-stone-100'}`}
                      title={favorites.some(f => f.title === generatedPantryMeal.title) ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Heart size={18} fill={favorites.some(f => f.title === generatedPantryMeal.title) ? "currentColor" : "none"} />
                    </button>
                  </div>
                  <h3 className="text-xl font-semibold mb-1">{generatedPantryMeal.title}</h3>
                  <p className="text-stone-500 text-sm mb-4">{generatedPantryMeal.description}</p>
                  
                  <div className="mb-4 bg-stone-50 p-4 rounded-xl border border-stone-100">
                    <h4 className="font-semibold text-sm mb-2 text-stone-700">Ingredients needed:</h4>
                    <ul className="text-sm text-stone-600 list-disc pl-5 space-y-1">
                      {generatedPantryMeal.ingredients.map((ing, i) => <li key={i}>{typeof ing === 'string' ? ing : ing.name}</li>)}
                    </ul>
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-stone-100">
                    <div className="flex items-center gap-4 text-sm text-stone-500">
                      <span className="flex items-center gap-1"><Clock size={16} /> {generatedPantryMeal.prepTime + generatedPantryMeal.cookTime} min total</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleViewMealGroceries(generatedPantryMeal)}
                        className="bg-stone-100 text-stone-700 p-2 rounded-xl hover:bg-stone-200 transition-colors"
                        title="Grocery List for this meal"
                      >
                        <ShoppingCart size={16} />
                      </button>
                      <button 
                        onClick={() => startCooking(generatedPantryMeal)}
                        className="bg-stone-900 text-white px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-stone-800 transition-colors"
                      >
                        <Play size={16} fill="currentColor" />
                        Start Cooking
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          ) : activeTab === 'favorites' ? (
            <motion.div 
              key="favorites"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col gap-6"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-stone-800">Your Favorites</h2>
              </div>

              {error && (
                <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-sm border border-rose-200">
                  {error}
                </div>
              )}
              
              <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-sm">
                <h3 className="text-lg font-semibold mb-2 text-stone-800">Import Recipe</h3>
                <p className="text-sm text-stone-500 mb-4">Paste a URL to any recipe online, and we'll convert it to metric, optimize the steps, and save it to your favorites.</p>
                <div className="flex gap-2">
                  <input 
                    type="url" 
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    placeholder="https://example.com/recipe"
                    className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && importUrl && !importingRecipe) {
                        handleImportRecipe();
                      }
                    }}
                  />
                  <button 
                    onClick={handleImportRecipe}
                    disabled={!importUrl || importingRecipe}
                    className="bg-stone-900 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-stone-800 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {importingRecipe ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
                    Import
                  </button>
                </div>
              </div>

              {favorites.length > 0 ? (
                <div className="space-y-4">
                  {favorites.map(meal => (
                    <div key={meal.id} className="bg-white rounded-2xl p-6 border border-stone-200 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex gap-2 flex-wrap">
                            <span className="text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md text-stone-600 bg-stone-100">
                              {meal.type === 'breakfast' ? 'Breakfast' : 'Dinner'}
                            </span>
                            <span className="text-xs font-bold uppercase tracking-wider text-stone-600 bg-stone-100 px-2 py-1 rounded-md">
                              {meal.portions} Portions
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => toggleFavorite(meal)}
                              className="p-1.5 rounded-full transition-colors text-rose-500 hover:bg-rose-50"
                              title="Remove from favorites"
                            >
                              <Heart size={18} fill="currentColor" />
                            </button>
                          </div>
                        </div>
                        <h3 className="text-xl font-semibold mb-1">{meal.title}</h3>
                        <p className="text-stone-500 text-sm mb-4 line-clamp-2">{meal.description}</p>
                        
                        <div className="flex items-center justify-between mt-4 pt-4 border-t border-stone-100">
                          <div className="flex items-center gap-4 text-sm text-stone-500">
                            <span className="flex items-center gap-1"><Clock size={16} /> {meal.prepTime + meal.cookTime} min total</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => handleViewMealGroceries(meal)}
                              className="bg-stone-100 text-stone-700 p-2 rounded-xl hover:bg-stone-200 transition-colors"
                              title="Grocery List for this meal"
                            >
                              <ShoppingCart size={16} />
                            </button>
                            <button 
                              onClick={() => startCooking(meal)}
                              className="bg-stone-900 text-white px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-stone-800 transition-colors"
                            >
                              <Play size={16} fill="currentColor" />
                              Start Cooking
                            </button>
                          </div>
                        </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10">
                  <p className="text-stone-400">You haven't saved any favorites yet. Click the heart icon on any recipe to save it here!</p>
                </div>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 pb-safe">
        <div className="max-w-md mx-auto flex">
          <button 
            onClick={() => setActiveTab('plan')}
            className={`flex-1 py-4 flex flex-col items-center gap-1 text-xs font-medium transition-colors ${activeTab === 'plan' ? 'text-emerald-600' : 'text-stone-400 hover:text-stone-600'}`}
          >
            <Calendar size={24} />
            Meal Plan
          </button>
          <button 
            onClick={() => {
              if (Object.keys(groceries).length === 0 && meals.length > 0) {
                handleGenerateGroceries();
              } else {
                setActiveTab('groceries');
              }
            }}
            className={`flex-1 py-4 flex flex-col items-center gap-1 text-xs font-medium transition-colors ${activeTab === 'groceries' ? 'text-emerald-600' : 'text-stone-400 hover:text-stone-600'}`}
          >
            <ShoppingCart size={24} />
            Groceries
          </button>
          <button 
            onClick={() => setActiveTab('pantry')}
            className={`flex-1 py-4 flex flex-col items-center gap-1 text-xs font-medium transition-colors ${activeTab === 'pantry' ? 'text-emerald-600' : 'text-stone-400 hover:text-stone-600'}`}
          >
            <Utensils size={24} />
            Pantry
          </button>
          <button 
            onClick={() => setActiveTab('favorites')}
            className={`flex-1 py-4 flex flex-col items-center gap-1 text-xs font-medium transition-colors ${activeTab === 'favorites' ? 'text-emerald-600' : 'text-stone-400 hover:text-stone-600'}`}
          >
            <Heart size={24} />
            Favorites
          </button>
        </div>
      </nav>
    </div>
  );
}

function CookingModeView({ meal, onClose }: { meal: Meal, onClose: () => void }) {
  const steps = useMemo(() => {
    if (meal.miseEnPlace && meal.miseEnPlace.length > 0) {
      return [
        {
          id: 'mise-en-place',
          instruction: 'Mise en Place (Preparation)',
          parallelTasks: meal.miseEnPlace,
        },
        ...meal.steps
      ];
    }
    return meal.steps;
  }, [meal]);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [timers, setTimers] = useState<{ id: string; label: string; timeLeft: number; isActive: boolean; total: number }[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimers(prev => prev.map(t => {
        if (t.isActive && t.timeLeft > 0) {
          return { ...t, timeLeft: t.timeLeft - 1 };
        }
        if (t.timeLeft === 0 && t.isActive) {
          return { ...t, isActive: false };
        }
        return t;
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const step = steps[currentStepIndex];
  const progress = ((currentStepIndex + 1) / steps.length) * 100;
  const existingTimer = timers.find(t => t.id === step.id);

  return (
    <div className="min-h-screen bg-stone-900 text-white flex flex-col font-sans">
      {/* Header */}
      <header className="p-4 flex items-center justify-between border-b border-stone-800">
        <button onClick={onClose} className="text-stone-400 hover:text-white p-2">
          <ArrowLeft size={24} />
        </button>
        <div className="text-center">
          <h2 className="font-semibold text-lg">{meal.title}</h2>
          <p className="text-xs text-emerald-400 font-medium">Step {currentStepIndex + 1} of {steps.length}</p>
        </div>
        <div className="w-10"></div> {/* Spacer for centering */}
      </header>

      {/* Floating Timers Dock */}
      {timers.length > 0 && (
        <div className="bg-stone-950 border-b border-stone-800 p-4 flex gap-4 overflow-x-auto no-scrollbar">
          {timers.map(t => {
            const mins = Math.floor(t.timeLeft / 60);
            const secs = t.timeLeft % 60;
            return (
              <div key={t.id} className={`flex items-center gap-3 px-4 py-2 rounded-xl border shrink-0 ${t.timeLeft === 0 ? 'bg-emerald-900/40 border-emerald-500/50 text-emerald-400' : 'bg-stone-800 border-stone-700'}`}>
                <Clock size={16} className={t.isActive ? 'animate-pulse text-amber-400' : ''} />
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-stone-400 font-bold truncate w-24">{t.label}</div>
                  <div className="font-mono font-semibold">
                    {mins}:{secs.toString().padStart(2, '0')}
                  </div>
                </div>
                <button 
                  onClick={() => setTimers(prev => prev.filter(x => x.id !== t.id))}
                  className="ml-2 p-1 text-stone-500 hover:text-stone-300"
                >
                  <X size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Progress Bar */}
      <div className="h-1.5 bg-stone-800 w-full">
        <motion.div 
          className="h-full bg-emerald-500"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col p-6 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div 
            key={currentStepIndex}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1 flex flex-col"
          >
            <div className="flex-1">
              <h1 className="text-3xl md:text-4xl font-semibold leading-tight mb-8">
                {step.instruction}
              </h1>

              {step.durationMinutes && (
                <div className="bg-stone-800/50 rounded-2xl p-6 border border-stone-700 mb-8 flex flex-col sm:flex-row sm:items-center gap-6 justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-4 rounded-full transition-colors ${existingTimer?.isActive ? 'bg-amber-500/20 text-amber-400 animate-pulse' : existingTimer && existingTimer.timeLeft === 0 ? 'bg-stone-700 text-stone-500' : 'bg-emerald-500/20 text-emerald-400'}`}>
                      <Clock size={32} />
                    </div>
                    <div>
                      <p className="text-sm text-stone-400 uppercase tracking-wider font-bold mb-1">
                        {existingTimer && existingTimer.timeLeft === 0 ? 'Timer Done' : 'Duration'}
                      </p>
                      <div className="font-mono text-3xl font-semibold tracking-tight">
                        {existingTimer 
                          ? `${Math.floor(existingTimer.timeLeft / 60)}:${(existingTimer.timeLeft % 60).toString().padStart(2, '0')}`
                          : `${step.durationMinutes}:00`
                        }
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        if (!existingTimer) {
                          setTimers(prev => [...prev, { 
                            id: step.id, 
                            label: step.instruction.split(' ').slice(0, 3).join(' ') + '...', 
                            timeLeft: step.durationMinutes! * 60, 
                            isActive: true, 
                            total: step.durationMinutes! * 60 
                          }]);
                        } else {
                          setTimers(prev => prev.map(t => t.id === step.id ? { ...t, isActive: !t.isActive } : t));
                        }
                      }} 
                      className={`px-6 py-3 rounded-xl font-bold text-sm transition-colors flex-1 sm:flex-none ${existingTimer?.isActive ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30' : existingTimer?.timeLeft === 0 ? 'bg-stone-700 text-stone-500 cursor-not-allowed' : 'bg-emerald-500 text-stone-900 hover:bg-emerald-400'}`}
                      disabled={existingTimer?.timeLeft === 0}
                    >
                      {existingTimer?.isActive ? 'Pause Timer' : existingTimer?.timeLeft === 0 ? 'Finished' : existingTimer ? 'Resume Timer' : 'Start Timer'}
                    </button>
                    {existingTimer && existingTimer.timeLeft !== existingTimer.total && (
                      <button 
                        onClick={() => {
                          setTimers(prev => prev.map(t => t.id === step.id ? { ...t, timeLeft: t.total, isActive: false } : t));
                        }} 
                        className="px-4 py-3 rounded-xl font-medium text-sm text-stone-400 hover:text-white hover:bg-stone-700 transition-colors"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              )}

              {step.parallelTasks && step.parallelTasks.length > 0 && (
                <div className="bg-emerald-900/20 border border-emerald-800/50 rounded-2xl p-6">
                  <h3 className="text-emerald-400 font-semibold mb-4 flex items-center gap-2">
                    <RefreshCw size={18} />
                    {step.id === 'mise-en-place' ? 'Prepare these before cooking:' : 'While you wait, do this:'}
                  </h3>
                  <ul className="space-y-3">
                    {step.parallelTasks.map((task, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <div className="mt-1 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                        <span className="text-stone-200 text-lg">{task}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer Controls */}
      <footer className="p-6 border-t border-stone-800 bg-stone-900/80 backdrop-blur-md">
        <div className="max-w-md mx-auto flex gap-4">
          <button 
            onClick={() => setCurrentStepIndex(prev => Math.max(0, prev - 1))}
            disabled={currentStepIndex === 0}
            className="px-6 py-4 rounded-2xl bg-stone-800 text-white font-medium disabled:opacity-50 hover:bg-stone-700 transition-colors"
          >
            Back
          </button>
          <button 
            onClick={() => {
              if (currentStepIndex === steps.length - 1) {
                onClose();
              } else {
                setCurrentStepIndex(prev => Math.min(steps.length - 1, prev + 1));
              }
            }}
            className="flex-1 py-4 rounded-2xl bg-emerald-500 text-stone-900 font-bold text-lg flex items-center justify-center gap-2 hover:bg-emerald-400 transition-colors shadow-lg shadow-emerald-500/20"
          >
            {currentStepIndex === steps.length - 1 ? (
              <>Finish Cooking <CheckCircle2 size={20} /></>
            ) : (
              <>Next Step <ArrowRight size={20} /></>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
