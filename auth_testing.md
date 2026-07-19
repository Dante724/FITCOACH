FitCoach Auth Testing Playbook (Google OAuth + Email/Password JWT)

This app supports TWO auth methods that both authorize the same protected endpoints:
1. Emergent Google OAuth -> cookie `session_token` (rows in user_sessions)
2. Email/Password JWT -> cookie `access_token` (JWT, sub=user_id)

get_current_user accepts: session_token cookie, access_token cookie, OR Authorization: Bearer <token>
(Bearer is tried as a Google session first, then decoded as a JWT).

## Email/Password endpoints (all under /api/auth)
- POST /api/auth/register  {name,email,password}  -> sets access_token cookie, returns user
- POST /api/auth/login     {email,password}        -> sets access_token cookie, returns user
- POST /api/auth/logout                            -> clears cookies
- GET  /api/auth/me                                -> current user

## Backend API test
URL=https://fitness-dashboard-115.preview.emergentagent.com
# register
curl -c c.txt -s -X POST $URL/api/auth/register -H "Content-Type: application/json" -d '{"name":"Test User","email":"pwuser@example.com","password":"Passw0rd!"}'
# login
curl -c c.txt -s -X POST $URL/api/auth/login -H "Content-Type: application/json" -d '{"email":"pwuser@example.com","password":"Passw0rd!"}'
# me (cookie)
curl -b c.txt -s $URL/api/auth/me
# wrong password 401; 5 wrong attempts -> 429 lockout (15 min)

## Existing Google session test (unchanged)
curl -s $URL/api/auth/me -H "Authorization: Bearer test_session_fitcoach_1"

## Frontend
Login page (/login) has tabs: Sign in / Create account (email+password) AND a Continue with Google button.
On success the app calls /auth/me and routes to /focus (if no focus) or /dashboard.
data-testids: auth-tab-login, auth-tab-register, auth-email, auth-password, auth-name,
email-login-btn, email-register-btn, google-login-btn, auth-error.

## Notes
- bcrypt hashes start with $2b$. JWT_SECRET in backend/.env.
- Brute force: login_attempts collection keyed by "{ip}:{email}", 5 fails = 15 min lockout.
