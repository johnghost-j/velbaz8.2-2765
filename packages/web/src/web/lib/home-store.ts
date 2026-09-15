import { create } from 'zustand';

// Persistent store for home page — survives navigation
interface HomeState {
  suggestedIdeas: string[];
  companies: any[];
  loaded: boolean;
  setSuggestedIdeas: (ideas: string[]) => void;
  setCompanies: (cos: any[]) => void;
  setLoaded: () => void;
}

// Default ideas shown instantly before API loads
const DEFAULT_IDEAS = [
  'An AI agent that automates customer support for e-commerce stores',
  'A SaaS that manages freelancer invoices, contracts and payments',
  'A micro-investment app that rounds up purchases and invests the change',
];

export const useHomeStore = create<HomeState>((set) => ({
  suggestedIdeas: DEFAULT_IDEAS,
  companies: [],
  loaded: false,
  setSuggestedIdeas: (ideas) => set({ suggestedIdeas: ideas }),
  setCompanies: (cos) => set({ companies: cos }),
  setLoaded: () => set({ loaded: true }),
}));
