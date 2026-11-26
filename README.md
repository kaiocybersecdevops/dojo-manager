# 🥋 Dojo Manager

**Check-in, belt tracking and audit trail for a Brazilian Jiu-Jitsu academy.**
A full stack prototype by [Kaio Bertocchi Ribeiro](https://www.linkedin.com/in/kaio-cybersec-devops/).

**▶ Live demo:** https://kaiocybersecdevops.github.io/dojo-manager/

Demo accounts (password `demo1234`): `admin@dojo.dev` · `coach@dojo.dev` · `ana@dojo.dev`

---

## Why I built this

At a state public-safety agency I built a statewide tablet headcount system: photo identification, real-time presence validation and full traceability. That code is confidential.

Dojo Manager applies the same architecture to a public, everyday problem I know well: I'm a BJJ black belt and volunteer coach. Academies still track attendance and promotions on paper or spreadsheets.

## Features

- **Self check-in kiosk:** students enter a personal 6-character code; one check-in per day is enforced.
- **Belt and stripe tracking:** promotions follow the official order (white → blue → purple → brown → black); stripes reset on a new belt.
- **Role-based access control:** `admin`, `instructor` and `student` each see and do only what they are allowed to.
- **Audit trail:** every login, failed login, check-in, rejected check-in and promotion is recorded with who, what and when.
- **Dashboard:** today's check-ins, attendance rate and students by belt.

## Security by design

| Concern | How it is handled |
| --- | --- |
| Passwords | Hashed with `scrypt` and a random salt per user |
| Sessions | Signed JWT (HMAC-SHA256), 8-hour expiry, constant-time signature check |
| Authorization | One central permission map (`PERMISSIONS`), checked on every protected route |
| Input | Server-side validation, JSON body size limit, parameterised SQL only |
| Traceability | Append-only `audit_log` table, including failed attempts |

## Tech stack

- **Back end:** Node.js 22, native `node:http` and `node:sqlite`, zero runtime dependencies
- **Front end:** React-style components (Preact + hooks + htm), no build step
- **Tests:** `node:test`, 7 API tests covering auth, RBAC, check-in rules, promotions and auditing

## Project structure

```
server/   REST API (Node.js + SQLite)
  src/auth.js   password hashing, JWT, permission map
  src/db.js     schema, seed data, audit helper
  src/app.js    routes and business rules
  test/         API tests
docs/     Web app (served by GitHub Pages)
  api.js        HttpApi (real API) and DemoApi (same rules, runs in the browser)
  app.js        UI
```

## Run locally

Requires Node.js 22.5 or newer.

```bash
cd server
npm test        # run the API tests
npm start       # API on http://localhost:3001
```

Then open `docs/index.html` with any static server and add `?api=http://localhost:3001` to the URL to use the real API instead of demo mode.

## API

| Method | Route | Permission |
| --- | --- | --- |
| POST | `/api/auth/login` | public |
| GET | `/api/students` | admin, instructor |
| POST | `/api/students` | admin, instructor |
| PATCH | `/api/students/:id/promote` | admin, instructor |
| POST | `/api/checkins` | all roles (students only with their own code) |
| GET | `/api/checkins/today` | admin, instructor |
| GET | `/api/audit` | admin |

## Roadmap

- Photo check-in with the tablet camera
- Payments and membership status
- PostgreSQL and Docker deployment

## License

MIT
