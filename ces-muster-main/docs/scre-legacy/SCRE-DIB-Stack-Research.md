# SCRE — DIB Market & Stack-Coverage Research

**Which technology stacks does the Defense Industrial Base actually run for CUI/CMMC L2 — and in what order should SCRE build playbooks + connectors for them?**
**Date:** June 13, 2026 · **Classification:** Internal — product/strategy · **Companion to:** `SCRE-Goal-and-Three-Approaches.md`, `SCRE-Approaches-Dashboard.html`, `CES-MODULE-MAP.md`

> **Source-quality caveat (read first).** Almost every public source on this topic is **vendor marketing** —
> Microsoft partners (Summit7, Secureframe, Arctic IT, IntelliPoint/IsiDefense), PreVeil, Google, Kiteworks.
> They are useful for *what each platform claims to do* but biased on *which is best*. **No reliable public
> market-share percentages exist** for GCC High vs. alternatives in the DIB; claims below are directional and
> flagged. Treat adoption ordering as "weight of evidence," not measured fact. Where we need real numbers,
> that's a validation task (see §6).

---

## 1. Decision context (locked)

- **Intent = CMMC posture sought × stack to be used.** Generalization runs **across stacks**, not frameworks.
- **Commercial M365 is OUT of scope** — not viable for CUI/L2 in this world. The Microsoft-family profiles are
  **GCC** and **GCC High**, at **G3** and **G5** license tiers (see §3 for a new SMB tier to decide on).
- This research answers: **after the Microsoft family, which stacks are next, and why.**

## 2. The market we're sizing for

- **~118,000+ companies** are estimated by DoD to need **CMMC Level 2** — the majority are **small suppliers:
  component manufacturers, machine shops, CNC/precision shops**, not primes. [DoD est., via GovConWire/VSO]
- **Timeline:** Phase 1 began **Nov 10, 2025** (self-affirm L1/L2 in SPRS as a condition of award); **Phase 2
  begins Nov 10, 2026** — third-party **C3PAO** certification becomes a contract-eligibility requirement for new
  CUI work. The cliff is real and near. [Summit7, Kiteworks, VSO]
- **Implication for stack coverage:** the dominant buyer is a *small manufacturer*, and its environment is rarely
  a clean single SaaS — it's a CUI platform **plus** an on-prem/OT reality (see §3, layer 2).

## 3. The DIB stack landscape (what they actually run for CUI)

Think of a DIB org's "stack" as **two layers**: the **CUI platform** (where identity/email/files live, in scope
for all 110 controls) and the **on-prem/OT layer** (AD, file servers, CAD/CAM, CNC — in scope for manufacturers
regardless of cloud choice).

### Layer 1 — the CUI platform (the playbook-selecting axis)

| Platform | What it is | CMMC/CUI posture | DIB weight (directional) | API-harvestable? (Approach A) |
|---|---|---|---|---|
| **Microsoft GCC High** | Sovereign M365 (Graph, Entra, Intune, Purview, Defender, Sentinel) | **FedRAMP High / IL4**; purpose-built for CUI + **ITAR**; native control inheritance | **De facto standard**, esp. where the org already runs M365/Teams/SharePoint (most DIB) | **Yes — strong.** Graph/Entra/Intune/Purview all expose read-only config |
| **Microsoft GCC** | Gov-community M365, **not** ITAR/CUI-grade for all cases | FedRAMP **Moderate**-ish; suitable for some CUI, **not** ITAR; weaker than GCC High | Common stepping-stone; cheaper than GCC High | **Yes — strong** (same Graph surface) |
| **CUI enclave overlay — PreVeil (on AWS GovCloud)** | End-to-end-encrypted email + file enclave; keeps the commercial environment **out of scope** | **FedRAMP High** hosting; **85+ orgs scored 110/110**; **3,000+ DIB** users claimed | **The leading low-cost SMB / manufacturing path** | **Partial** — PreVeil admin APIs/logs; less surface than M365; enclave model limits what's in scope |
| **Google Workspace + Assured Workloads / Assured Controls** | Google's gov-grade workspace; **Assured Controls Plus** for ITAR | **FedRAMP High** (services since 2021); CUI path exists but needs **add-ons** (e.g., Virtru CSE) + strict config — **not** out-of-the-box | Smaller DIB footprint; more commercial/SLED; growing | **Yes** — Admin SDK / Reports API read-only |
| **AWS GovCloud (bare IaaS/PaaS)** | Sovereign infra; the **substrate** under PreVeil and custom enclaves | **FedRAMP High / IL4-5**; you assemble controls yourself | Backbone for enclaves, custom apps, OT-adjacent workloads | **Yes** — AWS Config / Security Hub / IAM read-only, but per-account custom |
| **Other file/enclave vendors** (Kiteworks, Virtru, FileCloud, Sharetru, DropSecure) | Point CUI file-sharing / encryption tools, often layered on the above | Vary; FedRAMP-authorized variants exist | Long tail | Varies |

### Layer 2 — the on-prem / OT reality (universal for manufacturers)

- For a machine shop, **CUI does not stay in the front office** — engineering drawings, CNC programs, and technical
  data packages **flow onto the shop floor** (CAD/CAM workstations, engineering file servers, CNC controllers, OT
  that was never designed for security). [Summit7, PreVeil, Petronella]
- Typical components: **Windows Server + Active Directory**, on-prem **file shares**, **CAD/CAM** (SolidWorks,
  Siemens NX, Mastercam), **CNC/OT**, legacy systems isolated inside the enclave.
- **This layer is largely NOT API-harvestable** → it is exactly where **Approach C (guided evidence capture:
  read-only config-dump scripts, exports, screenshots, policy docs)** becomes the differentiator, and where pure
  API competitors (Approach A only) go blind.

## 4. Recommended stack-coverage order for SCRE

Ordering by **(a) DIB population weight, (b) fit to the small-manufacturer beachhead, (c) 50/30/20 — how cheaply
we get high-quality config data, which favors API-harvestable stacks for Approach A.**

| # | Stack profile(s) | Why this rank | Primary approach fit |
|---|---|---|---|
| **1** | **Microsoft GCC High** — profiles: **GCC-High G5**, **GCC-High G3** | De facto standard; richest read-only API surface; the prime-tier reality | **A** (harvest) + B fallback |
| **1b** | **Microsoft GCC** — **G5, G3** | Same Graph surface, near-neighbor playbook variant; cheaper tier many subs land on | **A** (reuse GCC-High probes) |
| **2** | **On-prem / hybrid + OT** (AD, file servers, CAD/CAM, CNC) | Universal under manufacturers; where CUI actually flows; competitors can't API their way in | **C** (capture recipes) + B |
| **3** | **PreVeil enclave (on AWS GovCloud)** | The dominant low-cost SMB/manufacturing CUI path; huge installed base; pairs with on-prem | **C/B**, partial **A** (PreVeil logs) |
| **4** | **Google Workspace + Assured Controls** | Real FedRAMP-High alternative; opens non-Microsoft subs; good API surface | **A** (Admin SDK) + B |
| **5** | **AWS GovCloud (custom/enclave substrate)** | Lower count but high-value custom/OT workloads; substrate for 2–3 | **A** (Config/Security Hub) per-account |

**Key insight:** the highest-leverage *non-Microsoft* move isn't another SaaS — it's **owning the on-prem/OT layer
(rank 2)** that sits under the manufacturing beachhead. Every competitor that's "an API connector" is blind there;
SCRE's Approach-C capture recipes turn that blind spot into the moat. PreVeil (rank 3) is the cloud half of that
same small-manufacturer story.

## 5. Mapping to the Intent Object (SIT)

The Microsoft profiles map straight onto existing SIT fields — confirming "intent = posture × stack" is already
the schema's shape:
- `tenant_model_preference`: `gcc` | `gcc_high` (commercial dropped) | `dod_il5`
- `license_tier`: `g3` | `g5` | **`business_premium`** ← see decision below
- `infrastructure_model`: `m365_only` | `m365_sentinel` | `m365_azure`
- Non-Microsoft stacks need **new enumerations**: e.g. `tenant_model_preference` += `preveil_aws_govcloud`,
  `google_assured`, `aws_govcloud`, `on_prem_hybrid`; and a per-stack **vendor playbook** + **probe set**.

**Decision to flag — Business Premium GCC High.** Microsoft launched a **Business Premium GCC High** tier (Nov 2025)
for small contractors (**≤300 employees**), with **Defender for Business GCC-H** and **Purview GCC-H** add-ons (Feb
20, 2026) to reach L2. This is *purpose-built for exactly our beachhead* and is **not** G3/G5. **Recommend adding it
as a fifth Microsoft profile** (`license_tier: business_premium` on `gcc_high`) — it may be the most common SMB tier
we see. [Secureframe, IsiDefense, KTL]

## 6. What to validate (because the public data is vendor-biased)

1. **Real stack distribution in the target cohort.** Pull from Cobalt Talon / Carahsoft / the actual nominated
   sub roster: of the manufacturing subs we'd assess, how many are GCC High vs GCC vs PreVeil vs Google vs
   pure-on-prem? This re-orders §4 if reality differs.
2. **API-access willingness** per platform (gates Approach A reach — ties to the API-trust-model open question).
3. **PreVeil/Google API surface depth** — how much of the 320 objectives is actually harvestable read-only vs.
   must fall to Approach C.
4. **On-prem capture-recipe feasibility** — can we ship trusted, signed, read-only AD/file-server/endpoint dump
   scripts owners will actually run?

## 7. Bottom line

- **#1 stays Microsoft** — GCC High (G5/G3) then GCC (G5/G3), with a **Business Premium GCC-High** profile added
  for the SMB beachhead. Best API-harvest economics (Approach A).
- **The decisive next move is the on-prem/OT layer (#2)** under manufacturers — Approach-C territory and a genuine
  moat — paired with **PreVeil-on-AWS-GovCloud (#3)** as the cloud half of the small-manufacturer story.
- **Google Workspace (#4)** and **AWS GovCloud (#5)** follow to broaden reach.
- **Caveat:** ordering is evidence-weighted, not measured — confirm against the real sub roster (§6.1) before
  committing build sequence.

---

### Sources (all vendor/marketing unless noted; triangulate before quoting)
- Secureframe — [GCC High alternatives](https://secureframe.com/blog/gcc-high-alternatives), [GCC High guide](https://secureframe.com/blog/microsoft-gcc-high), [Business Premium GCC High](https://secureframe.com/blog/gcc-high-business-premium)
- Microsoft Learn (vendor-primary) — [Microsoft & CMMC](https://learn.microsoft.com/en-us/compliance/us-government/gov-cmmc)
- Arctic IT — [Commercial vs GCC vs GCC High](https://arcticit.com/whats-the-difference-between-microsoft-commercial-cloud-gcc-and-gcc-high/)
- CMMC Dashboard — [Google Workspace vs GCC High](https://cmmcdashboard.com/blog/google-workspace-vs-gcc-high-cmmc-compliance), [GCC vs GCC High for small biz](https://cmmcdashboard.com/blog/microsoft-gcc-vs-gcc-high-small-defense-business)
- Google Cloud (vendor-primary) — [CMMC](https://cloud.google.com/security/compliance/cmmc), [Public Sector CMMC L2 post](https://cloud.google.com/blog/topics/public-sector/securing-the-mission-google-public-sectors-cmmc-level-2-certification-and-commitment-to-national-security)
- Agile IT — [Google Workspace + CMMC 2.0](https://agileit.com/news/can-you-meet-cmmc-2.0-with-google-workspace/) · Virtru — [Virtru + Google Workspace CUI](https://www.virtru.com/blog/compliance/maximizing-cmmc-2.0-compliance-how-virtru-enhances-google-workspace-security-protects-cui)
- PreVeil — [CMMC enclave](https://www.preveil.com/blog/cmmc-enclave/), [Manufacturing/CNC](https://www.preveil.com/manufacturing-cnc/), [CAD users roadmap](https://www.preveil.com/blog/cmmc-implementation-guide-for-cad-users-a-practical-roadmap/), [vs GCC High](https://www.preveil.com/preveil-vs-microsoft-gcc-high/)
- Kiteworks — [CMMC cloud vendors 2026](https://www.kiteworks.com/cmmc-compliance/cmmc-compliant-cloud-security-vendors/), [Top 8 vendors](https://www.kiteworks.com/cmmc-compliance/cmmc-compliance-security-vendors/)
- Summit7 — [Manufacturing solutions](https://www.summit7.us/solutions/manufacturing), [Google Workspace CMMC/ITAR](https://www.summit7.us/blog/google-workspace-cmmc-dfars-itar-compliance) · Petronella — [CMMC manufacturing supply chain](https://petronellatech.com/blog/cmmc-manufacturing-supply-chain/)
- Market/timeline — [GovConWire (CMMC Phase 1)](https://www.govconwire.com/articles/payam-pourkhomami-osibeyond-govcon-expert-cmmc-compliance), [VSO Phase 2 guide](https://vso-inc.com/cmmc-phase-2-defense-contractors-action-guide/), [VSO AWS GovCloud](https://vso-inc.com/aws-govcloud-explained-for-defense-contractors/)
- IsiDefense — [Business Premium for GCC High](https://isidefense.com/blog/microsoft-365-business-premium-for-gcc-high-affordable-cmmc-compliance-for-smbs) · KTL — [Business Premium GCC High](https://www.ktlsolutions.com/microsoft-365-business-premium-gcc-high/)
