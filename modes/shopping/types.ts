export interface Platform {
  name: string;
  searchUrl: string;
  category: string[];
}

export interface Product {
  name: string;
  price: number;
  currency: string;
  url: string;
  platform: string;
  imageUrl?: string;
}

export interface QuestionSession {
  chatId: number;
  originalQuery: string;
  questions: string[];
  answers: string[];
  currentQuestionIndex: number;
  createdAt: Date;
}

export interface ShoppingSession {
  chatId: number;
  query: string;
  category: string;
  results: Product[];
  top5: Product[];
  createdAt: Date;
  status: "asking_questions" | "searching" | "done";
  questionSession?: QuestionSession;
}
