import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import Logo from "@/components/Logo";

const IMG = {
  strength: "https://images.unsplash.com/photo-1637430308606-86576d8fef3c?crop=entropy&cs=srgb&fm=jpg&q=80&w=800",
  muscle: "https://images.unsplash.com/photo-1672344048213-76b6e77304bd?crop=entropy&cs=srgb&fm=jpg&q=80&w=800",
  yoga: "https://images.unsplash.com/photo-1769416945759-4660fd121172?crop=entropy&cs=srgb&fm=jpg&q=80&w=800",
  nutrition: "https://images.unsplash.com/photo-1644704170910-a0cdf183649b?crop=entropy&cs=srgb&fm=jpg&q=80&w=800",
};

const PROGRAMS = [
  { title: "Fat Loss", img: IMG.nutrition, desc: "Training and a nutrition plan built around Indian food, approved and adjusted by your own coach." },
  { title: "Muscle Gain", img: IMG.muscle, desc: "Progressive training and the right amount of food to add lean muscle, week after week." },
  { title: "Yoga", img: IMG.yoga, desc: "A practice designed for your body by a certified yoga coach, with on-device pose checks." },
  { title: "Fitness + Yoga", img: IMG.strength, desc: "A fitness coach and a yoga coach working together on the same goal." },
];

const STEPS = [
  { n: "01", title: "Tell us your goal", desc: "A two-minute questionnaire about your body, diet, schedule and injuries." },
  { n: "02", title: "Meet your coach", desc: "We match you with a certified coach for your goal. They're one message away, in the app." },
  { n: "03", title: "Follow an approved plan", desc: "AI drafts it in minutes. Your coach checks and approves every plan, then adjusts it as you progress." },
];

const PLANS = [
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

  return (
    <div className="site">
      <header className="site-nav">
        <div className="site-wrap site-nav-inner">
          <Logo />
          <nav className="site-links">
            <a href="#programs">Programmes</a>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" data-testid="nav-login-btn" onClick={go}>Log in</button>
            <button className="btn btn-primary" data-testid="nav-signup-btn" onClick={go}>Get started</button>
          </div>
        </div>
      </header>

      <section className="site-wrap site-hero fade-up">
        <div className="chip chip-neutral" style={{ marginBottom: 24 }}>Online coaching · Fitness, nutrition & yoga</div>
        <h1>Your own coach.<br /><span style={{ color: "var(--text-3)" }}>Plans they actually approve.</span></h1>
        <p className="site-lead">AI drafts your training and meal plans in minutes. A certified coach checks every one, tracks your progress and is a message away.</p>
        <div className="row-wrap" style={{ marginTop: 32, gap: 10 }}>
          <button className="btn btn-primary" data-testid="hero-signup-btn" onClick={go} style={{ padding: "12px 20px" }}>Start training <Icons.ArrowRight size={16} /></button>
          <a href="#how" className="btn btn-ghost" style={{ padding: "12px 20px" }}>How it works</a>
        </div>
        <div className="site-grid-3" style={{ marginTop: 72 }}>
          {FACTS.map(([icon, title, desc]) => {
            const Icon = Icons[icon];
            return (
              <div key={title} className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                <Icon size={18} strokeWidth={1.75} style={{ marginTop: 2, flexShrink: 0 }} />
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
                <div style={{ fontWeight: 500, marginTop: 14 }}>{p.title}</div>
                <div style={{ fontSize: 14, color: "var(--text-2)", marginTop: 4, lineHeight: 1.55 }}>{p.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="site-section">
        <div className="site-wrap">
          <h2>How it works</h2>
          <p style={{ color: "var(--text-2)", marginBottom: 32 }}>Three steps, then your coach takes it from there.</p>
          <div className="site-grid-3">
            {STEPS.map((s) => (
              <div key={s.n} style={{ borderTop: "1px solid var(--ink)", paddingTop: 16 }}>
                <div style={{ fontSize: 13, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>{s.n}</div>
                <div style={{ fontWeight: 500, fontSize: 17, marginTop: 6 }}>{s.title}</div>
                <div style={{ fontSize: 14, color: "var(--text-2)", marginTop: 6, lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="site-section">
        <div className="site-wrap">
          <h2>Pricing</h2>
          <p style={{ color: "var(--text-2)", marginBottom: 32 }}>Pay-as-you-go sessions are ₹1,000 each.</p>
          <div className="site-grid-3">
            {PLANS.map((p) => (
              <div key={p.name} className="clay" style={{ padding: 24, borderColor: p.featured ? "var(--ink)" : undefined, display: "flex", flexDirection: "column" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 500 }}>{p.name}</div>
                  {p.featured && <span className="chip chip-neutral">Most popular</span>}
                </div>
                <div style={{ marginTop: 18 }}>
                  <span style={{ fontSize: 36, fontWeight: 600, letterSpacing: "-0.03em" }}>₹{p.price}</span>
                  <span style={{ fontSize: 14, color: "var(--text-3)", marginLeft: 6 }}>{p.period}</span>
                </div>
                <ul style={{ listStyle: "none", margin: "20px 0 24px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                  {p.features.map((f) => (
                    <li key={f} className="row" style={{ fontSize: 14, color: "var(--text-2)", gap: 8 }}><Icons.Check size={15} color="var(--text)" /> {f}</li>
                  ))}
                </ul>
                <button className={p.featured ? "btn btn-primary" : "btn btn-ghost"} data-testid={`pricing-${p.name.toLowerCase()}`} onClick={go} style={{ width: "100%" }}>Choose {p.name}</button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="site-section">
        <div className="site-wrap" style={{ textAlign: "center" }}>
          <h2>Ready when you are.</h2>
          <p style={{ color: "var(--text-2)", margin: "4px 0 24px" }}>Create an account and meet your coach this week.</p>
          <button className="btn btn-primary" data-testid="cta-signup-btn" onClick={go} style={{ padding: "12px 22px" }}>Get started <Icons.ArrowRight size={16} /></button>
        </div>
      </section>

      <footer style={{ borderTop: "1px solid var(--border)" }}>
        <div className="site-wrap row" style={{ justifyContent: "space-between", padding: "24px", flexWrap: "wrap" }}>
          <Logo size={22} />
          <div style={{ fontSize: 13, color: "var(--text-3)" }}>© {new Date().getFullYear()} FitCoach</div>
        </div>
      </footer>
    </div>
  );
}
