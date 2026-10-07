# SmartFill AI

SmartFill AI is an intelligent Chrome extension that inspects web forms and populates every field with context-aware, cohesive, and realistic test data.

## Architecture

```text
[ Webpage Form (React / Plain HTML) ]
               ▲
               │  Native Property Setter + Bubbling Events
               ▼
    [ Content Script (formScanner & formFiller) ]
               ▲
               │  Chrome Runtime Messaging
               ▼
    [ Extension Popup / Background Worker ]
               │
      ┌────────┴────────┐
      │                 │
[ Direct Mode ]   [ Proxy Mode ]
      │                 │
      ▼                 ▼
[ Groq API ]     [ Node.js / Vercel Serverless ]
                        │
                        ▼
                 [ Groq Cloud API ]
```
