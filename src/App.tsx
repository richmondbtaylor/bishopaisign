import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, RequireAuth } from "@/hooks/useAuth";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import DocumentEditor from "./pages/DocumentEditor";
import DocumentView from "./pages/DocumentView";
import SignDocument from "./pages/SignDocument";
import Templates from "./pages/Templates";
import ResetPassword from "./pages/ResetPassword";
import Unsubscribe from "./pages/Unsubscribe";
import AdminEmails from "./pages/AdminEmails";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/sign/:token" element={<SignDocument />} />
            <Route path="/unsubscribe" element={<Unsubscribe />} />
            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <Dashboard />
                </RequireAuth>
              }
            />
            <Route
              path="/documents/new"
              element={
                <RequireAuth>
                  <DocumentEditor />
                </RequireAuth>
              }
            />
            <Route
              path="/documents/:id"
              element={
                <RequireAuth>
                  <DocumentView />
                </RequireAuth>
              }
            />
            <Route
              path="/documents/:id/edit"
              element={
                <RequireAuth>
                  <DocumentEditor />
                </RequireAuth>
              }
            />
            <Route
              path="/templates"
              element={
                <RequireAuth>
                  <Templates />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/emails"
              element={
                <RequireAuth>
                  <AdminEmails />
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
