import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Logo from "@/components/Logo";
import { api } from "@/lib/api";

// Plain-language legal pages. The operator's details come from the server's environment
// (BUSINESS_NAME, BUSINESS_ADDRESS, GRIEVANCE_OFFICER, …) so they stay accurate without code changes.
// These are a careful starting point, not legal advice — have them reviewed before relying on them.
const UPDATED = "5 October 2026";
const PAGES = [["terms", "Terms"], ["privacy", "Privacy"], ["refunds", "Refunds"], ["contact", "Contact"]];

function useLegal() {
  const [info, setInfo] = useState({});
  useEffect(() => { api.get("/legal").then((r) => setInfo(r.data)).catch(() => {}); }, []);
  return info;
}

const Email = ({ info }) => (info.contact_email ? <a href={`mailto:${info.contact_email}`}>{info.contact_email}</a> : "the contact details on our Contact page");

function Operator({ info }) {
  return info.business_name
    ? <>FitCoach is run by <strong>{info.business_name}</strong>{info.gstin ? "" : ", an individual (sole proprietor)"}{info.business_address ? `, ${info.business_address}` : ""}</>
    : <>FitCoach is run by its operator, whose details are on the <Link to="/contact">Contact page</Link></>;
}

function Terms({ info }) {
  const city = info.jurisdiction_city;
  return (
    <>
      <h1>Terms of use</h1>
      <p>Last updated {UPDATED}. <Operator info={info} /> (“we”, “us”). By creating an account or paying for FitCoach you agree to these terms,
        our <Link to="/privacy">Privacy policy</Link> and our <Link to="/refunds">Refund policy</Link>.</p>

      <h2>1. What FitCoach is</h2>
      <p>An online coaching service for fitness, nutrition and yoga. We assign you a coach, who works with you inside the app through plans,
        chat and video sessions. {info.ai_enabled ? "Software, including AI," : "Our software"} drafts plans and summaries; a coach reviews and approves every plan before you see it.
        Coaches are engaged by us to deliver the service. Any qualifications a coach lists are in their own profile.</p>

      <h2>2. Not medical advice — please read</h2>
      <ul>
        <li>Coaching is general fitness, nutrition and yoga guidance. It is not medical advice, diagnosis or treatment, and it does not replace a doctor, physiotherapist or registered dietitian.</li>
        <li>Check with a doctor before you start if you have a heart condition, high blood pressure, diabetes, an eating disorder, are pregnant or recently gave birth, are recovering from injury or surgery, take regular medication, or have ever been told to avoid exercise.</li>
        <li>Tell your coach about injuries, conditions, allergies and medication, and keep it up to date. Plans are only as safe as the information they're based on.</li>
        <li>Stop and seek medical help if you feel pain, dizziness, chest discomfort or shortness of breath. You choose how hard to work and are responsible for exercising within your limits.</li>
        <li>Results vary from person to person. We don't promise any particular weight loss, muscle gain or other outcome.</li>
      </ul>

      <h2>3. Your account</h2>
      <ul>
        <li>You must be 18 or older and live in India.</li>
        <li>Give accurate information and keep your login private. You're responsible for what happens on your account.</li>
        <li>Be respectful to coaches. Don't share content that is abusive, sexual, or not yours to share, and don't record calls or share messages, plans or photos of others without their permission.</li>
        <li>We may suspend or close an account that breaks these terms, puts others at risk, or misuses the service. If we close your account without you being at fault, we'll refund unused paid time as set out in the Refund policy.</li>
      </ul>

      <h2>4. Memberships, sessions and payments</h2>
      <ul>
        <li>New members get a free trial with some features included and no payment needed. Prices are in Indian rupees and shown before you pay.
          {info.gstin ? ` Prices include GST where applicable (GSTIN ${info.gstin}).` : " We are not registered for GST, so no GST is charged."}</li>
        <li>Payments are processed by Razorpay. We never see or store your card, UPI or bank details.</li>
        <li>Auto-renewing memberships renew at the end of each period until you cancel on the Membership page. Cancelling stops future renewals; your current period stays active.</li>
        <li>Price changes apply to new purchases. A running auto-renewal stays at the price you signed up for unless we tell you at least 7 days before it changes, so you can cancel first.</li>
        <li>When a membership ends, coaching features pause after a short grace period. Your progress logs remain available to you.</li>
        <li>Video sessions: cancel any time before the session starts to get your session credit back. A missed session uses the credit. If your coach cancels, the credit is returned.</li>
        <li>Refunds are covered by our <Link to="/refunds">Refund policy</Link>.</li>
      </ul>

      <h2>5. Video calls and chat</h2>
      <p>Calls connect directly between you and your coach and are not recorded by us. Chat messages and voice notes are stored so you and your
        coach can refer back to them.</p>

      <h2>6. Content</h2>
      <p>Your logs, photos and messages stay yours. You allow us to store and process them only to provide the service, as described in the
        Privacy policy. Plans and materials we give you are for your personal use; please don't resell or republish them.</p>

      <h2>7. Availability</h2>
      <p>We work to keep FitCoach running, but it may sometimes be unavailable for maintenance or reasons outside our control (for example,
        internet, hosting or payment outages). If we can't provide the service you paid for for a significant time, the Refund policy applies.</p>

      <h2>8. Our responsibility to you</h2>
      <ul>
        <li>We provide the service with reasonable care and skill.</li>
        <li>As far as the law allows, we aren't responsible for losses that weren't reasonably foreseeable, or for indirect losses such as lost income or opportunity.</li>
        <li>As far as the law allows, our total liability for any claim is limited to the amount you paid us in the 3 months before the claim arose.</li>
        <li>Nothing in these terms limits liability for death or personal injury caused by our negligence, for fraud, or for anything else that can't be limited by law, and nothing affects your rights as a consumer — including your right to approach a Consumer Commission.</li>
      </ul>

      <h2>9. Complaints and disputes</h2>
      <p>Please contact us first: <Email info={info} />. We acknowledge complaints within 48 hours and aim to resolve them within one month.
        These terms are governed by the laws of India{city ? `, and courts in ${city} have jurisdiction, subject to your right to use consumer forums where you live` : ""}.</p>

      <h2>10. Changes</h2>
      <p>We'll tell you in the app at least 7 days before a material change takes effect. If you don't agree, you can cancel before then.
        If any part of these terms is found unenforceable, the rest still applies.</p>
    </>
  );
}

function Privacy({ info }) {
  return (
    <>
      <h1>Privacy policy</h1>
      <p>Last updated {UPDATED}. <Operator info={info} />. We decide how your personal data is used and are responsible for it (the
        “Data Fiduciary” under India's Digital Personal Data Protection Act, 2023). This policy explains what we collect, why, who sees it and your choices.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account details</strong> — name, email, password (stored only as a one-way hash), and a profile photo if you add one or sign in with Google.</li>
        <li><strong>Health and fitness information</strong> — your goal, questionnaire answers (such as age, height, injuries, diet and allergies), measurements, meals you log, workouts, daily check-ins and targets.</li>
        <li><strong>Photos</strong> — progress photos and pose-check snapshots, only if you turn on photo storage. Pose tracking runs on your device; the live camera feed is not uploaded.</li>
        <li><strong>Messages and voice notes</strong> with your coach, and session bookings. Video calls are not recorded.</li>
        <li><strong>Payments</strong> — what you bought, when and the amount. Card, UPI and bank details go to Razorpay, not to us.</li>
        <li><strong>Consultation requests</strong> — name, mobile number, optional email and what you tell us when you ask for a free call.</li>
        <li><strong>Technical data</strong> — a sign-in token on your device, notification settings if you turn them on, and IP address used briefly to block repeated failed logins and spam (stored as a scrambled value for consultation requests).</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To coach you: your assigned coaches use it to write, approve and adjust your plans and track your progress — with your consent, which you give when you sign up.</li>
        {info.ai_enabled
          ? <li>To draft plans, food estimates and weekly summaries with AI (Google's Gemini). We send only what the task needs, without your name or email. A coach checks plans before you see them.</li>
          : <li>To draft plans, food estimates and weekly summaries with our own software, on our own server — no outside AI service receives your data. A coach checks plans before you see them.</li>}
        <li>To run your membership, bookings, reminders and notifications, and to keep the service secure.</li>
        <li>To call you back about a consultation you asked for.</li>
        <li>To send tips and offers — only if you opted in.</li>
        <li>To keep payment records and meet other legal obligations.</li>
      </ul>
      <p>We don't sell your data, and we don't use it for advertising.</p>

      <h2>Who can see it</h2>
      <p>You; the coaches assigned to you (a yoga-only coach sees what's needed for yoga); and our admin team. These service providers process
        data on our behalf: MongoDB Atlas (database), Render (hosting), Razorpay (payments), Google (sign-in{info.ai_enabled ? " and AI" : ""}) and your browser's push
        service (notifications). Our website also loads fonts from Google Fonts and images from Unsplash, which see your IP address as any
        website would. Some providers may store data outside India, which the law permits. We may disclose data if the law requires it.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Account data — until you delete your account.</li>
        <li>Photos — until you delete them, turn off photo storage, or delete your account.</li>
        <li>Consultation requests — up to 6 months, then deleted automatically.</li>
        <li>Payment records — as long as tax law requires (up to 8 years), with your name and email removed once your account is deleted.</li>
      </ul>

      <h2>Your rights and choices</h2>
      <ul>
        <li><strong>Access</strong> — download everything we hold about you from Profile → Privacy & data.</li>
        <li><strong>Correction</strong> — edit your profile and logs in the app, or ask us.</li>
        <li><strong>Withdraw consent</strong> — turn off photo storage or offers anytime in Profile → Privacy & data. Health data is needed to coach you, so withdrawing that consent means deleting your account. Withdrawal doesn't affect what we did lawfully before.</li>
        <li><strong>Erasure</strong> — delete your account from Profile → Privacy & data; it takes effect immediately.</li>
        <li><strong>Nominate</strong> — you can name someone to exercise these rights if you die or can't act yourself; email us.</li>
        <li><strong>Complain</strong> — contact our grievance officer below. If you're not satisfied with our answer, you can complain to the Data Protection Board of India.</li>
      </ul>

      <h2>Children</h2>
      <p>FitCoach is only for adults aged 18 and over. If we learn that a child has signed up, we will delete the account.</p>

      <h2>Security</h2>
      <p>Connections are encrypted (HTTPS), passwords are hashed, data is stored with access controls with our hosting providers, and photos are
        only served to you, your coaches and admins. No system is perfectly secure; if a breach affects your data, we'll tell you and the Data
        Protection Board as the law requires.</p>

      <h2>Grievance officer</h2>
      <p>{info.grievance_officer ? <><strong>{info.grievance_officer}</strong> — </> : ""}<Email info={info} />{info.contact_phone ? ` · ${info.contact_phone}` : ""}.
        We acknowledge within 48 hours and aim to resolve within one month.</p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we'll tell you in the app before it takes effect.</p>
    </>
  );
}

function Refunds({ info }) {
  return (
    <>
      <h1>Refund & cancellation policy</h1>
      <p>Last updated {UPDATED}. We want you to pay only for coaching you're happy with. To ask for a refund, email <Email info={info} /> from
        the address on your account.</p>

      <h2>Free trial</h2>
      <p>The trial is free and needs no payment. Nothing is charged automatically when it ends.</p>

      <h2>Change of mind</h2>
      <ul>
        <li><strong>First payment:</strong> full refund if you ask within 48 hours of your first membership payment and haven't had a video session yet.</li>
        <li><strong>Forgot to cancel auto-renewal:</strong> full refund of a renewal charge if you ask within 48 hours of it and haven't had a video session since.</li>
        <li><strong>Session packs:</strong> within 7 days of purchase, we refund any unused sessions at the pack's per-session price. Used sessions aren't refundable.</li>
        <li>Otherwise, a membership period that has started isn't refunded, but you keep full access until it ends.</li>
      </ul>

      <h2>When we're at fault — always refunded</h2>
      <ul>
        <li>We don't assign you a coach within 7 days of payment.</li>
        <li>FitCoach is unavailable for a significant part of your paid period, or we close your account without you being at fault (we refund the unused time).</li>
        <li>A duplicate or mistaken charge.</li>
        <li>Your coach cancels a paid session — you choose a session credit or a refund.</li>
      </ul>

      <h2>Cancelling</h2>
      <ul>
        <li>Auto-renewal: cancel any time on the Membership page. It stops future charges; your current period continues.</li>
        <li>Video sessions: cancel before the session starts to get your credit back. Missed sessions use the credit.</li>
      </ul>

      <h2>How refunds are paid</h2>
      <p>Approved refunds go back to the original payment method through Razorpay within 7 working days. Your bank may take a further 5–7
        working days to show it.</p>

      <h2>Delivery</h2>
      <p>All services are delivered online in the app. Access starts as soon as payment succeeds; nothing is shipped.</p>
      <p>Nothing in this policy affects your rights under consumer law.</p>
    </>
  );
}

function Contact({ info }) {
  const rows = [
    ["Operated by", info.business_name ? `${info.business_name}${info.gstin ? "" : " (individual / sole proprietor)"}` : null],
    ["Address", info.business_address],
    ["Email", info.contact_email && <a href={`mailto:${info.contact_email}`}>{info.contact_email}</a>],
    ["Phone", info.contact_phone && <a href={`tel:${info.contact_phone.replace(/\s/g, "")}`}>{info.contact_phone}</a>],
    ["Grievance officer", info.grievance_officer],
    ["GSTIN", info.gstin],
  ].filter(([, v]) => v);
  return (
    <>
      <h1>Contact us</h1>
      <p>Questions about your coaching, payments or your data — we're here to help.</p>
      <div className="clay" style={{ padding: "8px 20px", margin: "20px 0" }}>
        {rows.map(([k, v]) => (
          <div key={k} className="row" style={{ justifyContent: "space-between", gap: 16, padding: "12px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
            <span style={{ color: "var(--text-3)", fontSize: 14 }}>{k}</span><span style={{ fontWeight: 500, textAlign: "right" }}>{v}</span>
          </div>
        ))}
        {rows.length === 0 && <p style={{ padding: "12px 0" }}>Contact details are being updated. Members can message us from inside the app.</p>}
      </div>
      <p>Members can also reach their coach any time from Messages in the app. Complaints are acknowledged within 48 hours and we aim to resolve
        them within one month.</p>
    </>
  );
}

export default function Legal({ page }) {
  const info = useLegal();
  useEffect(() => { window.scrollTo(0, 0); }, [page]);
  const Body = { terms: Terms, privacy: Privacy, refunds: Refunds, contact: Contact }[page] || Privacy;
  return (
    <div className="site">
      <header className="site-nav">
        <div className="site-wrap site-nav-inner">
          <Link to="/" style={{ color: "inherit", textDecoration: "none" }}><Logo /></Link>
          <nav className="row" style={{ gap: 16, fontSize: 14, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {PAGES.map(([k, label]) => <Link key={k} to={`/${k}`} style={{ color: page === k ? "var(--text)" : "var(--text-2)", fontWeight: page === k ? 600 : 400 }}>{label}</Link>)}
          </nav>
        </div>
      </header>
      <article className="legal fade-up" data-testid={`legal-${page}`}>
        <Link to="/" className="row" style={{ color: "var(--text-3)", fontSize: 13, textDecoration: "none", marginBottom: 24, gap: 6 }}><ArrowLeft size={14} /> Back</Link>
        <Body info={info} />
      </article>
    </div>
  );
}
