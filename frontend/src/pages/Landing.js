import { Link, useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";

const IMG = {
  hero: "https://images.unsplash.com/photo-1614367674345-f414b2be3e5b?crop=entropy&cs=srgb&fm=jpg&q=85&w=1100",
  strength: "https://images.unsplash.com/photo-1637430308606-86576d8fef3c?crop=entropy&cs=srgb&fm=jpg&q=85&w=800",
  muscle: "https://images.unsplash.com/photo-1672344048213-76b6e77304bd?crop=entropy&cs=srgb&fm=jpg&q=85&w=800",
  yoga: "https://images.unsplash.com/photo-1769416945759-4660fd121172?crop=entropy&cs=srgb&fm=jpg&q=85&w=800",
  nutrition: "https://images.unsplash.com/photo-1644704170910-a0cdf183649b?crop=entropy&cs=srgb&fm=jpg&q=85&w=800",
};

const PROGRAMS = [
  { title: "Strength & Conditioning", img: IMG.strength, icon: "Dumbbell", accent: "#E0603A", desc: "Raw power, speed and athletic capacity through progressive, evidence-based programming." },
  { title: "Muscle Building", img: IMG.muscle, icon: "Flame", accent: "#d8981f", desc: "Hypertrophy-focused training and precise nutrition to add quality lean mass, week after week." },
  { title: "Yoga", img: IMG.yoga, icon: "Flower2", accent: "#9d7cf0", desc: "Mobility, balance and calm with guided vinyasa and restorative flows led by certified instructors." },
  { title: "Fat Loss", img: IMG.nutrition, icon: "HeartPulse", accent: "#17A79C", desc: "Sustainable conditioning and AI-guided nutrition to strip body fat while preserving muscle." },
];

const PLANS = [
  { name: "Monthly", price: "15,000", period: "/month", accent: "#17A79C", features: ["All four programmes", "AI food & body-scan tools", "1 trainer video session / week", "In-app progress tracking"] },
  { name: "Quarterly", price: "30,000", period: "/3 months", accent: "#E0603A", featured: true, features: ["Everything in Monthly", "Priority trainer booking", "2 trainer sessions / week", "AI meal-plan builder"] },
  { name: "Annual", price: "85,000", period: "/year", accent: "#d8981f", features: ["Everything in Quarterly", "Quarterly body assessments", "Unlimited video sessions", "Save vs paying monthly"] },
];

const STEPS = [
  { icon: "UserPlus", title: "Create your account", desc: "Sign up in seconds with email or Google." },
  { icon: "Target", title: "Choose your focus", desc: "Pick a programme tailored to your goal." },
  { icon: "Video", title: "Train with a coach", desc: "Book sessions and meet your trainer on live video." },
];

function Nav() {
  const navigate = useNavigate();
  return (
    <nav className="ld-glass" style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", width: "min(1180px, calc(100% - 28px))", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderRadius: 999 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg, #E0603A, #F28C79)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 16px rgba(224,96,58,0.5)" }}>
          <Icons.Zap size={18} color="#fff" fill="#fff" />
        </div>
        <span className="display" style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>FitCoach</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }} className="ld-nav-links">
        {[["#programs", "Programmes"], ["#how", "How it works"], ["#pricing", "Pricing"]].map(([href, label]) => (
          <a key={href} href={href} style={{ fontSize: 14, fontWeight: 600, color: "#9aa4b4", textDecoration: "none" }}>{label}</a>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="ld-pill ld-pill-ghost" data-testid="nav-login-btn" onClick={() => navigate("/login")} style={{ padding: "9px 18px", fontSize: 14 }}>Log in</button>
        <button className="ld-pill ld-pill-primary" data-testid="nav-signup-btn" onClick={() => navigate("/login")} style={{ padding: "9px 20px", fontSize: 14 }}>Get started</button>
      </div>
    </nav>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const go = () => navigate("/login");

  return (
    <div className="ld">
      <Nav />

      {/* Hero */}
      <header className="ld-hero-grid landing-hero" style={{ maxWidth: 1180, margin: "0 auto", padding: "170px 24px 80px", display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 56, alignItems: "center", minHeight: "88vh" }}>
        <div className="ld-reveal">
          <div className="ld-glass" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 15px", borderRadius: 999, marginBottom: 26, fontSize: 12.5, fontWeight: 700, color: "#F28C79" }}>
            <Icons.Sparkles size={14} /> Coaching · Nutrition · Recovery
          </div>
          <h1 className="display" style={{ fontSize: 68, fontWeight: 800, lineHeight: 0.98, marginBottom: 24, color: "#F5F7FA" }}>
            Your strongest<br />self, <span style={{ background: "linear-gradient(135deg, #E0603A, #F28C79)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>coached.</span>
          </h1>
          <p style={{ fontSize: 17.5, color: "#9aa4b4", lineHeight: 1.75, maxWidth: 500, marginBottom: 36 }}>
            Personal training built around you — strength, yoga, muscle building and fat loss, with AI nutrition tracking, body scans and live video sessions with real coaches.
          </p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 40 }}>
            <button className="ld-pill ld-pill-primary" data-testid="hero-signup-btn" onClick={go} style={{ padding: "16px 32px", fontSize: 16 }}>Start training <Icons.ArrowRight size={18} /></button>
            <a href="#programs" className="ld-pill ld-pill-ghost" style={{ padding: "16px 28px", fontSize: 16, textDecoration: "none" }}>Explore programmes</a>
          </div>
          <div style={{ display: "flex", gap: 32 }}>
            {[["2,400+", "Members trained"], ["4.9", "Avg rating"], ["120+", "Certified coaches"]].map(([n, l]) => (
              <div key={l}>
                <div className="display" style={{ fontSize: 26, fontWeight: 800, color: "#fff" }}>{n}</div>
                <div style={{ fontSize: 12.5, color: "#6b7688" }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="ld-reveal" style={{ position: "relative", animationDelay: "140ms" }}>
          <div className="ld-imgwrap ld-card" style={{ padding: 0, borderRadius: 28 }}>
            <div style={{ position: "relative" }}>
              <img src={IMG.hero} alt="Athlete training" style={{ width: "100%", height: 500, objectFit: "cover", borderRadius: 26, display: "block" }} />
              <div style={{ position: "absolute", inset: 0, borderRadius: 26, background: "linear-gradient(180deg, rgba(10,11,14,0.1), rgba(10,11,14,0.45))" }} />
            </div>
          </div>
          <div className="ld-glass" style={{ position: "absolute", bottom: -20, left: -20, padding: "16px 20px", borderRadius: 18, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(224,96,58,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icons.TrendingUp size={20} color="#F28C79" /></div>
            <div><div className="display" style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>-6.2 kg</div><div style={{ fontSize: 11.5, color: "#8b96ac" }}>Avg 12-week result</div></div>
          </div>
          <div className="ld-glass" style={{ position: "absolute", top: -18, right: -12, padding: "13px 17px", borderRadius: 16, display: "flex", alignItems: "center", gap: 10 }}>
            <Icons.Star size={18} color="#d8981f" fill="#d8981f" />
            <div><div className="display" style={{ fontSize: 17, fontWeight: 800, color: "#fff" }}>4.9</div><div style={{ fontSize: 10.5, color: "#8b96ac" }}>2,400 reviews</div></div>
          </div>
        </div>
      </header>

      {/* Programs */}
      <section id="programs" style={{ maxWidth: 1180, margin: "0 auto", padding: "70px 24px" }}>
        <div className="ld-eyebrow" style={{ marginBottom: 12 }}>Programmes</div>
        <h2 className="display" style={{ fontSize: 44, fontWeight: 800, marginBottom: 10, color: "#fff" }}>Train for your goal</h2>
        <p style={{ fontSize: 16, color: "#9aa4b4", maxWidth: 580, marginBottom: 44 }}>Four focused pathways, each with tailored workouts, nutrition and one-to-one coaching.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 22 }}>
          {PROGRAMS.map((p, i) => {
            const Icon = Icons[p.icon] || Icons.Circle;
            return (
              <div key={p.title} data-testid={`program-${p.title.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-$/, "")}`} className="ld-card ld-lift ld-reveal" style={{ overflow: "hidden", padding: 0, animationDelay: `${i * 90}ms` }}>
                <div className="ld-imgwrap" style={{ position: "relative", height: 200 }}>
                  <img src={p.img} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(10,11,14,0.15) 30%, rgba(10,11,14,0.8))" }} />
                  <div style={{ position: "absolute", top: 14, left: 14, width: 42, height: 42, borderRadius: 13, background: "rgba(20,22,28,0.7)", backdropFilter: "blur(8px)", border: `1px solid ${p.accent}55`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={20} color={p.accent} />
                  </div>
                </div>
                <div style={{ padding: "20px 22px 26px" }}>
                  <h3 className="display" style={{ fontSize: 19, fontWeight: 700, color: "#fff", marginBottom: 8 }}>{p.title}</h3>
                  <p style={{ fontSize: 13.5, color: "#9aa4b4", lineHeight: 1.65 }}>{p.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section id="how" style={{ maxWidth: 1180, margin: "0 auto", padding: "70px 24px" }}>
        <div className="ld-eyebrow" style={{ marginBottom: 12 }}>How it works</div>
        <h2 className="display" style={{ fontSize: 44, fontWeight: 800, marginBottom: 44, color: "#fff" }}>Up and running in minutes</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22 }}>
          {STEPS.map((s, i) => {
            const Icon = Icons[s.icon] || Icons.Circle;
            return (
              <div key={s.title} className="ld-card ld-lift ld-reveal" style={{ padding: 30, animationDelay: `${i * 90}ms` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(224,96,58,0.14)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={23} color="#F28C79" /></div>
                  <span className="display" style={{ fontSize: 48, fontWeight: 800, color: "rgba(255,255,255,0.06)" }}>0{i + 1}</span>
                </div>
                <h3 className="display" style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 8 }}>{s.title}</h3>
                <p style={{ fontSize: 14, color: "#9aa4b4", lineHeight: 1.65 }}>{s.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={{ maxWidth: 1180, margin: "0 auto", padding: "70px 24px" }}>
        <div className="ld-eyebrow" style={{ marginBottom: 12 }}>Pricing</div>
        <h2 className="display" style={{ fontSize: 44, fontWeight: 800, marginBottom: 10, color: "#fff" }}>Membership plans</h2>
        <p style={{ fontSize: 16, color: "#9aa4b4", marginBottom: 44 }}>Or pay <span style={{ color: "#fff", fontWeight: 700 }}>₹1,000</span> per individual trainer session. Cancel anytime.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22, alignItems: "stretch" }}>
          {PLANS.map((p, i) => (
            <div key={p.name} className={`ld-card ld-reveal${p.featured ? " ld-featured" : " ld-lift"}`} data-testid={`landing-plan-${p.name.toLowerCase()}`}
              style={{ padding: 32, animationDelay: `${i * 90}ms`, transform: p.featured ? "scale(1.04)" : "none", background: p.featured ? "#181A21" : undefined }}>
              {p.featured && <span style={{ position: "absolute", top: 20, right: 22, padding: "5px 13px", borderRadius: 999, fontSize: 11.5, fontWeight: 800, color: "#fff", background: "linear-gradient(135deg, #E0603A, #F28C79)" }}>Most popular</span>}
              <div style={{ fontSize: 15, fontWeight: 700, color: "#9aa4b4" }}>{p.name}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 5, margin: "12px 0 4px" }}>
                <span className="display" style={{ fontSize: 46, fontWeight: 800, color: "#fff" }}>₹{p.price}</span>
                <span style={{ fontSize: 14, color: "#6b7688" }}>{p.period}</span>
              </div>
              <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "22px 0" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 13, marginBottom: 28 }}>
                {p.features.map((f) => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 11, fontSize: 13.5, color: "#c3cad6" }}>
                    <span style={{ width: 20, height: 20, borderRadius: "50%", background: `${p.accent}22`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icons.Check size={12} color={p.accent} /></span>{f}
                  </div>
                ))}
              </div>
              <button className="ld-pill" data-testid={`landing-buy-${p.name.toLowerCase()}`} onClick={go}
                style={{ width: "100%", padding: 14, fontSize: 15, color: "#fff", background: p.featured ? "linear-gradient(135deg, #E0603A, #F28C79)" : "rgba(255,255,255,0.07)", border: p.featured ? "none" : "1px solid rgba(255,255,255,0.14)", boxShadow: p.featured ? "0 14px 34px rgba(224,96,58,0.45)" : "none" }}>
                Get started
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section style={{ maxWidth: 1180, margin: "50px auto 0", padding: "0 24px" }}>
        <div className="ld-imgwrap" style={{ position: "relative", borderRadius: 28, overflow: "hidden", border: "1px solid rgba(224,96,58,0.3)" }}>
          <img src={IMG.strength} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.28 }} />
          <div style={{ position: "relative", padding: "60px 40px", textAlign: "center", background: "radial-gradient(600px 300px at 50% 0%, rgba(224,96,58,0.25), transparent 70%)" }}>
            <h2 className="display" style={{ fontSize: 38, fontWeight: 800, color: "#fff", marginBottom: 14 }}>Ready to start training?</h2>
            <p style={{ fontSize: 16.5, color: "#c3cad6", marginBottom: 30 }}>Join today and get matched with a coach for your goal.</p>
            <button className="ld-pill ld-pill-primary" data-testid="cta-signup-btn" onClick={go} style={{ padding: "16px 36px", fontSize: 16.5 }}>Create your account <Icons.ArrowRight size={18} /></button>
          </div>
        </div>
      </section>

      <footer style={{ maxWidth: 1180, margin: "0 auto", padding: "56px 24px 46px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, #E0603A, #F28C79)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icons.Zap size={16} color="#fff" fill="#fff" /></div>
          <span className="display" style={{ fontSize: 17, fontWeight: 800, color: "#fff" }}>FitCoach</span>
        </div>
        <div style={{ fontSize: 13, color: "#6b7688" }}>© {new Date().getFullYear()} FitCoach · Evidence-based training</div>
        <Link to="/login" style={{ fontSize: 13.5, fontWeight: 600, color: "#F28C79", textDecoration: "none" }}>Member login</Link>
      </footer>
    </div>
  );
}
