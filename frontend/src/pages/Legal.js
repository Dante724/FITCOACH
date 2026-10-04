import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Logo from "@/components/Logo";
import { api } from "@/lib/api";

const UPDATED = "4 October 2026";

function Privacy({ contact }) {
  return (
    <>
      <h1>Privacy policy</h1>
      <p>Last updated {UPDATED}. This policy explains what FitCoach collects, why, who can see it and the choices you have,
        in line with India's Digital Personal Data Protection Act, 2023.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account details</strong> — name, email, and a profile photo if you add one or sign in with Google.</li>
        <li><strong>Health and fitness information</strong> — your goal, questionnaire answers (age, height, injuries, diet), measurements, meals you log, workouts, daily check-ins and targets.</li>
        <li><strong>Photos</strong> — progress photos and pose-check snapshots, only if you turn on photo storage. Pose tracking runs on your phone; the live camera video is never uploaded.</li>
        <li><strong>Messages and voice notes</strong> you exchange with your coach, and details of video sessions (time and length — calls are not recorded).</li>
        <li><strong>Payments</strong> — what you bought and when. Card and UPI details are handled by Razorpay; we never see them.</li>
        <li><strong>Consultation requests</strong> — name, mobile number and what you tell us when you book a free call.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To coach you: your assigned coaches use it to write, approve and adjust your plans and to track your progress.</li>
        <li>To draft plans and summaries with AI (Google Gemini). The AI only produces drafts — a coach checks everything before you see it.</li>
        <li>To run your membership, bookings, reminders and notifications.</li>
        <li>To call you back about a consultation you asked for.</li>
        <li>To send tips and offers — only if you opted in.</li>
      </ul>
      <p>We don't sell your data and don't use it for advertising.</p>

      <h2>Who can see it</h2>
      <p>You, the coaches assigned to you (a yoga coach sees what's needed for yoga), and our admin team. Our service providers process data
        for us under contract: MongoDB Atlas (database), Render (hosting), Razorpay (payments), Google (sign-in and AI) and your browser's
        push service (notifications). Some of these may store data outside India.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Your account data — until you delete your account.</li>
        <li>Photos — until you delete them, turn off photo storage, or delete your account.</li>
        <li>Consultation requests — up to 6 months, then deleted automatically.</li>
        <li>Payment records — as long as tax law requires, without your name or email once your account is deleted.</li>
      </ul>

      <h2>Your rights and choices</h2>
      <ul>
        <li><strong>Access</strong> — download everything we hold from Profile → Privacy & data.</li>
        <li><strong>Correction</strong> — edit your profile and logs in the app, or ask us.</li>
        <li><strong>Withdraw consent</strong> — turn off photo storage or offers anytime. Health data is needed to coach you, so withdrawing it means deleting your account.</li>
        <li><strong>Erasure</strong> — delete your account from Profile → Privacy & data. It takes effect immediately.</li>
        <li><strong>Grievances</strong> — contact us below. If you're not satisfied, you can complain to the Data Protection Board of India.</li>
      </ul>

      <h2>Age</h2>
      <p>FitCoach is for adults aged 18 and over.</p>

      <h2>Security</h2>
      <p>Data is encrypted in transit, stored with access controls, and photos are only served to you, your coaches and admins.</p>

      <h2>Contact & grievance officer</h2>
      <p>{contact ? <>Email <a href={`mailto:${contact}`}>{contact}</a>. We aim to reply within 7 days.</> : "Contact your FitCoach administrator."}</p>
    </>
  );
}

function Terms({ contact }) {
  return (
    <>
      <h1>Terms of use</h1>
      <p>Last updated {UPDATED}. By creating an account you agree to these terms.</p>
      <h2>The service</h2>
      <p>FitCoach connects you with a fitness, nutrition and/or yoga coach. AI drafts plans and summaries; your coach reviews and approves
        every plan before you see it. Coaching is not medical advice — check with a doctor before starting if you have a medical condition,
        are pregnant, or are recovering from an injury, and stop any exercise that causes pain.</p>
      <h2>Your account</h2>
      <ul>
        <li>You must be 18 or older and give accurate information, especially about injuries and health conditions.</li>
        <li>Keep your login private. You're responsible for activity on your account.</li>
        <li>Be respectful to coaches in chat and on calls. We may suspend accounts that abuse the service.</li>
      </ul>
      <h2>Memberships and payments</h2>
      <ul>
        <li>New members get a free trial with some features included. Prices are shown in the app before you pay.</li>
        <li>Auto-renewing memberships renew each period until you cancel from the Membership page. Cancelling stops future renewals; the current period stays active.</li>
        <li>Session credits and memberships aren't transferable. Refunds are handled case by case — contact us.</li>
        <li>When a membership ends, coaching features pause after a short grace period. Your progress stays available.</li>
      </ul>
      <h2>Content</h2>
      <p>Plans and materials are for your personal use. Your logs, photos and messages remain yours; you let us store and process them to
        provide the service, as described in the <Link to="/privacy">privacy policy</Link>.</p>
      <h2>Changes and contact</h2>
      <p>We'll tell you in the app before material changes take effect. Questions: {contact ? <a href={`mailto:${contact}`}>{contact}</a> : "contact your administrator"}.</p>
    </>
  );
}

export default function Legal({ page }) {
  const [contact, setContact] = useState("");
  useEffect(() => { api.get("/auth/config").then((r) => setContact(r.data.privacy_contact || "")).catch(() => {}); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [page]);
  return (
    <div className="site">
      <header className="site-nav">
        <div className="site-wrap site-nav-inner">
          <Link to="/" style={{ color: "inherit", textDecoration: "none" }}><Logo /></Link>
          <nav className="row" style={{ gap: 18, fontSize: 14 }}>
            <Link to="/privacy" style={{ color: page === "privacy" ? "var(--text)" : "var(--text-2)" }}>Privacy</Link>
            <Link to="/terms" style={{ color: page === "terms" ? "var(--text)" : "var(--text-2)" }}>Terms</Link>
          </nav>
        </div>
      </header>
      <article className="legal fade-up" data-testid={`legal-${page}`}>
        <Link to="/" className="row" style={{ color: "var(--text-3)", fontSize: 13, textDecoration: "none", marginBottom: 24, gap: 6 }}><ArrowLeft size={14} /> Back</Link>
        {page === "terms" ? <Terms contact={contact} /> : <Privacy contact={contact} />}
      </article>
    </div>
  );
}
