# NEAR HACKATHON 2026: what matters for Ejecto

Official sources: https://nearhackathon.com and https://nearhackathon.com/HACKATHON.md (read the live version before submitting, rules can change).

## 1. Dates

| Event | UTC | WIB (Jakarta) |
|---|---|---|
| Build window opens | 2026-11-01 00:00 | 2026-11-01 07:00 |
| **Submission deadline** (repo must be public) | **2026-11-14 23:59** | **2026-11-15 06:59** |
| Judging | 2026-11-16 to 2026-11-18 | |
| Results announced | by 2026-11-18 23:59 | |
| Keep the hosted demo online | until 2026-11-18, ideally 2026-11-25 | |

## 2. Prizes

Total $250,000, fixed in USD, paid in NEAR to the account given in the form. Paid once, within 30 days, no vesting.

| Prize | Amount |
|---|---|
| Grand prize (one project overall) | $55,000 |
| 1st place per track (13 tracks) | $10,000 |
| 2nd place per track | $3,000 |
| 3rd place per track | $2,000 |

## 3. Our tracks

**Memecoins With Mechanics** (`memecoins`, primary). Official prompt: https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/11-memecoins.md

- "Build memecoins where the meme does something: supply that reacts to the community, treasuries with rules, onchain rituals and challenges."
- The mechanic must live "in the contract, not in a backend".
- Parameters fixed at launch. "No admin key that can change them later."
- Simulate 60 days before building (done: `sim/ejecto-sim.mjs`).
- "Judges score the mechanic, and the price chart doesn't count."
- Hints: memecoins, token mechanics, NEP-141. Partner: meme.cooking.

**Social Money** (`social`, secondary). "Shared budgets, programmable rewards, collective ownership and reputation-based access on top of Sputnik DAO and Trezu." Hints are not requirements. Our fit: the Ejecto Fund is a rule-based shared treasury, and SOS (stretch) is a collective rescue.

## 4. Judging

- Judges: Illia Polosukhin (NEAR), Eddy Lazzarin (a16z crypto), Mert Mumtaz (Helius), Avichal Garg (Electric Capital), Kain Warwick (Synthetix and Infinex), Haseeb Qureshi (Dragonfly), Stepan Gershuni (cyber.Fund).
- **Claude Code and Codex screen every project first**: reproducibility check, feature verification, structured report, preliminary score. Humans decide. A low AI score alone cannot reject a project (Q-017).
- No official weighted rubric. Previous NEAR hackathons judged technical implementation, design, impact, originality and sustainability.
- Demo post guidance: explain NEAR's role concretely. Avoid a vague "powered by NEAR".

## 5. Rules that affect us

| Rule | Text (short) |
|---|---|
| Q-001 | Code written since the announcement (2026-10-19) counts. Earlier commits are baseline. |
| Q-005 | Libraries and AI-generated code are allowed. List them in the README. |
| Q-010 | Testnet-only projects are eligible for all tracks. |
| Q-011 | No mandatory integrations. Our own contract that fits the track is enough. |
| Q-012 | A local-only demo is OK with a video. Screenshots alone are not enough. A hosted demo is a plus. |
| Q-013 | We keep all IP. Organizers get non-exclusive promo rights. |
| Q-014 | A LICENSE file is recommended (MIT is fine). |
| Q-015 | One person may enter up to 2 independent projects (disclosed). |
| Form | Project name, team lead name, email, team size, tracks, NEAR mainnet payout account, public repo link (unique), demo post link, "What did you build?" (20 to 2,000 characters), optional website, consent checkbox. |
| Changes | After submitting, changes go through https://nearhackathon.com/request-changes. Resubmitting the same repo returns 409. |

## 6. Submission checklist

- [ ] Public GitHub repo with a LICENSE
- [ ] README written for a machine reader and a human: what it is, the problem, and "do X, see Y" steps (hosted demo, local run, tests, simulation)
- [ ] README lists libraries and AI-generated code
- [ ] Hosted demo on GitHub Pages, working with testnet
- [ ] Demo video (about 3 minutes)
- [ ] X post: built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon, video attached, NEAR's role explained concretely (posted by the user)
- [ ] Form submitted with tracks memecoins and social (by the user)
- [ ] Everything done before 2026-11-14 23:59 UTC

## 7. Demo script (about 3 minutes)

1. **Hook (20 s).** "Two thirds of memecoins die within a day. When they die, the most loyal holders lose the most. We gave every memecoin an ejection seat."
2. **Launch (20 s).** Launch `$SEATO` on testnet with demo time (1 day = 10 seconds). Show in the explorer that the coin account has no access keys.
3. **Hype (30 s).** Three wallets buy (Ani, Budi, Cici). The Ejecto Fund grows. Show each holder's seat and weight.
4. **Crash (30 s).** Buying stops. The engine meter drops to red. The EJECT button lights up.
5. **Wow moment (40 s).** Press EJECT. All three holders claim, and their NEAR balances go up. Show: "Without Ejecto, the last seller in the exit race gets almost nothing. With Ejecto, every holder gets a fair share of the reserve plus a fund share for loyalty." Be honest that late buyers can still lose some money (see `research.md` section 6).
6. **Attack (30 s).** A whale buys right before EJECT to farm the fund. Show from the simulation that this always loses money.
7. **Close (10 s).** "Memecoins die. Every memecoin needs an ejecto seato."

## 8. Links

- Form: https://nearhackathon.com/#apply
- Discord: https://discord.gg/nearprotocol
- Telegram: https://t.me/nearbuilderschat
- NEAR docs: https://docs.near.org
