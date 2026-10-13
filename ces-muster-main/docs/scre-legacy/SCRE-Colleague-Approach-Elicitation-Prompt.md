# Help us understand your approach — in your own words and full detail, so we can compare notes

## How to use this prompt

- **Running this in an AI assistant?** Start by telling your assistant: "Read all available project files related to your approach to this problem / your project, then answer the questions below as if you are describing that project." Then paste the rest of this document.
- **Answering directly?** Work through each section in order. Rough notes are fine — completeness beats polish.

## A quick note on context

Two of us are working the same problem independently, and we'd like to compare how we each approached it. To keep the comparison honest and useful, we've deliberately kept our own thinking out of this document — there are no spoilers or hints about how we did it. We just want your independent take, described in as much concrete detail as you're willing to share.

## Part 1 — Tell it in your own words

Before the structured questions, write 2–5 paragraphs in your own voice. What is the big idea? What problem are you solving, and for whom? Why does your approach work, and what makes it interesting or different? Don't worry about structure here — just talk us through it the way you'd explain it to a colleague over coffee. There are no sub-questions in this part; the structured questions come next.

## Before the structured questions: a depth example

The example below shows the **level of detail** we're hoping for — **not the content**. It's drawn from a completely unrelated domain (tax-filing readiness) on purpose, so it models *how deep to go* without steering *what to say*. Use it as a depth model, not a content model.

> **Illustrative example — fictional composite organization, not a real entity**
>
> **Part 1 (open narrative):** "We help mid-sized restaurant groups get ready to file their year-end returns without the usual March scramble. The core problem is that their books are spread across a point-of-sale system, a payroll provider, and a shoebox of receipts, and nobody reconciles them until it's too late. Our approach pulls all three sources into one running ledger throughout the year, flags the gaps as they appear, and hands the owner a clean, filing-ready package in January. It works because we catch missing documentation in month two instead of month eleven, when the vendor who issued the receipt has already gone out of business."
>
> **Q (worked at target depth):** *What does a completed deliverable look like for the organization that receives it?*
> "Page 1 is a one-page readiness summary: a green/yellow/red status per category (income, payroll, deductible expenses, owner draws) and a count of open items — e.g., '7 receipts missing, 2 payroll months unreconciled.' Pages 2–6 are the reconciled ledger by category. The appendix is the raw export from each source system (Toast POS CSV, Gusto payroll PDF, and our own receipt-capture log) so their accountant can trace any number back to its origin. The day they receive it, the owner forwards it to their CPA, who told us it cuts their prep time from roughly 9 hours to about 2."
>
> **Q (worked at target depth):** *Who does the work, and what does it cost to deliver one engagement?*
> "The customer spends about 30 minutes a month uploading receipts via a phone app; everything else is on us. Our side is roughly 1.5 hours/month of a bookkeeper's time plus an automated nightly sync. All in, a year of service costs us about $420 in labor and $15 in software per client, and we charge $1,800/year. The big cost driver is how messy their receipt habits are — a disciplined client drops us to about $300 in labor; a chaotic one pushes past $600."

## Part 2 — Structured questions

**Q1 — Problem and output**

What problem are you solving, and what does a completed deliverable look like for the organization that receives it?

*Describe the output artifact — what is on page 1, what is in the appendix, what a recipient does with it the next day.*

---

**Q2 — Capturing intent and goal**

How do you pin down what the organization is actually trying to achieve — the target state, scope, and level of rigor they want?

*Walk through exactly how you capture what the org is aiming for — what you ask, in what order, and what you do when they don't know the answer.*

---

**Q3 — Handling technology stacks and platforms**

How do you handle the fact that organizations use different technology platforms?

*Two parts: (a) if a single organization spans more than one platform, how do you handle that — one pass, separate passes, something else? (b) Do you prioritize some platforms over others when deciding what to support, and if so, how do you decide? Name the platforms you cover today and any you have deprioritized.*

---

**Q4 — Obtaining configuration and posture data**

How do you obtain the organization's actual configuration and posture data, and how do you know it is accurate?

*Describe the mechanism — what does the person or system on their end actually do? What form does the data arrive in? Give the accuracy or confidence level you would claim and what backs it up.*

---

**Q5 — Confidence and traceability**

How do you know the result is correct? What can you point to as evidence?

*Name the specific check, test, or artifact. If a result is wrong, how would you find out? Give a real or hypothetical example of a finding and its evidence trail.*

---

**Q6 — Who does the work and at what cost**

Who does the work — the customer, your team, a system, or some combination — and what does it cost in time and money to deliver one assessment?

*Give numbers: hours of customer time, hours of your team's time, dollar cost per engagement. If it varies, give the range and what drives the variance.*

---

**Q7 — Deliverable contents**

What does the deliverable actually contain — plan, gap list, score, evidence package, remediation steps, something else?

*Paste a real or representative table of contents, or list every named section. If there is a score, describe the scale and what drives it.*

---

**Q8 — Architecture and tooling**

What software or systems does your approach use or depend on, and how much did you build versus reuse?

*Name the specific tools, APIs, or platforms. For anything you built, describe what it does. For anything you reuse, describe how you integrate it.*

---

**Q9 — Business model**

What are you selling, to whom, at what price, and through what channel?

*Name the buyer persona. Give the price point or range. Describe exactly how a customer finds you and goes from first contact to delivered output, start to finish.*

---

**Q10 — Status**

Where does your approach stand today — fully built, prototyped, or still conceptual?

*If built: can you share a demo, screenshot, or sample output? If prototyped: what works and what does not yet? If conceptual: what is the first thing you would build?*

---

**Q11 — Differentiators and moat**

What makes your approach better than the alternatives, and which specific alternatives or status-quo approaches does it displace?

*Name the alternatives — incumbent tools, manual processes, competitor offerings, or "do nothing." For each one you displace, say why yours wins.*

---

**Q12 — Risks, gaps, and open questions**

What risks, weaknesses, or open questions do you already see in your approach?

*Be specific: what could go wrong, what have you not figured out yet, what assumption are you most nervous about?*

---

**Q13 — Artifacts**

What files, diagrams, code, links, or other artifacts can you share?

*Paste links, file names, or inline the artifact directly. Screenshots, architecture diagrams, sample outputs, and data models all count.*

---

**Bonus — End-to-end walkthrough (highest value)**

Pick one real or representative organization and walk us through your entire process from first contact to delivered output — every step, every decision point, every artifact produced. Use as much detail as you would in an internal post-mortem.

*This is optional but the single most useful thing you can send us. A one-page narrative beats a ten-point list.*

---

**Q14 — Anything we did not ask**

Is there anything important about your approach that none of the above questions surfaced?

*This is the catch-all — if there is a key design decision, a surprising constraint, or a result that reframes everything, put it here.*

## Part 3 — How to return it

Use the question headings as your section headers, be concrete (real names, numbers, and examples wherever you can), and add a final section for anything our questions missed. That said, present your answer in whatever structure and order feels most natural to you — you do not need to mirror our question numbering. If a free-form write-up captures it better, send that instead.

The more detail the better — rough and complete beats polished and thin.
