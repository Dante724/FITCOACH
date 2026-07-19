import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ToastProvider } from "@/context/ToastContext";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import FocusSelect from "@/pages/FocusSelect";
import Dashboard from "@/pages/Dashboard";
import Booking from "@/pages/Booking";
import Progress from "@/pages/Progress";
import FoodTrack from "@/pages/FoodTrack";
import BodyScan from "@/pages/BodyScan";
import Workouts from "@/pages/Workouts";
import Membership from "@/pages/Membership";

function Loader() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="spinner" />
    </div>
  );
}

function RequireAuth({ children, requireFocus }) {
  const { user, loading } = useAuth();
  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" replace />;
  if (requireFocus && !user.focus) return <Navigate to="/focus" replace />;
  return children;
}

function AppRouter() {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) return <AuthCallback />;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/focus" element={<RequireAuth><FocusSelect /></RequireAuth>} />
      <Route element={<RequireAuth requireFocus><Layout /></RequireAuth>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/workouts" element={<Workouts />} />
        <Route path="/booking" element={<Booking />} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/food" element={<FoodTrack />} />
        <Route path="/bodyscan" element={<BodyScan />} />
        <Route path="/membership" element={<Membership />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <AppRouter />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}
