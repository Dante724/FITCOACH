import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { MealPlanView, ApprovedBy } from "@/components/PlanView";
import { api } from "@/lib/api";
import { askCoachPath } from "@/lib/focus";

// The client's nutrition plan. Only their assigned coach can create or change it.
export default function MealPlans() {
  const navigate = useNavigate();
  const [plan, setPlan] = useState(undefined);
  useEffect(() => { api.get("/workouts/plan", { params: { type: "meal" } }).then((r) => setPlan(r.data.plan)).catch(() => setPlan(null)); }, []);

  return (
    <div>
      <PageHeader eyebrow="Nutrition" title="My Nutrition" subtitle="Your daily eating plan, set by your coach. Log what you actually eat in Food Log so they can adjust it."
        action={plan ? (
          <button className="btn btn-ghost" data-testid="ask-coach-meal"
            onClick={() => navigate(askCoachPath(plan.approved_by, { type: "plan", id: plan.id, label: plan.content.title }))}>
            <Icons.MessageCircle size={17} /> Ask coach
          </button>
        ) : null} />

      {plan === undefined && <div className="spinner" style={{ margin: "60px auto" }} />}
      {plan === null && (
        <div className="clay fade-up empty" data-testid="meal-pending" style={{ padding: "56px 20px" }}>
          <Icons.UtensilsCrossed size={38} style={{ opacity: 0.55, marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Your coach is preparing your nutrition plan</div>
          <div style={{ maxWidth: 420, margin: "0 auto", lineHeight: 1.6 }}>Meanwhile, keep logging your meals in Food Log — it helps your coach set the right targets.</div>
          <button className="btn btn-primary" onClick={() => navigate("/food")} style={{ marginTop: 18 }}><Icons.Utensils size={17} /> Open Food Log</button>
        </div>
      )}
      {plan && (
        <div className="clay fade-up" style={{ padding: 22 }}>
          <h3 className="display" style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{plan.content.title}</h3>
          {plan.content.summary && <p style={{ fontSize: 13.5, color: "var(--text-2)", marginBottom: 12, lineHeight: 1.6 }}>{plan.content.summary}</p>}
          <div style={{ marginBottom: 18 }}><ApprovedBy plan={plan} /></div>
          <MealPlanView content={plan.content} />
        </div>
      )}
    </div>
  );
}
