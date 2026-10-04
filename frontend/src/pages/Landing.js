import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import * as Icons from "lucide-react";
import Logo from "@/components/Logo";
import ConsultForm from "@/components/ConsultForm";

const IMG = {
  strength: "https://images.unsplash.com/photo-1637430308606-86576d8fef3c?crop=entropy&cs=srgb&fm=jpg&q=80&w=800",
  muscle: "https://images.unsplash.com/photo-1672344048213-76b6e77304bd?crop=entropy&cs=srgb&fm=jpg&q=80&w=800",
  yoga: "https://images.unsplash.com/photo-1769416945759-4660fd121172?crop=entropy&cs=srgb&fm=jpg&q=80&w=800",
  nutrition: "https://images.unsplash.com/photo-1644704170910-a0cdf183649b?crop=entropy&cs=srgb&fm=jpg&q=80&w=800",
};

const PROGRAMS = [
  { title: "Fat Loss", img: IMG.nutrition, desc: "Training and a nutrition plan built around Indian food, approved and adjusted by your own coach." },
  { title: "Muscle Gain", img: IMG.muscle, desc: "Progressive training and the right amount of food to add lean muscle, week after week." },
  { title: "Yoga", img: IMG.yoga, desc: "A practice designed for your body by an experienced yoga coach, with on-device pose checks." },
  { title: "Fitness + Yoga", img: IMG.strength, desc: "A fitness coach and a yoga coach working together on the same goal." },
];

const STEPS = [
  { n: "01", title: "Tell us your goal", desc: "A two-minute questionnaire about your body, diet, schedule and injuries." },
  { n: "02", title: "Meet your coach", desc: "We match you with a certified coach for your goal. They're one message away, in the app." },
  { n: "03", title: "Follow an approved plan", desc: "AI drafts it in minutes. Your coach checks and approves every plan, then adjusts it as you progress." },
];

const FALLBACK_PLANS = [
  { name: "Monthly", price: "15,000", period: "per month", features: ["Your own assigned coach", "AI food tracking", "1 video session a week", "Progress tracking"] },
  { name: "Quarterly", price: "30,000", period: "per 3 months", featured: true, features: ["Everything in Monthly", "Coach-approved nutrition plan", "2 video sessions a week", "Priority booking"] },
  { name: "Annual", price: "85,000", period: "per year", features: ["Everything in Quarterly", "Quarterly assessments", "Unlimited video sessions", "Best value"] },
];

const FACTS = [
  ["UserRound", "A real coach", "Assigned to you, not a chatbot."],
  ["BadgeCheck", "Every plan approved", "Nothing reaches you unchecked."],
  ["ShieldCheck", "Private by design", "Pose videos never leave your phone."],
];

export default function Landing() {
  const navigate = useNavigate();
  const go = () => navigate("/login");
  const [pricing, setPricing] = useState({ plans: FALLBACK_PLANS, session: 1000, trial: 7 });
  useEffect(() => {
    api.get("/plans").then(({ data }) => {
      if (!data.plans?.length) return;
      const term = (p) => { const u = { weekly: "week", monthly: "month", yearly: "year" }[p.period] || "month"; return p.interval > 1 ? `per ${p.interval} ${u}s` : `per ${u}`; };
      setPricing({
        plans: data.plans.map((p) => ({ name: p.name, price: Number(p.price_inr).toLocaleString("en-IN"), period: term(p), featured: p.featured, features: p.features || [] })),
        session: data.session_price_inr, trial: data.trial_days,
      });
    }).catch(() => {});
  }, []);

  return (
    <div className="site">
      <header className="site-nav">
        <div className="site-wrap site-nav-inner">
          <Logo />
          <nav className="site-links">
            <a href="#programs">Programmes</a>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#consult">Free consultation</a>
          </nav>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" data-testid="nav-login-btn" onClick={go}>Log in</button>
            <button className="btn btn-primary" data-testid="nav-signup-btn" onClick={go}>Get started</button>
          </div>
        </div>
      </header>

      {new URLSearchParams(window.location.search).get("deleted") && (
        <div className="site-wrap" style={{ paddingTop: 16 }}>
          <div className="clay-inset row" style={{ padding: "12px 16px", gap: 10, fontSize: 14 }} role="status" data-testid="deleted-banner">
            <Icons.CircleCheck size={17} color="var(--teal)" style={{ flexShrink: 0 }} /> Your account and personal data have been deleted. Thanks for training with us.
          </div>
        </div>
      )}
      <section className="site-wrap site-hero fade-up">
        <div className="eyebrow" style={{ marginBottom: 22 }}>Online coaching · Fitness, nutrition & yoga</div>
        <h1>Your own coach.<br /><span className="serif-italic">Plans they actually approve.</span></h1>
        <p className="site-lead">AI drafts your training and meal plans in minutes. A certified coach checks every one, tracks your progress and is a message away.</p>
        <div className="row-wrap" style={{ marginTop: 32, gap: 10 }}>
          <button className="btn btn-primary" data-testid="hero-signup-btn" onClick={go} style={{ padding: "12px 20px" }}>Start training <Icons.ArrowRight size={16} /></button>
          <a href="#consult" className="btn btn-ghost" data-testid="hero-consult-btn" style={{ padding: "12px 20px" }}><Icons.PhoneCall size={16} /> Book a free consultation</a>
        </div>
        <div className="site-grid-3" style={{ marginTop: 72 }}>
          {FACTS.map(([icon, title, desc]) => {
            const Icon = Icons[icon];
            return (
              <div key={title} className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                <Icon size={18} strokeWidth={1.75} color="var(--gold)" style={{ marginTop: 2, flexShrink: 0 }} />
                <div><div style={{ fontWeight: 500 }}>{title}</div><div style={{ fontSize: 14, color: "var(--text-2)" }}>{desc}</div></div>
              </div>
            );
          })}
        </div>
      </section>

      <section id="programs" className="site-section">
        <div className="site-wrap">
          <h2>Programmes</h2>
          <p style={{ color: "var(--text-2)", marginBottom: 32 }}>Pick a goal. We'll match the right coach to it.</p>
          <div className="site-grid-4">
            {PROGRAMS.map((p) => (
              <div key={p.title}>
                <img className="site-photo" src={p.img} alt={p.title} loading="lazy" />
                <div style={{ fontFamily: "var(--serif)", fontSize: 20, marginTop: 14 }}>{p.title}</div>
                <div style={{ fontSize: 14, color: "var(--text-2)", marginTop: 4, lineHeight: 1.55 }}>{p.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="site-section band-dark">
        <div className="site-wrap">
          <h2>How it works</h2>
          <p style={{ color: "var(--text-2)", marginBottom: 32 }}>Three steps, then your coach takes it from there.</p>
          <div className="site-grid-3">
            {STEPS.map((s) => (
              <div key={s.n} style={{ borderTop: "1px solid var(--ink)", paddingTop: 16 }}>
                <div style={{ fontFamily: "var(--serif)", fontSize: 28, color: "var(--gold)", fontStyle: "italic" }}>{s.n}</div>
                <div style={{ fontFamily: "var(--serif)", fontSize: 22, marginTop: 6 }}>{s.title}</div>
                <div style={{ fontSize: 14, color: "var(--text-2)", marginTop: 6, lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="consult" className="site-section">
        <div className="site-wrap consult-grid">
          <div>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Free · 15 minutes · No obligation</div>
            <h2>Talk to a coach first.</h2>
            <p style={{ color: "var(--text-2)", margin: "8px 0 24px", lineHeight: 1.6, maxWidth: 420 }}>
              Not sure which programme fits? Book a free call. A coach will ask about your goal, routine and any injuries, and tell you honestly what to expect.
            </p>
            <div className="stack" style={{ gap: 14 }}>
              {[["PhoneCall", "We call you", "At the time you pick — no apps or links needed."],
                ["ClipboardCheck", "Get a clear plan", "What training and food would look like for you."],
                ["Gift", `Then try it free`, pricing.trial > 0 ? `Start a ${pricing.trial}-day free trial if it feels right.` : "Join only if it feels right."]].map(([icon, title, desc]) => {
                const Icon = Icons[icon];
                return (
                  <div key={title} className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                    <Icon size={18} strokeWidth={1.75} color="var(--gold)" style={{ marginTop: 2, flexShrink: 0 }} />
                    <div><div style={{ fontWeight: 500 }}>{title}</div><div style={{ fontSize: 14, color: "var(--text-2)" }}>{desc}</div></div>
                  </div>
                );
              })}
            </div>
          </div>
          <ConsultForm />
        </div>
      </section>

      <section id="pricing" className="site-section">
        <div className="site-wrap">
          <h2>Pricing</h2>
          <p style={{ color: "var(--text-2)", marginBottom: 32 }}>
            {pricing.trial > 0 ? `Start with a ${pricing.trial}-day free trial, including an intro video session. ` : ""}Extra sessions are ₹{Number(pricing.session).toLocaleString("en-IN")} each.
          </p>
          <div className="site-grid-3">
            {pricing.plans.map((p) => (
              <div key={p.name} className={p.featured ? "clay card-dark" : "clay"} style={{ padding: 26, display: "flex", flexDirection: "column" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 500 }}>{p.name}</div>
                  {p.featured && <span className="chip" style={{ background: "rgba(201,164,92,0.18)", color: "var(--ink)" }}>Most popular</span>}
                </div>
                <div style={{ marginTop: 18 }}>
                  <span style={{ fontFamily: "var(--serif)", fontSize: 40, fontWeight: 400 }}>₹{p.price}</span>
                  <span style={{ fontSize: 14, color: "var(--text-3)", marginLeft: 6 }}>{p.period}</span>
                </div>
                <ul style={{ listStyle: "none", margin: "20px 0 24px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                  {p.features.map((f) => (
                    <li key={f} className="row" style={{ fontSize: 14, color: "var(--text-2)", gap: 8 }}><Icons.Check size={15} color="var(--gold)" /> {f}</li>
                  ))}
                </ul>
                <button className={p.featured ? "btn btn-primary" : "btn btn-ghost"} data-testid={`pricing-${p.name.toLowerCase()}`} onClick={go} style={{ width: "100%" }}>Choose {p.name}</button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="site-section band-dark">
        <div className="site-wrap" style={{ textAlign: "center" }}>
          <h2>Ready when you are.</h2>
          <p style={{ color: "var(--text-2)", margin: "4px 0 24px" }}>Create an account and meet your coach this week.</p>
          <button className="btn btn-primary" data-testid="cta-signup-btn" onClick={go} style={{ padding: "12px 22px" }}>Get started <Icons.ArrowRight size={16} /></button>
        </div>
      </section>

      <footer style={{ borderTop: "1px solid var(--border)" }}>
        <div className="site-wrap row" style={{ justifyContent: "space-between", padding: "24px", flexWrap: "wrap" }}>
          <Logo size={22} />
          <div className="row" style={{ gap: 18, fontSize: 13, color: "var(--text-3)" }}>
            <Link to="/privacy" style={{ color: "inherit" }}>Privacy</Link>
            <Link to="/terms" style={{ color: "inherit" }}>Terms</Link>
            <Link to="/refunds" style={{ color: "inherit" }}>Refunds</Link>
            <Link to="/contact" style={{ color: "inherit" }}>Contact</Link>
            <span>© {new Date().getFullYear()} FitCoach</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
