# Unthinkable — AI Customer Support Bot

A demo project to simulate customer support interactions using AI for FAQs and escalation scenarios. It accepts customer queries, retrieves helpful FAQs, uses an LLM (Gemini when configured) to generate responses, summarizes conversations, and suggests / queues escalations and next actions.

## Demo video
Available in repo or can access here - (https://drive.google.com/file/d/1MfEqjv1KhyLJY15XdgTsRHSP1XqmuXjU/view?usp=sharing)

## Tech Stack
Backend: Node.js (CommonJS), Express, better-sqlite3 (or sqlite3) for persistence, axios for HTTP, lru-cache.
Frontend: Vite + React, Tailwind CSS, Axios.

## Setup
1. Clone & install:
```bash
git clone <your-repo-url>
cd unthinkable-support-bot
npm install

```
2. npm
```bash
cd frontend
npm install
cd backend
npm install
```
3. local run
```bash
npm run dev (frontend dir)
npx nodemon server.js (backend dir)
```
Env. variables
```bash
GEMINI_API_KEY : ()
```

Interact with frontend or use Curl commands in terminal (access curl_cmds)

Ui: 
<img width="1656" height="934" alt="image" src="https://github.com/user-attachments/assets/f9c3e228-1d08-419e-a0ee-cda70dddf92f" />


