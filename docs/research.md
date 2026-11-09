# Research summary

Condensed from the research done on 2026-11-05 to 2026-11-09. Figures marked "model" come from our own simulation, not from market data.

## 1. Track crowding (from `https://nearhackathon.com/api/projects`)

| Track | 2026-11-05 | 2026-11-09 |
|---|---|---|
| AI Security & Defense | 83 | 127 |
| Agent Economy | 76 | 120 |
| Real-World Money | 31 | 48 |
| Autonomous Business | 26 | 42 |
| Open Innovation | 24 | 41 |
| Unstoppable DeFi | 25 | 38 |
| Privacy & Private AI | 25 | 36 |
| Investment Thesis | 18 | 23 |
| NFTs That Do Something | 3 | 17 |
| AI Swarms | 10 | 17 |
| **Social Money** | 6 | **12** |
| Games With Real Economies | 1 | 11 |
| **Memecoins With Mechanics** | 5 | **5** |
| Total submissions | 144 | 240 |

Re-check before submitting. The API returns `id`, `project_name`, `tracks`, `demo_url`.

## 2. Lessons from past NEAR hackathon winners

Sources: Devpost galleries of One Trillion Agents (2025) and [REDACTED] (NEARCON 2024), NEARCON 2026 site.

- Winners used NEAR primitives as the core of the design (Chain Signatures, accounts), not as decoration.
- Narrow, real problems with a clear user won (Ping subscription agent, TrustyBite, commchain).
- Traction and sustainability were rewarded (betVEX won twice; Ping became PingPay, now a hackathon partner).
- Chat wrappers around DeFi protocols were common and are now saturated.
- In this hackathon, Claude Code and Codex screen every entry for reproducibility, so working code and exact README steps matter more than pitch.

## 3. Memecoin market facts

| Fact | Source |
|---|---|
| About two thirds of Pump.fun tokens die within 24 hours. Over 80% within two days. | CoinGecko study (June 2026), via CryptoPotato and Blockchain.news |
| Only 4.55% of launches traded for more than 90 days | Same study |
| 11.6 million tokens stopped trading in 2025, memecoins led | CoinGecko, via KuCoin News |
| 98.6% of Pump.fun tokens classified as rug pulls or pump and dumps (disputed by Pump.fun) | Solidus Labs (May 2025) |
| Pump.fun Q1 2026 revenue: $124.7M (about 36% of Solana app revenue) | KuCoin News, Invezz |
| Pump.fun annualized revenue estimate: about $677M (Sep 2026) | Blockworks Research |
| meme.cooking (NEAR launchpad): TVL about $2,321, about $143 fees in 30 days (Oct 28, 2026) | DefiLlama |

Conclusion: memecoins are a huge market overall, but the NEAR memecoin market is tiny. NEAR is the place to prove the mechanic. A real business needs launchpads on other chains to adopt it.

## 4. Competitors

| Project | What it does | Difference |
|---|---|---|
| Pump.fun | Largest launchpad, about 70% of Solana memecoin volume | No protection when a coin dies. Fees go to the platform. |
| Tripwire (in this hackathon, Memecoins track) | Rug-proof launchpad: 10 rules in the contract, keyless token accounts | Stops creator fraud. Ejecto handles natural death and the exit race. They are complementary. |
| TheRascalsDotFun, Sidelot, NDBOT, Greed Machine (in this track) | Token discovery, multi-track DeFi or agent projects | No overlap |
| Unruggable Meme (Starknet) | Locked liquidity, anti-sniper limits, capped team allocation | Anti-rug only, no refund on death |
| Flying Tulip (Andre Cronje) | Perpetual put: burn tokens to get the original deposit back | Primary sale only, needs a large treasury |
| dum4.fun | Refunds part of the creation cost to creators when a token fails | Protects creators, not holders |
| Memereum | Promises on-chain insurance for rugs and crashes | Promotional, unclear payout mechanism |
| meme.cooking (NEAR, hackathon partner) | Fair launchpad on NEAR | Potential partner for an "Ejecto mode" |

No memecoin that automatically pays holders from a shared pool when the coin dies was found.

## 5. Simulation results (model)

Setup: `sim/ejecto-sim.mjs`, 500 runs, 400 traders per run, 60 days. Baseline coin (1% fee, exit race at death) against Ejecto (standard preset), with identical agents and random draws.

| Average per coin | Baseline | Ejecto |
|---|---|---|
| Capital invested | 1,313 NEAR | 1,313 NEAR |
| Total losses of losing traders | 388 NEAR | 346 NEAR (minus 10.8%) |
| Traders who lost 90% or more | 4.4% | 0% |
| Traders with any loss | 64.4% | 67.4% (higher fees cause more small losses) |
| Ejecto Fund at EJECT | | 38.1 NEAR |
| Protocol revenue | | 6.56 NEAR |
| EJECT day | | median day 28, 100% within 60 days |

Fee sensitivity (200 runs each):

| Preset | Buy fee | Sell fee | Loss reduction | Lost 90% or more |
|---|---|---|---|---|
| light | 1.0% | 1.0% | 6.8% | 4.4% to 0% |
| standard | 2.0% | 2.0% | 10.7% | 4.4% to 0% |
| high | 3.5% | 5.0% | 19.0% | 4.4% to 0% |

Attack tests (example coin, seed 59, EJECT on day 34):

- Late whale buying 1 to 500 NEAR right before EJECT always loses: 28% to 36% with token weighting, 28% to 40% with basis weighting, 30.8% to 48.5% with Ejecto weighting (basis x time).
- Wash trading 3 NEAR per day for 30 days costs 3.56 NEAR, and 3.11 NEAR (87%) of that lands in the Ejecto Fund.

Model limits: simplified trader behavior, no sniper bots, the baseline exit race is assumed at day 60. In reality many holders of dead coins never sell and lose 100%, so the model likely understates the benefit.

## 6. Worked example (use it as a unit test, see M2)

EJECT happens with a curve reserve of 60 NEAR for 600k tokens and an Ejecto Fund of 10 NEAR.

| Holder | Story | Tokens | Net basis | Weight (NEAR x days) | Reserve part | Fund part | Total |
|---|---|---|---|---|---|---|---|
| Ani | Bought 10 NEAR on day 1, never sold | 300k | 10 | 300 | 30.0 | 5.6 | 35.6 |
| Budi | Bought 10 NEAR on day 25 | 100k | 10 | 50 | 10.0 | 0.9 | 10.9 |
| Cici | Bought 20 NEAR on day 2, sold half for 15 NEAR on day 5 | 200k | 5 | 185 | 20.0 | 3.5 | 23.5 |

Cici's weight: 20 NEAR for 3 days (60) plus 5 NEAR for 25 days (125).

## 7. Legal note

The SEC staff statement of 2025-02-27 says typical memecoins are not securities. It is not binding and does not cover refund mechanisms. Ejecto promises no profit, and the fund is distributed by code. Get legal review before any mainnet launch.

## 8. Sources

- Hackathon: https://nearhackathon.com, https://nearhackathon.com/HACKATHON.md, https://github.com/nearai/near-hackathon-prompt-examples
- Past winners: https://1t-agents.devpost.com/project-gallery, https://redacted.devpost.com/project-gallery, https://nearcon.org
- Memecoin deaths: https://cryptopotato.com/nearly-70-of-pump-fun-tokens-die-on-launch-day-coingecko/, https://blockchain.news/news/pump-fun-memecoins-lifespan-study, https://cointelegraph.com/news/pump-fun-memecoins-are-dying-at-record-rates-less-than-1-survive, https://www.kucoin.com/news/flash/11-6m-crypto-projects-fail-in-2025-meme-coins-hit-hardest
- Pump.fun revenue: https://www.kucoin.com/news/flash/pump-fun-generates-124-7m-in-q1-2026-accounts-for-36-of-solana-app-revenue, https://www.blockworks.co/news/pump-revenue-sharing-token-holders
- NEAR memecoin market: https://defillama.com/protocol/meme-cooking
- Competitors: https://x.com/samaisback/status/2118030472676769978 (Tripwire), https://dapps.alchemy.com/dapps/unruggable-meme, https://www.blockhead.co/2025/09/30/andre-cronjes-flying-tulip-raises-200m-with-perpetual-put-protection-for-investors/, https://www.producthunt.com/posts/dum4-fun, https://www.coingecko.com/learn/when-tokens-come-with-a-refund-button-impossible
- Legal: https://winston.com/en/blogs-and-podcasts/non-fungible-insights-blockchain-decrypted/sec-staff-under-new-administration-issues-statement-declaring-that-meme-coins-are-not-securities
