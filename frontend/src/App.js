import "@/App.css";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ToastProvider } from "@/context/ToastContext";
import { roleHome } from "@/lib/focus";
import Layout from "@/components/Layout";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import FocusSelect from "@/pages/FocusSelect";
import Dashboard from "@/pages/Dashboard";
import Booking from "@/pages/Booking";
import Progress from "@/pages/Progress";
import FoodTrack from "@/pages/FoodTrack";
import MealPlans from "@/pages/MealPlans";
import Workouts from "@/pages/Workouts";
import Membership from "@/pages/Membership";
import AdminPanel from "@/pages/AdminPanel";
import TrainerDashboard from "@/pages/TrainerDashboard";
import TrainerAvailability from "@/pages/TrainerAvailability";
import ClientDetail from "@/pages/ClientDetail";
import Messages from "@/pages/Messages";
import LiveCall, { BookedCall } from "@/pages/VideoCall";
import Profile from "@/pages/Profile";
import AdminBilling from "@/pages/AdminBilling";
import MembershipGate from "@/components/MembershipGate";
import { rememberReferral } from "@/lib/membership";
import Legal from "@/pages/Legal";
import { ForgotPassword, ResetPassword } from "@/pages/PasswordReset";
import { ConsentScreen } from "@/components/Privacy";
import ForcedPasswordChange from "@/components/ForcedPasswordChange";

const AdminLeads = lazy(() => import("@/pages/AdminLeads"));
const CallCheck = lazy(() => import("@/pages/CallCheck"));
const AdminInsights = lazy(() => import("@/pages/AdminInsights"));

// Pose tracking pulls in MediaPipe, so only load it when a client opens Pose Check.
const PoseCheck = lazy(() => import("@/pages/PoseCheck"));

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
  if (user.must_change_password) return <ForcedPasswordChange />;
  if (user.role === "client" && !user.consents?.health_data) return <ConsentScreen />;
  if (requireFocus && user.role === "client" && !user.focus) return <Navigate to="/focus" replace />;
  return children;
}

// The service worker posts {type:"navigate"} when a notification is tapped while the app is open.
function NotificationRouter() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;
    const onMessage = (e) => { if (e.data?.type === "navigate" && e.data.url) navigate(e.data.url); };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate]);
  return null;
}

// /r/CODE — remember a friend's referral code and send the visitor to sign up.
function ReferralLanding() {
  const navigate = useNavigate();
  const { code } = useParams();
  useEffect(() => {
    if (/^[A-Za-z0-9]{4,12}$/.test(code || "")) rememberReferral(code);
    navigate("/login?signup=1", { replace: true });
  }, [code, navigate]);
  return null;
}

function AppRouter() {

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/privacy" element={<Legal page="privacy" />} />
      <Route path="/terms" element={<Legal page="terms" />} />
      <Route path="/refunds" element={<Legal page="refunds" />} />
      <Route path="/contact" element={<Legal page="contact" />} />
      <Route path="/r/:code" element={<ReferralLanding />} />
      <Route path="/focus" element={<RequireAuth roles={CLIENT_ROLES}><FocusSelect /></RequireAuth>} />
      <Route path="/call/live/:callId" element={<RequireAuth><LiveCall /></RequireAuth>} />
      <Route path="/call/:bookingId" element={<RequireAuth><BookedCall /></RequireAuth>} />

      <Route element={<RequireAuth roles={CLIENT_ROLES} requireFocus><Layout /></RequireAuth>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/workouts" element={<MembershipGate feature="workouts"><Workouts kind="workout" /></MembershipGate>} />
        <Route path="/yoga" element={<MembershipGate feature="workouts"><Workouts kind="yoga" /></MembershipGate>} />
        <Route path="/messages" element={<MembershipGate feature="messages"><Messages /></MembershipGate>} />
        <Route path="/pose-check" element={<MembershipGate feature="pose_check"><Suspense fallback={<div className="spinner" style={{ margin: "80px auto" }} />}><PoseCheck /></Suspense></MembershipGate>} />
        <Route path="/booking" element={<Booking />} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/food" element={<MembershipGate feature="food"><FoodTrack /></MembershipGate>} />
        <Route path="/meal-plans" element={<MembershipGate feature="meal_plans"><MealPlans /></MembershipGate>} />
        <Route path="/membership" element={<Membership />} />
      </Route>

      <Route element={<RequireAuth roles={ADMIN_ROLES}><Layout /></RequireAuth>}>
        <Route path="/admin" element={<AdminPanel />} />
        <Route path="/admin/billing" element={<AdminBilling />} />
        <Route path="/admin/leads" element={<Suspense fallback={<div className="spinner" style={{ margin: "80px auto" }} />}><AdminLeads /></Suspense>} />
        <Route path="/admin/insights" element={<Suspense fallback={<div className="spinner" style={{ margin: "80px auto" }} />}><AdminInsights /></Suspense>} />
        <Route path="/admin/clients/:clientId" element={<ClientDetail />} />
      </Route>

      <Route element={<RequireAuth roles={TRAINER_ROLES}><Layout /></RequireAuth>}>
        <Route path="/trainer" element={<TrainerDashboard />} />
        <Route path="/trainer/clients/:clientId" element={<ClientDetail />} />
        <Route path="/trainer/availability" element={<TrainerAvailability />} />
      </Route>

      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/profile" element={<Profile />} />
        <Route path="/call-check" element={<Suspense fallback={<div className="spinner" style={{ margin: "80px auto" }} />}><CallCheck /></Suspense>} />
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
            <NotificationRouter />
            <AppRouter />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}
