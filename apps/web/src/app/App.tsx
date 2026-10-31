import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "../components/Layout";
import { Loading } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import LoginPage from "../features/auth/LoginPage";
import DashboardPage from "../features/dashboard/DashboardPage";

const ProjectsPage = lazy(() => import("../features/projects/ProjectsPage"));
const ProjectDetailPage = lazy(() => import("../features/projects/ProjectDetailPage"));
const DesignerPage = lazy(() => import("../features/architectures/DesignerPage"));
const JobPage = lazy(() => import("../features/training/JobPage"));
const JobsPage = lazy(() => import("../features/training/JobsPage"));
const ComparePage = lazy(() => import("../features/evaluation/ComparePage"));
const ReportPage = lazy(() => import("../features/reports/ReportPage"));
const FundamentalsPage = lazy(() => import("../features/fundamentals/FundamentalsPage"));
const FamiliesPage = lazy(() => import("../features/fundamentals/FamiliesPage"));
const AdminPage = lazy(() => import("../features/administration/AdminPage"));

function Protected() {
  const { me, loading } = useAuth();
  if (loading) return <div style={{ padding: 40 }}><Loading label="Verificando sesión…" /></div>;
  if (!me) return <LoginPage />;
  return <Layout />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div style={{ padding: 40 }}><Loading /></div>}>
        <Routes>
          <Route element={<Protected />}>
            <Route index element={<DashboardPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:id" element={<ProjectDetailPage />} />
            <Route path="projects/:id/designer" element={<DesignerPage />} />
            <Route path="projects/:id/compare" element={<ComparePage />} />
            <Route path="projects/:id/report" element={<ReportPage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="jobs/:id" element={<JobPage />} />
            <Route path="fundamentals" element={<FundamentalsPage />} />
            <Route path="families" element={<FamiliesPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
