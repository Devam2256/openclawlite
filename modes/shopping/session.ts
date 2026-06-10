import { ShoppingSession, QuestionSession } from "./types.ts";

export const shoppingSessions = new Map<number, ShoppingSession>();
export const questionSessions = new Map<number, QuestionSession>();

// Shopping session helpers
export function getSession(chatId: number): ShoppingSession | undefined {
  return shoppingSessions.get(chatId);
}

export function setSession(chatId: number, session: ShoppingSession): void {
  shoppingSessions.set(chatId, session);
}

export function deleteSession(chatId: number): void {
  shoppingSessions.delete(chatId);
}

export function hasSession(chatId: number): boolean {
  return shoppingSessions.has(chatId);
}

// Question session helpers
export function getQuestionSession(chatId: number): QuestionSession | undefined {
  return questionSessions.get(chatId);
}

export function setQuestionSession(chatId: number, session: QuestionSession): void {
  questionSessions.set(chatId, session);
}

export function deleteQuestionSession(chatId: number): void {
  questionSessions.delete(chatId);
}

export function hasQuestionSession(chatId: number): boolean {
  return questionSessions.has(chatId);
}
