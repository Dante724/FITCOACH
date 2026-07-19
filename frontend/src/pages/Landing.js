import { Link, useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";

const IMG = {
  hero: "https://images.unsplash.com/photo-1534258936925-c58bed479fcb?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200",
  yoga: "https://images.pexels.com/photos/8436627/pexels-photo-8436627.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
  strength: "https://images.unsplash.com/photo-1517963879433-6ad2b056d712?crop=entropy&cs=srgb&fm=jpg&q=85&w=900",
  muscle: "https://images.unsplash.com/photo-1532384816664-01b8b7238c8d?crop=entropy&cs=srgb&fm=jpg&q=85&w=900",
  fatloss: "https://images.unsplash.com/photo-1552674605-db6ffd4facb5?crop=entropy&cs=srgb&fm=jpg&q=85&w=900",
};

const PROGRAMS = [
  { title: "Yoga", img: IMG.yoga, icon: "Flower2", accent: "#7c6bd6", desc: "Build mobility, balance and calm with guided vinyasa and restorative flows led by certified instructors." },
  { title: "Strength & Conditioning", img: IMG.strength, icon: "Dumbbell", accent: "var(--accent)", desc: "Develop raw power, speed and athletic capacity through progressive, evidence-based programming." },
  { title: "Muscle Building", img: IMG.muscle, icon: "Flame", accent: "var(--amber)", desc: "Hypertrophy-focused training and precise nutrition to add quality lean mass, week after week." },
  { title: "Fat Loss", img: IMG.fatloss, icon: "HeartPulse", accent: "var(--teal)", desc: "Sustainable conditioning and AI-guided nutrition to strip body fat while preserving muscle." },
];

const PLANS = [
  { name: "Monthly", price: "10,000", period: "/month", features: ["All programmes", "AI food & body tools", "1 trainer session / week"], accent: "var(--teal)" },
  { name: "Quarterly", price: "30,000", period: "/quarter", features: ["Everything in Monthly", "Priority booking", "2 trainer sessions / week"], accent: "var(--accent)", featured: true },
  { name: "Annual", price: "50,000", period: "/year", features: ["Everything in Quarterly", "Quarterly body assessments", "Unlimited video sessions"], accent: "var(--amber)" },
];

const STEPS = [
  { icon: "UserPlus", title: "Create your account", desc: "Sign up in seconds with email or Google." },
  { icon: "Target", title: "Choose your focus", desc: "Pick a programme tailored to your goal." },
  { icon: "Video", title: "Train with a coach", desc: "Book sessions and meet your trainer on video." },
];

function Nav() {
  const navigate = useNavigate();
  return (
    <nav className="glass" style={{ position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", width: "min(1160px, calc(100% - 28px))", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 22px", borderRadius: 999 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg, var(--accent), var(--accent-2))", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icons.Zap size={18} color="#fff" fill="#fff" />
        </div>
        <span className="display" style={{ fontSize: 19, fontWeight: 800 }}>FitCoach</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 26 }} className="landing-links">
        <a href="#programs" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-2)", textDecoration: "none" }}>Programmes</a>
        <a href="#how" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-2)", textDecoration: "none" }}>How it works</a>
        <a href="#pricing" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-2)", textDecoration: "none" }}>Pricing</a>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn btn-ghost" data-testid="nav-login-btn" onClick={() => navigate("/login")} style={{ padding: "9px 18px", fontSize: 14 }}>Log in</button>
        <button className="btn btn-primary" data-testid="nav-signup-btn" onClick={() => navigate("/login")} style={{ padding: "9px 20px", fontSize: 14 }}>Get started</button>
      </div>
    </nav>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const go = () => navigate("/login");

  return (
    <div style={{ minHeight: "100vh", overflowX: "hidden" }}>
      <Nav />

      {/* Hero */}
      <header style={{ maxWidth: 1160, margin: "0 auto", padding: "150px 24px 60px", display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 48, alignItems: "center" }}>
        <div className="fade-up">
          <div className="chip chip-accent" style={{ marginBottom: 22 }}>Coaching · Nutrition · Recovery</div>
          <h1 className="display" style={{ fontSize: 62, fontWeight: 800, lineHeight: 1.0, marginBottom: 22 }}>
            Your strongest<br />self, <span style={{ color: "var(--accent)" }}>coached.</span>
          </h1>
          <p style={{ fontSize: 17, color: "var(--text-2)", lineHeight: 1.7, maxWidth: 480, marginBottom: 32 }}>
            Personal training built around you — strength, yoga, muscle building and fat loss, with AI nutrition tracking, body scans and live video sessions with real coaches.
          </p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <button className="btn btn-primary" data-testid="hero-signup-btn" onClick={go} style={{ padding: "15px 30px", fontSize: 15.5 }}>Start free <Icons.ArrowRight size={18} /></button>
            <a href="#programs" className="btn btn-ghost" style={{ padding: "15px 28px", fontSize: 15.5 }}>Explore programmes</a>
          </div>
        </div>
        <div className="fade-up" style={{ position: "relative", animationDelay: "120ms" }}>
          <div className="clay" style={{ padding: 12, borderRadius: 28 }}>
            <img src={IMG.hero} alt="Training" style={{ width: "100%", height: 440, objectFit: "cover", borderRadius: 20, display: "block" }} />
          </div>
          <div className="glass" style={{ position: "absolute", bottom: -18, left: -18, padding: "16px 20px", borderRadius: 18, display: "flex", alignItems: "center", gap: 12 }}>
            <Icons.Users size={22} color="var(--accent)" />
            <div><div className="display" style={{ fontSize: 20, fontWeight: 800 }}>2,400+</div><div style={{ fontSize: 11.5, color: "var(--text-3)" }}>Members trained</div></div>
          </div>
          <div className="glass" style={{ position: "absolute", top: -18, right: -14, padding: "14px 18px", borderRadius: 18, display: "flex", alignItems: "center", gap: 10 }}>
            <Icons.Star size={20} color="var(--amber)" fill="var(--amber)" />
            <div><div className="display" style={{ fontSize: 18, fontWeight: 800 }}>4.9</div><div style={{ fontSize: 11, color: "var(--text-3)" }}>Avg rating</div></div>
          </div>
        </div>
      </header>

      {/* Programs */}
      <section id="programs" style={{ maxWidth: 1160, margin: "0 auto", padding: "60px 24px" }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Programmes</div>
        <h2 className="display" style={{ fontSize: 38, fontWeight: 800, marginBottom: 8 }}>Train for your goal</h2>
        <p style={{ fontSize: 15.5, color: "var(--text-2)", maxWidth: 560, marginBottom: 36 }}>Four focused pathways, each with tailored workouts, nutrition and coaching.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {PROGRAMS.map((p, i) => {
            const Icon = Icons[p.icon] || Icons.Circle;
            return (
              <div key={p.title} className="clay fade-up" style={{ overflow: "hidden", padding: 0, animationDelay: `${i * 70}ms` }}>
                <div style={{ position: "relative", height: 190 }}>
                  <img src={p.img} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 30%, rgba(20,24,34,0.65))" }} />
                  <div style={{ position: "absolute", bottom: 14, left: 16, display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,0.9)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon size={20} color={p.accent} />
                    </div>
                    <span className="display" style={{ fontSize: 21, fontWeight: 700, color: "#fff" }}>{p.title}</span>
                  </div>
                </div>
                <div style={{ padding: "18px 22px 24px" }}>
                  <p style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.65 }}>{p.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section id="how" style={{ maxWidth: 1160, margin: "0 auto", padding: "60px 24px" }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>How it works</div>
        <h2 className="display" style={{ fontSize: 38, fontWeight: 800, marginBottom: 36 }}>Up and running in minutes</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {STEPS.map((s, i) => {
            const Icon = Icons[s.icon] || Icons.Circle;
            return (
              <div key={s.title} className="clay fade-up" style={{ padding: 28, animationDelay: `${i * 80}ms` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 13, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={22} color="var(--accent)" /></div>
                  <span className="display" style={{ fontSize: 30, fontWeight: 800, color: "var(--text-3)", opacity: 0.5 }}>0{i + 1}</span>
                </div>
                <h3 className="display" style={{ fontSize: 19, fontWeight: 700, marginBottom: 8 }}>{s.title}</h3>
                <p style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.6 }}>{s.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={{ maxWidth: 1160, margin: "0 auto", padding: "60px 24px" }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Pricing</div>
        <h2 className="display" style={{ fontSize: 38, fontWeight: 800, marginBottom: 8 }}>Membership plans</h2>
        <p style={{ fontSize: 15.5, color: "var(--text-2)", marginBottom: 36 }}>Or pay ₹1,000 per individual trainer session. Cancel anytime.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {PLANS.map((p, i) => (
            <div key={p.name} className={p.featured ? "glass fade-up" : "clay fade-up"} style={{ padding: 30, animationDelay: `${i * 70}ms`, border: p.featured ? `2px solid ${p.accent}` : "2px solid transparent", position: "relative" }}>
              {p.featured && <span className="chip chip-accent" style={{ position: "absolute", top: 20, right: 20 }}>Popular</span>}
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-2)" }}>{p.name}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, margin: "10px 0 4px" }}>
                <span className="display" style={{ fontSize: 40, fontWeight: 800 }}>₹{p.price}</span>
                <span style={{ fontSize: 14, color: "var(--text-3)" }}>{p.period}</span>
              </div>
              <div style={{ height: 1, background: "rgba(139,150,172,0.2)", margin: "18px 0" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
                {p.features.map((f) => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, color: "var(--text-2)" }}>
                    <Icons.Check size={16} color={p.accent} /> {f}
                  </div>
                ))}
              </div>
              <button className="btn btn-primary" data-testid={`landing-plan-${p.name.toLowerCase()}`} onClick={go} style={{ width: "100%", padding: 13, background: `linear-gradient(135deg, ${p.accent}, ${p.accent})`, boxShadow: `0 8px 20px ${p.accent}55` }}>Get started</button>
            </div>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section style={{ maxWidth: 1160, margin: "40px auto 0", padding: "0 24px" }}>
        <div className="clay" style={{ padding: "48px 40px", textAlign: "center", background: "linear-gradient(135deg, var(--accent), var(--accent-2))", boxShadow: "0 20px 50px rgba(224,92,55,0.35)" }}>
          <h2 className="display" style={{ fontSize: 34, fontWeight: 800, color: "#fff", marginBottom: 12 }}>Ready to start training?</h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.9)", marginBottom: 26 }}>Join today and get matched with a coach for your goal.</p>
          <button className="btn" data-testid="cta-signup-btn" onClick={go} style={{ padding: "15px 34px", fontSize: 16, background: "#fff", color: "var(--accent)", fontWeight: 700 }}>Create your account <Icons.ArrowRight size={18} /></button>
        </div>
      </section>

      <footer style={{ maxWidth: 1160, margin: "0 auto", padding: "50px 24px 40px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, var(--accent), var(--accent-2))", display: "flex", alignItems: "center", justifyContent: "center" }}><Icons.Zap size={16} color="#fff" fill="#fff" /></div>
          <span className="display" style={{ fontSize: 17, fontWeight: 800 }}>FitCoach</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>© {new Date().getFullYear()} FitCoach · Evidence-based training</div>
        <Link to="/login" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>Member login</Link>
      </footer>
    </div>
  );
}
