import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ToastProvider } from "@/context/ToastContext";
import { roleHome } from "@/lib/focus";
import Layout from "@/components/Layout";
import Landing from "@/pages/Landing";
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
import AdminPanel from "@/pages/AdminPanel";
import TrainerDashboard from "@/pages/TrainerDashboard";
import VideoCall from "@/pages/VideoCall";

function Loader() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="spinner" />
    </div>
  );
}

const CLIENT_ROLES = ["client"];
const ADMIN_ROLES = ["admin"];
const TRAINER_ROLES = ["trainer"];

function RequireAuth({ children, roles, requireFocus }) {
  const { user, loading } = useAuth();
  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={roleHome(user)} replace />;
  if (requireFocus && user.role === "client" && !user.focus) return <Navigate to="/focus" replace />;
  return children;
}

function AppRouter() {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) return <AuthCallback />;

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/focus" element={<RequireAuth roles={CLIENT_ROLES}><FocusSelect /></RequireAuth>} />
      <Route path="/call/:bookingId" element={<RequireAuth><VideoCall /></RequireAuth>} />

      <Route element={<RequireAuth roles={CLIENT_ROLES} requireFocus><Layout /></RequireAuth>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/workouts" element={<Workouts />} />
        <Route path="/booking" element={<Booking />} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/food" element={<FoodTrack />} />
        <Route path="/bodyscan" element={<BodyScan />} />
        <Route path="/membership" element={<Membership />} />
      </Route>

      <Route element={<RequireAuth roles={ADMIN_ROLES}><Layout /></RequireAuth>}>
        <Route path="/admin" element={<AdminPanel />} />
      </Route>

      <Route element={<RequireAuth roles={TRAINER_ROLES}><Layout /></RequireAuth>}>
        <Route path="/trainer" element={<TrainerDashboard />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
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
