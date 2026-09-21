import { lazy, Suspense } from "react";
import ONQOLTrainer from "./ONQOLTrainer";

// /study — учебные сессии резидентов, /study/admin — панель руководителя.
// Остальные адреса открывают прежний свободный тренажёр без изменений.
const StudyApp = lazy(() => import("./study/StudyApp"));
const AdminPanel = lazy(() => import("./study/AdminPanel"));

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/study/admin") return <Suspense fallback={null}><AdminPanel /></Suspense>;
  if (path === "/study") return <Suspense fallback={null}><StudyApp /></Suspense>;
  return <ONQOLTrainer />;
}
