# 📄 Report Generator Agent - Product Requirements Document

> **AI Career Coach Portfolio Project**  
> Generates a beautiful, shareable career report from synthesized data

---

## 🧩 Problem

The AI Career Coach produces rich insights (analysis, gaps, cover letter, interview prep, strategy), but:
- There is no **single artifact** Theo can download or share.
- Recruiters and mentors prefer a concise **document** over many separate JSON outputs.

The Report Generator Agent turns the unified synthesized report into polished markdown (downloaded as a PDF via the browser).

---

## 🎯 Goals

1. **Single report** summarizing all key AI Career Coach outputs.
2. **Human-friendly layout** sections: analysis, gaps, cover letter, interview prep, roadmap.
3. **Easy export**: raw markdown served from API so the browser can handle PDF via print-to-PDF or external tools.

---

## 🔄 Flows

### Flow – Generate Final Report
```
1. Client gathers:
   - resumeAnalysis
   - gapAnalysis
   - coverLetter
   - interviewPrep
   - strategyPlan
2. Client POSTs this to /api/agents/report.
3. API:
   - Calls synthesizeCareerReport(data).
   - Builds markdown string with sections and headings.
4. API returns markdown as a text response with Content-Disposition for download.
5. Client treats it as a "PDF" download (file name includes company).
```

---

## 📌 Requirements

### Functional

- **FR-1**: Accept a payload compatible with `synthesizeCareerReport`.
- **FR-2**: Use Synthesizer Agent to create canonical report object.
- **FR-3**: Generate markdown sections:
  - Header (candidate, target company, date).
  - Resume Analysis (summary).
  - Gap Analysis (fit score + top missing skills).
  - Personalized Cover Letter.
  - Interview Prep overview (10 Q&A).
  - 6-Month Strategy summary.
- **FR-4**: API should set:
  - `Content-Type: text/markdown`
  - `Content-Disposition: attachment; filename="<candidate>_<company>_Career_Report.pdf"`.

### Non-Functional

- **NFR-1**: No LLM calls here; pure formatting.
- **NFR-2**: Markdown should be readable in GitHub/Notion and printable to PDF.

---

## 🧱 Technical Approach

- **File**: `lib/agents/report-generator/node.ts`
  - Implement `generateReport(data)`:
    - Call `synthesizeCareerReport(data)`.
    - Build markdown as in the spec/template.
    - Return `{ markdown, filename }`.
- **File**: `app/api/agents/report/route.ts`
  - Parse body JSON, call `generateReport`, and respond with markdown + headers.
- UI button uses `fetch` + `blob()` + `URL.createObjectURL` to trigger browser download.

---

## 🚫 Out of Scope

- ❌ Server-side PDF rendering (no Puppeteer/Playwright).
- ❌ Authenticated report history or storage.
- ❌ Multi-candidate batch exporting.

---

## ⏱️ < 2 Hour Task List

- [ ] **RG‑1**: Implement `synthesizeCareerReport` usage and markdown template  
  - **File**: `lib/agents/report-generator/node.ts`  
  - **Time**: 40 min  
  - Follow the provided markdown structure and filename convention.

- [ ] **RG‑2**: Create report API route  
  - **File**: `app/api/agents/report/route.ts`  
  - **Time**: 20 min  
  - Parse body, call `generateReport`, return downloadable markdown.

- [ ] **RG‑3**: Add "Download Full Career Report" button  
  - **File**: `app/page.tsx`  
  - **Time**: 30 min  
  - Implement click handler that POSTs to `/api/agents/report` and downloads the result as a `.pdf` file.


