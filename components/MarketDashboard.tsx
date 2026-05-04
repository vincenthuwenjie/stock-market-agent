"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MarketSnapshot, NewsItem, Scalar } from "@/lib/types";

type Props = {
  initialData: MarketSnapshot;
};

type Lang = "zh" | "en";
type OptionHistoryPoint = {
  date: string;
  asOf: string | null;
  values: Record<string, Scalar | string>;
};
type OptionHistory = {
  days: number;
  metrics: string[];
  availableMetrics: string[];
  symbols: Record<string, OptionHistoryPoint[]>;
};

const OPTION_AXIS_DAYS = 90;

const NA: Scalar = "N/A";
const EMPTY_OPTION = {
  source: "unavailable",
  maxPain: NA,
  iv: NA,
  callOpenInterest: NA,
  putOpenInterest: NA,
  putCallOiRatio: NA,
  expiration: "",
};
const EMPTY_INDEX = {
  price: NA,
  change1dPct: NA,
  pe: NA,
  peSource: "unavailable",
  ma10: NA,
  ma30: NA,
  ma60: NA,
  ma180: NA,
  atr14: NA,
  option: EMPTY_OPTION,
  source: "unavailable",
  timestamp: "",
};
const EMPTY_VALUE = { value: NA, change1dPct: NA, source: "unavailable" };
const EMPTY_YIELD = { yield: NA, change5dPct: NA, asOf: "", source: "unavailable" };
const EMPTY_LIQUIDITY = {
  netLiquidity: NA,
  netLiquidityChange1w: NA,
  netLiquidityChange4w: NA,
  fedBalanceSheet: NA,
  tga: NA,
  rrp: NA,
  asOf: "",
  source: "unavailable",
  formula: "WALCL - WTREGEN - RRPONTSYD",
};

const UI_ZH: Record<string, string> = {
  "宏观新闻": "宏观新闻",
  "个股新闻": "个股新闻",
  "宏观指标": "宏观指标",
  "个股指标": "个股指标",
  "Updated": "更新",
  "Refresh": "刷新",
  "Refreshing": "刷新中",
  "Refresh snapshot": "刷新快照",
  "No items in this snapshot.": "本次快照暂无内容。",
  "items": "条",
  "tickers": "只股票",
  "Dynamic API": "动态 API",
  "M7 configurable": "默认 M7，可配置",
  "ETF Valuation / Trend": "ETF 估值 / 趋势",
  "Vol / FX / Bonds": "波动率 / 外汇 / 债券",
  "Cross Asset": "跨资产",
  "Option Structure": "期权结构",
  "Market Breadth": "市场宽度",
  "期权指标": "期权指标",
  "Option Indicators": "期权指标",
  "60D SQL History": "60 天 SQL 历史",
  "No option history for this symbol/metric.": "该标的/指标暂无期权历史。",
  "Sample AMA": "样本 AMA",
  "Measure": "指标",
  "Value": "数值",
  "Change": "变化",
  "Name": "名称",
  "Asset": "资产",
  "Ticker": "股票代码",
  "Price": "价格",
  "Max Pain": "期权最大痛点",
  "Option MaxPain": "期权最大痛点",
  "1x ATR Stop": "一倍 ATR 止损点",
  "Expiry": "到期",
  "Model Posture": "模型姿态",
  "Risk score": "风险分",
  "Drivers": "驱动因素",
  "Focus": "关注",
  "No major drivers.": "暂无主要驱动因素。",
  "No focus list.": "暂无关注清单。",
  "Influencer AI Mock Analysis": "影响者 AI 模拟分析",
  "mock read": "模拟解读",
  "Quote": "引用上下文",
  "No influencer analysis available in this runtime.": "当前运行环境暂无影响者分析。",
  "Fed Liquidity": "美联储流动性",
  "Net Liquidity": "净流动性",
  "Fed Balance Sheet": "美联储资产负债表",
  "Treasury General Account": "财政部一般账户",
  "Reverse Repo": "逆回购",
  "unavailable": "不可用",
  "ok": "正常",
  "missing": "缺失",
  "empty": "为空",
  "skipped": "跳过",
  "available": "可用",
  "bullish": "偏多",
  "bearish": "偏空",
  "neutral": "中性",
  "watch": "观察",
  "Risk-on": "风险偏好",
  "Risk-off": "风险规避",
  "Neutral": "中性",
  "Macro / Fed": "宏观 / 美联储",
  "Geopolitics": "地缘政治",
  "Equity Tape": "股市盘面",
  "Single Stocks": "个股",
  "Commodities": "大宗商品",
  "AI / Tech": "AI / 科技",
  "Crypto": "加密资产",
  "Finance": "金融",
  "Market Narrative": "市场叙事",
};

const UI_EN: Record<string, string> = {
  "宏观新闻": "Macro News",
  "个股新闻": "Stock News",
  "宏观指标": "Macro Indicators",
  "个股指标": "Stock Indicators",
};

const KNOWN_TEXT_ZH: Array<[RegExp, string]> = [
  [/^Embattled U\.S\. manufacturers show their mettle, grow for the fourth month in a row despite Iran war$/i, "承压的美国制造商展现韧性，尽管受伊朗战争影响，仍连续第四个月扩张"],
  [/^American manufacturers grew in April for the fourth month in a row — the longest streak in four years — but an embryonic recovery faces fresh hurdles from rising oil prices and higher inflation tied to the Iran war\.$/i, "美国制造业在 4 月连续第四个月增长，创四年来最长扩张周期；但这轮刚起步的复苏正面临新阻力，包括油价上涨以及与伊朗战争相关的通胀升温。"],
  [/^The U\.S\.-Iran war is coming for your credit score and mortgage application$/i, "美伊战争正在影响你的信用评分和房贷申请"],
  [/^Oil prices fall after Iran sends updated peace proposal to mediators in Pakistan$/i, "伊朗向巴基斯坦调停方提交新版和平提案后，油价回落"],
  [/^Under the 1973 War Powers Resolution, a U\.S\. president needs to withdraw troops 60 days after reporting their deployment to Congress$/i, "根据 1973 年《战争权力决议》，美国总统在向国会报告出兵后，需在 60 天内撤回部队。"],
  [/^Elon Musk billionaires bill supporters draw progressive challengers in Delaware$/i, "支持马斯克亿万富豪法案的特拉华州政界人士，正面临进步派挑战者"],
  [/^Musk, whose record pay package was in legal limbo in Delaware, relocated Tesla's incorporation out of state during the spat\.$/i, "马斯克创纪录薪酬方案曾在特拉华州陷入法律僵局，争议期间他把特斯拉注册地迁出该州。"],
  [/^Lutnick gets grilling on Nvidia chip sales to China in letter from Sen\. Chris Coons$/i, "美国参议员 Chris Coons 致信追问 Lutnick 关于英伟达芯片对华销售的问题"],
  [/^Sen\. Chris Coons demanded answers on H200 chips sales to China after Commerce Secretary Howard Lutnick and the Nvidia CEO Jensen Huang give differing answers\.$/i, "在商务部长 Howard Lutnick 与英伟达 CEO 黄仁勋说法不一后，参议员 Chris Coons 要求说明 H200 芯片对华销售情况。"],
  [/^Fed dissenters explain 'no' votes, saying they disagreed with hinting next move would be a cut$/i, "美联储异议官员解释反对票：不赞成暗示下一步行动将是降息"],
  [/^Federal Reserve officials who voted this week against the post-meeting statement said they didn't think it was appropriate to signal that the next interest rate move would be lower\.$/i, "本周投票反对会后声明的美联储官员表示，他们认为不应释放下一次利率调整将下行的信号。"],
  [/^UK exports to U\.S\. plunge by 25% after Trump's 'liberation day' tariffs blitz$/i, "特朗普“解放日”关税冲击后，英国对美出口暴跌 25%"],
  [/^The U\.K\. is now running a trade deficit with its largest trading partner\.$/i, "英国目前对其最大贸易伙伴出现贸易逆差。"],
  [/^Atlassian stock soars 20% after earnings show strong cloud, data center growth$/i, "财报显示云业务与数据中心增长强劲，Atlassian 股价大涨 20%"],
  [/^Atlassian's stock has been hit hard in the "SaaS-pocalypse" sweeping software names as AI threatens to disrupt their business models\.$/i, "由于人工智能可能冲击软件公司的商业模式，Atlassian 股价此前在软件股调整中承压明显。"],
  [/^Roblox shares plummet 18% as child safety measures weigh on bookings$/i, "儿童安全措施拖累预订额，Roblox 股价暴跌 18%"],
  [/^Roblox is facing over 140 federal lawsuits accusing it of failing to prevent child exploitation, and last month settled with Alabama and West Virginia\.$/i, "Roblox 面临超过 140 起联邦诉讼，被指未能防止儿童剥削；上月已与阿拉巴马州和西弗吉尼亚州达成和解。"],
  [/^Trump scraps Scotch whisky tariffs ‘in honor’ of King Charles$/i, "特朗普“为致敬查尔斯国王”取消苏格兰威士忌关税"],
  [/^The move is expected to recoup millions of dollars a month for Scotland’s economy\.$/i, "此举预计每月可为苏格兰经济挽回数百万美元。"],
  [/^Notice how all of the "groundbreaking" headlines are forgotten in two weeks\..*/i, "注意所有“开创性”的头条新闻是如何在两周内被遗忘的。最高法院关于关税的裁决、杰罗姆·鲍威尔可能被起诉、Citrini 关于人工智能末日的文章。它们在当下总是显得很重大，像是“这会改变一切”。生活再也不会一样了。"],
  [/^Software horror: litellm PyPI supply chain attack\..*/i, "软件恐怖事件：litellm PyPI 供应链攻击。只要简单执行 pip install litellm 就足以窃取 SSH 密钥、AWS/GCP/Azure 凭证、Kubernetes 配置、git 凭证、环境变量、API 密钥、shell 历史记录、加密钱包、SSL 私钥、CI/CD 密钥和数据库密码。"],
  [/^CHART OF THE DAY: The idea was that Brent\/WTI was going to catch up higher.*/i, "今日图表：原本的想法是布伦特/WTI 会向上追赶阿曼/迪拜原油的交易水平（每桶超过 150 美元）。相反，我们看到阿曼/迪拜原油单日暴跌超过 45 美元，跌至每桶约 110 美元。"],
  [/^Native USDC\. Native rewards\..*/i, "原生 USDC。原生奖励。原生 USDC 奖励计划已经上线，由 USDC 提供支持。存入、持有、赚取。"],
  [/^Software still getting crushed today.*/i, "软件股今天仍在遭受重挫。看看这些 52 周回撤和估值：$NOW 为 25 倍市盈率，$INTU 为 18 倍，$ADBE 为 10 倍，$CRM 为 14 倍，$FICO 为 25 倍，$UBER 为 21 倍。它们不久前还被认为“昂贵”。现在，重置是真的。"],
  [/^\$MSFT:.*Cheapest in years.*/i, "$MSFT：年初至今下跌 23%，约 21 倍远期收益，为多年来最便宜。上一次情绪这样崩坏时，它横盘了 16 年。是不同的周期，还是同样的错误在重演？"],
  [/^Just me or are markets completely numb to recent war headlines\?.*/i, "只有我这么觉得吗，还是市场对最近的战争头条已经完全麻木了？几乎没有反应。过去 48 小时有大量重大战争更新，但基本没有反应。为什么？一个理论是，仓位已经偏防御。"],
  [/^If the naysayers are telling you you’re not a good trader.*/i, "如果那些唱反调的人说你不是一个好交易员，那就照 Jessie Ware 说的去做：“不要停！”证明他们都错了。"],
  [/^Value-based RL for reasoning\..*/i, "人工智能研究：面向推理的价值型强化学习改进，重点在训练初期对零奖励损失进行校准。"],
  [/^The China AI Complex is much more nuanced.*/i, "中国人工智能产业链比表面更复杂，开源权重、低成本和长期政策目标共同影响全球竞争格局。"],
  [/^🇮🇷 Iranian soldiers in underground trenches on Kharg Island.*/i, "伊朗士兵在 Kharg 岛地下阵地展示防御准备，相关照片显示其可能已部署无人机等装备。"],
  [/^Iran has been laying traps and moving additional military personnel and air defenses to Kharg Island.*/i, "据报道，伊朗近期在 Kharg 岛布设陷阱并增派军力和防空系统，以防备美国可能的登陆行动。"],
  [/^Israel's Prime Minister Netanyahu ordered maximum effort.*/i, "据报道，以色列总理内塔尼亚胡要求未来 48 小时内尽最大努力打击伊朗武器工业。"],
  [/^Trump reportedly dismissed Netanyahu’s proposal.*/i, "据报道，特朗普拒绝内塔尼亚胡呼吁伊朗民众起义的建议，原因是担心平民遭到镇压。"],
  [/^I want you to understand how unusual this is\..*/i, "我想让你明白这有多不寻常。周一早上 6:49，石油期货交易突然激增，成交量约 5.8 亿美元，没有新闻、没有公告、没有任何公开消息。早上 7:05，特朗普宣布暂停对伊朗的打击。市场立即波动。"],
  [/^The best thing for both sides is to make a PEACE deal\..*/i, "对双方来说最好的事情是达成和平协议。如果伊朗继续封锁霍尔木兹海峡并挟持全球经济，特朗普将派出地面部队。"],
  [/^If you feel bad about unerpeforming the market YTD\..*/i, "如果你因为今年以来跑输市场而感觉不好，Bill Ackman 的投资组合下跌了 8%，Dev Kantasaria 下跌了 20%，Chris Hohn 下跌了 11%。这些是基于他们年初投资组合的估算。"],
  [/^Important to remind folks that we have zero idea what’s going on w trump\/iran\..*/i, "重要的是提醒大家，我们完全不知道特朗普/伊朗之间发生了什么。这是事实。有些头条新闻几分钟内就会来个 180 度大反转。你当然可以尽情猜测，但现在没有优势。"],
  [/^As I’ve been writing in the DMR\. Oil is the number 1 inflation catalyst.*/i, "正如我一直在 DMR 中写的那样，石油是第一大通胀催化剂。"],
  [/^Apple is nearing its first record close since December after earnings$/i, "财报后苹果接近去年 12 月以来首次创纪录收盘"],
  [/^Apple is now on track for its first record closing high since Dec\. 2.*/i, "苹果有望创下 12 月 2 日以来首个收盘新高，上周失败的突破正在转化为对历史高位区间的新测试。"],
  [/^Apple Pops 5% on Q2 Beat: Has the iPhone Maker Found Its Growth Story Again\?$/i, "第二财季业绩超预期后苹果上涨 5%，市场重新评估其增长故事"],
  [/^Shares of Apple \(NASDAQ:AAPL\) are up roughly 5%.*/i, "苹果股价周五早盘上涨约 5%，此前公司公布强劲第二财季业绩并给出偏乐观指引。"],
  [/^These Stocks Are Today’s Movers: Apple, Sandisk, Roblox, NIO, Atlassian, Western Digital, Clorox, Paramount Skydance, and More$/i, "今日异动股：苹果、Sandisk、Roblox、NIO、Atlassian、西部数据、Clorox、Paramount Skydance 等"],
  [/^Shares of Sandisk and Western Digital slide.*/i, "尽管 Sandisk 与西部数据最新季度业绩稳健，两家公司股价仍走低。"],
  [/^Apple Can't Meet Demand For iPhones Due To Chip Shortages$/i, "芯片短缺导致苹果无法满足 iPhone 需求"],
  [/^Apple is facing supply constraints for its latest iPhones.*/i, "由于台积电先进处理器供应短缺，苹果最新 iPhone 面临供给约束。"],
  [/^TSX opens lower as energy volatility persists$/i, "能源波动延续，加拿大 TSX 指数低开"],
  [/^Investing\.com -- Canada’s primary stock index edged lower.*/i, "加拿大主要股指周五早盘小幅走低，能源价格降温与地缘紧张压制了前一交易日的大幅反弹动能。"],
  [/^Defense Department Notches AI Deals With Nvidia, Amazon, and 5 Others\. Who Was Left Out\?$/i, "美国国防部与英伟达、亚马逊等另外 5 家公司达成人工智能协议。谁被排除在外？"],
  [/^Nvidia, Microsoft, Google, SpaceX, OpenAI, and Amazon will all serve as artificial-intelligence vendors for the Department of Defense\.$/i, "英伟达、微软、谷歌、SpaceX、OpenAI 和亚马逊都将成为美国国防部的人工智能供应商。"],
  [/^Microsoft Corp\. \(MSFT\) Price Target Increased to \$525 by Benchmark$/i, "Benchmark 将微软目标价上调至 525 美元"],
  [/^Microsoft Corporation \(NASDAQ:MSFT\) is one of the 10 Best AI Stocks.*/i, "微软被列为 5 月值得关注的人工智能股票之一；Benchmark 分析师上调目标价并维持买入评级。"],
  [/^Is Amazon Stock A Buy At 34x Earnings\?$/i, "亚马逊 34 倍市盈率是否仍值得买入？"],
  [/^The prevailing market narrative surrounding Amazon \(AMZN\) stock.*/i, "围绕亚马逊的核心叙事集中在 2000 亿美元基础设施投入，以及由此带来的短期自由现金流压力。"],
  [/^S&P 500 and Nasdaq Start May at Fresh Record Highs$/i, "标普 500 与纳斯达克以新高开启 5 月"],
  [/^Stocks started off May with some modest gains.*/i, "美股 5 月开局温和上涨，标普 500 和纳斯达克均创盘中新高。"],
  [/^'Big Consensus Trade' — Billionaire Stanley Druckenmiller Is Betting On This Metal Amid Tight Supply and Surging Demand From AI Data Centers$/i, "供应趋紧叠加人工智能数据中心需求激增，Druckenmiller 押注铜这一热门共识交易"],
  [/^Copper is a no-brainer investment.*/i, "Druckenmiller 认为，人工智能数据中心需求上升和供应紧张使铜成为直接受益资产。"],
  [/^SPS Commerce Q1 Disappoints, Amazon Headwinds Weigh on Growth, Morgan Stanley Says$/i, "摩根士丹利称 SPS Commerce 一季度表现逊色，亚马逊相关逆风拖累增长"],
  [/^SPS Commerce \(SPSC\) reported a disappointing Q1.*/i, "SPS Commerce 一季度收入低于市场预期，并继续受到亚马逊相关逆风影响。"],
  [/^Nvidia Stock Faces an Old Nemesis—the \$200 Level\. It’s Losing Today\.$/i, "英伟达股价再次面对 200 美元关口，今日走势承压"],
  [/^Nvidia stock was falling in early trading Friday.*/i, "英伟达周五早盘下跌，股价继续低于备受关注的 200 美元附近；前一交易日已大跌。"],
  [/^Reddit stock surges after ad revenue jumps 74% in Q1$/i, "一季度广告收入增长 74%，Reddit 股价大涨"],
  [/^Reddit stock jumped after the online platform reported better-than-expected earnings and ad sales\.$/i, "Reddit 公布超预期业绩和广告销售后，股价上涨。"],
  [/^CoreWeave gains as analysts raise outlook on AI demand$/i, "分析师上调人工智能需求预期，CoreWeave 股价上涨"],
  [/^Strong AI demand drives more bullish outlook$/i, "强劲的人工智能需求推动市场预期转向更乐观。"],
  [/^Income Investors Can Rely on Ford’s Dividend: Here’s Why the Payout Is Secure$/i, "收益型投资者可关注福特股息：分红安全性仍有支撑"],
  [/^Ford \(NYSE: F\) sells trucks.*/i, "福特主营卡车、SUV 和商用车，传统业务承担利润来源，而电动车业务仍在消耗现金。"],
  [/^Century Aluminum Is Building a \$4 Billion Smelter\. Is CENX Stock a Buy Right Now\?$/i, "Century Aluminum 将建设 40 亿美元冶炼厂，CENX 现在是否值得买入？"],
  [/^The largest producer of primary aluminum in the United States.*/i, "这家美国最大原铝生产商将与 Emirates Global Aluminum 合作，建设美国 46 年来首个新铝冶炼厂。"],
  [/^The AI Gold Rush Just Hit a New Layer: Here’s Why Sandisk Is Printing Money$/i, "人工智能热潮进入新阶段：Sandisk 为何正在受益"],
  [/^The artificial intelligence boom is entering a new phase.*/i, "人工智能热潮正在进入新阶段，市场焦点从 GPU、数据中心和电力消耗扩展到可自主推理、规划和行动的系统。"],
  [/^David Neeleman Reveals the Burger Chain Strategy That Built Four Airlines.*/i, "David Neeleman 解释连锁餐饮式战略如何帮助其打造四家航空公司，并给创业者启示"],
  [/^When a founder who has launched four airlines tells you to think like a burger chain.*/i, "当一位创办过四家航空公司的企业家建议像连锁餐饮一样思考时，创业者值得认真参考。"],
  [/^Tesla stock higher for week as Semi starts production, company nets \$573M in sales from SpaceX, xAI last year$/i, "Semi 开始生产且去年从 SpaceX、xAI 获得 5.73 亿美元销售额，特斯拉本周股价上涨"],
  [/^Tesla stock is poised to finish the day and week higher.*/i, "特斯拉股价有望以日线和周线收涨，扭转上周财报后的下跌压力。"],
  [/^Tesla Sold SpaceX \$143 Million Worth Of Cars: SEC Filing$/i, "监管文件显示，特斯拉向 SpaceX 销售 1.43 亿美元汽车"],
  [/^An updated SEC filing disclosed Tesla's sale of electric vehicles to CEO Elon Musk's other company SpaceX.*/i, "最新监管文件披露，特斯拉向马斯克旗下另一家公司 SpaceX 销售电动车，特斯拉股价小幅上涨。"],
  [/^Tesla reports \$158 billion Elon Musk compensation for 2025$/i, "特斯拉披露 2025 年马斯克薪酬估值为 1580 亿美元"],
  [/^The figure is almost entirely an accounting-driven valuation.*/i, "该数字几乎完全来自会计估值；相关股份尚未归属，特斯拉称马斯克实际获得薪酬为零。"],
  [/^NIO Stock Drops\. The U\.S\. Isn’t the Only Country With an EV Problem\.$/i, "NIO 股价下跌：电动车需求问题并非只出现在美国"],
  [/^China is facing an EV slowdown, just like the U\.S\..*/i, "中国也面临电动车放缓，部分车企 4 月交付量较 3 月下滑。"],
  [/^Tesla Is Burning Billions to Build Its AI Future—and the Stock Is Feeling It$/i, "特斯拉投入数十亿美元建设人工智能未来，股价正在承受压力"],
  [/^Tesla\s+stock rose in April\..*/i, "特斯拉股价 4 月上涨，这是 2026 年以来首个上涨月份；投资者仍对其实体人工智能计划抱有较高预期。"],
  [/^Tesla Rivals BYD, Geely, Xiaomi See Sales Bump\. These China EV Makers Decline\.$/i, "比亚迪、吉利、小米销量增长，部分中国电动车厂商表现下滑"],
];

const PHRASE_ZH: Array<[RegExp, string]> = [
  [/Rules-based dashboard signal only; not an order or investment advice\./gi, "仅为规则型看板信号，不是订单或投资建议。"],
  [/Market backdrop is mixed with score ([\-\d.]+); keep position sizing moderate and wait for stronger cross-asset confirmation\./gi, "市场背景偏混合，风险分为 $1；仓位保持适中，等待更强的跨资产确认。"],
  [/Market backdrop is constructive with score ([\-\d.]+); favor trend-following exposure while monitoring macro headline risk\./gi, "市场背景偏建设性，风险分为 $1；可偏向趋势跟随敞口，同时监控宏观标题风险。"],
  [/Market backdrop is defensive with score ([\-\d.]+); prioritize cash, hedges, and confirmation before adding beta\./gi, "市场背景偏防御，风险分为 $1；增加 beta 前优先考虑现金、对冲和确认信号。"],
  [/Recommendation unavailable in this snapshot\./gi, "本次快照暂无模型建议。"],
  [/Influencer mock analysis unavailable in this snapshot\./gi, "本次快照暂无影响者模拟分析。"],
  [/Bundled influencer mock analysis loaded instantly; live refresh runs in the background\./gi, "已即时加载内置影响者模拟分析；实时刷新在后台运行。"],
  [/Bundled fallback read; live API refresh will replace this with the full mock analysis when available\./gi, "内置快照解读；实时 API 可用后会替换为完整模拟分析。"],
  [/Mock analysis from influencer feed; dominant themes: ([^.]+)\./gi, "来自影响者信息流的模拟分析；主导主题：$1。"],
  [/Fed net liquidity expanded more than \$0\.10T over 4W/gi, "美联储净流动性 4 周扩张超过 0.10 万亿美元"],
  [/Fed net liquidity drained more than \$0\.10T over 4W/gi, "美联储净流动性 4 周收缩超过 0.10 万亿美元"],
  [/SPY sample breadth above 60% over MA60/gi, "SPY 样本中高于 MA60 的比例超过 60%"],
  [/SPY sample breadth below 40% over MA60/gi, "SPY 样本中高于 MA60 的比例低于 40%"],
  [/Multiple high-impact macro headlines detected/gi, "检测到多条高影响宏观新闻"],
  [/([A-Z]{1,5}): trend above MA60/gi, "$1：趋势高于 MA60"],
  [/([A-Z]{1,5}): below MA60, wait for repair/gi, "$1：低于 MA60，等待修复"],
  [/([A-Z]{1,5}): insufficient trend data/gi, "$1：趋势数据不足"],
  [/Treat as a constructive cross-asset liquidity\/rates signal; validate against Fed liquidity, yields, DXY, SPY\/QQQ trend\./gi, "视为偏建设性的跨资产流动性/利率信号；用美联储流动性、收益率、DXY、SPY/QQQ 趋势验证。"],
  [/Treat as a defensive cross-asset liquidity\/rates signal; validate against Fed liquidity, yields, DXY, SPY\/QQQ trend\./gi, "视为偏防御的跨资产流动性/利率信号；用美联储流动性、收益率、DXY、SPY/QQQ 趋势验证。"],
  [/Treat as a watchful cross-asset liquidity\/rates signal; validate against Fed liquidity, yields, DXY, SPY\/QQQ trend\./gi, "视为需要观察的跨资产流动性/利率信号；用美联储流动性、收益率、DXY、SPY/QQQ 趋势验证。"],
  [/Treat as a constructive headline-risk input; watch oil, VIX, USD\/JPY, and gap risk before adding beta\./gi, "视为偏建设性的标题风险输入；增加 beta 前关注油价、VIX、USD/JPY 和跳空风险。"],
  [/Treat as a defensive headline-risk input; watch oil, VIX, USD\/JPY, and gap risk before adding beta\./gi, "视为偏防御的标题风险输入；增加 beta 前关注油价、VIX、USD/JPY 和跳空风险。"],
  [/Treat as a watchful headline-risk input; watch oil, VIX, USD\/JPY, and gap risk before adding beta\./gi, "视为需要观察的标题风险输入；增加 beta 前关注油价、VIX、USD/JPY 和跳空风险。"],
  [/Treat as a constructive market-tape read; confirm with SPY\/QQQ MA60, breadth, and options positioning\./gi, "视为偏建设性的盘面解读；用 SPY/QQQ MA60、市场宽度和期权定位确认。"],
  [/Treat as a defensive market-tape read; confirm with SPY\/QQQ MA60, breadth, and options positioning\./gi, "视为偏防御的盘面解读；用 SPY/QQQ MA60、市场宽度和期权定位确认。"],
  [/Treat as a watchful market-tape read; confirm with SPY\/QQQ MA60, breadth, and options positioning\./gi, "视为需要观察的盘面解读；用 SPY/QQQ MA60、市场宽度和期权定位确认。"],
  [/Treat as a constructive single-name watch item; confirm with M7 trend, PE, and option structure\./gi, "视为偏建设性的个股观察项；用 M7 趋势、PE 和期权结构确认。"],
  [/Treat as a defensive single-name watch item; confirm with M7 trend, PE, and option structure\./gi, "视为偏防御的个股观察项；用 M7 趋势、PE 和期权结构确认。"],
  [/Treat as a watchful single-name watch item; confirm with M7 trend, PE, and option structure\./gi, "视为需要观察的个股观察项；用 M7 趋势、PE 和期权结构确认。"],
  [/Treat as a constructive inflation\/geopolitics input; watch crude transmission into CPI and yields\./gi, "视为偏建设性的通胀/地缘输入；关注原油价格向 CPI 和收益率的传导。"],
  [/Treat as a defensive inflation\/geopolitics input; watch crude transmission into CPI and yields\./gi, "视为偏防御的通胀/地缘输入；关注原油价格向 CPI 和收益率的传导。"],
  [/Treat as a watchful inflation\/geopolitics input; watch crude transmission into CPI and yields\./gi, "视为需要观察的通胀/地缘输入；关注原油价格向 CPI 和收益率的传导。"],
  [/Treat as a constructive AI-tech narrative input; map it to megacap duration risk and semiconductor leadership\./gi, "视为偏建设性的人工智能科技叙事输入；映射到大型科技股久期风险和半导体领涨结构。"],
  [/Treat as a defensive AI-tech narrative input; map it to megacap duration risk and semiconductor leadership\./gi, "视为偏防御的人工智能科技叙事输入；映射到大型科技股久期风险和半导体领涨结构。"],
  [/Treat as a watchful AI-tech narrative input; map it to megacap duration risk and semiconductor leadership\./gi, "视为需要观察的人工智能科技叙事输入；映射到大型科技股久期风险和半导体领涨结构。"],
  [/Treat as a constructive liquidity-beta input; watch risk appetite spillover into high beta equities\./gi, "视为偏建设性的流动性 beta 输入；关注风险偏好向高 beta 股票的外溢。"],
  [/Treat as a defensive liquidity-beta input; watch risk appetite spillover into high beta equities\./gi, "视为偏防御的流动性 beta 输入；关注风险偏好向高 beta 股票的外溢。"],
  [/Treat as a watchful liquidity-beta input; watch risk appetite spillover into high beta equities\./gi, "视为需要观察的流动性 beta 输入；关注风险偏好向高 beta 股票的外溢。"],
  [/Treat as a constructive narrative signal; use price confirmation before acting on it\./gi, "视为偏建设性的叙事信号；行动前需要价格确认。"],
  [/Treat as a defensive narrative signal; use price confirmation before acting on it\./gi, "视为偏防御的叙事信号；行动前需要价格确认。"],
  [/Treat as a watchful narrative signal; use price confirmation before acting on it\./gi, "视为需要观察的叙事信号；行动前需要价格确认。"],
  [/latest USD rates/gi, "最新美元汇率"],
  [/not available in Vercel runtime/gi, "Vercel 运行时不可用"],
  [/unavailable or empty/gi, "不可用或为空"],
  [/unavailable/gi, "不可用"],
  [/latest close from Cboe CSV/gi, "Cboe CSV 最新收盘"],
  [/Bundled snapshot renders immediately; live data refreshes after load\./gi, "内置快照即时渲染；实时数据可手动刷新。"],
  [/RSS unavailable or empty/gi, "RSS 不可用或为空"],
  [/RSS items/gi, "条 RSS 内容"],
  [/stock news items/gi, "条个股新闻"],
  [/quotes/gi, "报价"],
  [/histories/gi, "历史数据"],
  [/option chains/gi, "期权链"],
  [/TTM EPS values/gi, "个 TTM EPS 值"],
  [/No bundled influencer analysis available\./gi, "暂无内置影响者分析。"],
  [/Bundled influencer analysis unavailable\./gi, "内置影响者分析不可用。"],
  [/No influencer mock analysis items available in the latest collection\./gi, "最新合集暂无影响者模拟分析条目。"],
  [/Influencer mock analysis unavailable; local collection file is not readable in this runtime\./gi, "影响者模拟分析不可用；当前运行环境无法读取本地合集文件。"],
  [/No recent market-relevant post extracted/gi, "未提取到近期市场相关内容"],
  [/Macro \/ Fed/gi, "宏观 / 美联储"],
  [/Geopolitics/gi, "地缘政治"],
  [/Equity Tape/gi, "股市盘面"],
  [/Single Stocks/gi, "个股"],
  [/Commodities/gi, "大宗商品"],
  [/AI \/ Tech/gi, "人工智能 / 科技"],
  [/Crypto/gi, "加密资产"],
  [/Market Narrative/gi, "市场叙事"],
];

const WORD_ZH: Array<[RegExp, string]> = [
  [/\bFederal Reserve\b/gi, "美联储"],
  [/\bFed\b/g, "美联储"],
  [/\bCPI\b/g, "消费者通胀"],
  [/\bPCE\b/g, "个人消费支出通胀"],
  [/\beSLR\b/g, "补充杠杆率"],
  [/\bCEO\b/g, "首席执行官"],
  [/\bGPU\b/g, "图形处理器"],
  [/\bSUVs?\b/g, "运动型多用途车"],
  [/\bTreasury\b/gi, "财政部"],
  [/\binflation\b/gi, "通胀"],
  [/\btariff(s)?\b/gi, "关税"],
  [/\bwar\b/gi, "战争"],
  [/\boil\b/gi, "石油"],
  [/\byield(s)?\b/gi, "收益率"],
  [/\brate(s)?\b/gi, "利率"],
  [/\bmarket(s)?\b/gi, "市场"],
  [/\bstock(s)?\b/gi, "股票"],
  [/\boption(s)?\b/gi, "期权"],
  [/\bvolatility\b/gi, "波动率"],
  [/\bliquidity\b/gi, "流动性"],
  [/\brisk\b/gi, "风险"],
  [/\bbuyback(s)?\b/gi, "回购"],
  [/\bearnings\b/gi, "财报"],
  [/\bAI\b/g, "人工智能"],
];

const NAME_ZH: Array<[RegExp, string]> = [
  [/\bSen\. Chris Coons\b/g, "参议员克里斯·库恩斯"],
  [/\bCEO\b/g, "首席执行官"],
  [/\bGPU\b/g, "图形处理器"],
  [/\bSUVs?\b/g, "运动型多用途车"],
  [/\bSemi\b/g, "电动卡车"],
  [/\bChris Coons\b/g, "克里斯·库恩斯"],
  [/\bHoward Lutnick\b/g, "霍华德·卢特尼克"],
  [/\bLutnick\b/g, "卢特尼克"],
  [/\bJensen Huang\b/g, "黄仁勋"],
  [/\bKing Charles\b/g, "查尔斯国王"],
  [/\bAtlassian\b/g, "阿特拉斯"],
  [/\bRoblox\b/g, "罗布乐思"],
  [/\bPython\b/g, "软件生态"],
  [/\bPyPI\b/g, "软件包仓库"],
  [/\bKharg Island\b/g, "哈尔克岛"],
  [/\bKharg\b/g, "哈尔克"],
  [/\biPhones?\b/gi, "苹果手机"],
  [/\bSandisk\b/gi, "闪迪"],
  [/\bWestern Digital\b/g, "西部数据"],
  [/\bClorox\b/g, "高乐氏"],
  [/\bParamount Skydance\b/g, "派拉蒙天舞"],
  [/\bCoreWeave\b/g, "云计算公司"],
  [/\bReddit\b/g, "红迪"],
  [/\bBenchmark\b/g, "基准研究"],
  [/\bMorgan Stanley\b/g, "摩根士丹利"],
  [/\bStanley Druckenmiller\b/g, "斯坦利·德鲁肯米勒"],
  [/\bDruckenmiller\b/g, "德鲁肯米勒"],
  [/\bSPS Commerce\b/g, "电商软件公司"],
  [/\bCentury Aluminum\b/g, "世纪铝业"],
  [/\bEmirates Global Aluminum\b/g, "阿联酋环球铝业"],
  [/\bDavid Neeleman\b/g, "戴维·尼尔曼"],
  [/\bJetBlue\b/g, "捷蓝航空"],
  [/\bBreeze Airways\b/g, "微风航空"],
  [/\bSpaceX\b/g, "航天公司"],
  [/\bxAI\b/g, "人工智能公司"],
  [/\bOpenAI\b/g, "人工智能公司"],
  [/\bGoogle\b/g, "谷歌"],
  [/\bMicrosoft\b/g, "微软"],
  [/\bAmazon\b/g, "亚马逊"],
  [/\bNvidia\b/g, "英伟达"],
  [/\bApple\b/g, "苹果"],
  [/\bTesla\b/g, "特斯拉"],
  [/\bFord\b/g, "福特"],
  [/\bMeta\b/g, "脸书母公司"],
  [/\bBYD\b/g, "比亚迪"],
  [/\bGeely\b/g, "吉利"],
  [/\bXiaomi\b/g, "小米"],
  [/\bTSX\b/g, "加拿大股指"],
  [/\bScotch\b/g, "苏格兰"],
  [/\bSaaS\b/g, "软件服务"],
];

function protectTickers(text: string) {
  const tokens: string[] = [];
  const protectedText = text.replace(/\$?\b(?:AAPL|MSFT|AMZN|GOOGL|GOOG|META|NVDA|TSLA|SPY|QQQ|NIO|CENX|SPSC|NOW|INTU|ADBE|CRM|FICO|UBER)\b/g, (match) => {
    const key = `__TK${tokens.length}__`;
    tokens.push(match);
    return key;
  });
  return { protectedText, tokens };
}

function restoreTickers(text: string, tokens: string[]) {
  return tokens.reduce((result, token, index) => result.replaceAll(`__TK${index}__`, token), text);
}

function knownZhText(value: string) {
  return KNOWN_TEXT_ZH.find(([pattern]) => pattern.test(value))?.[1];
}

function translateNames(text: string) {
  let translated = text;
  for (const [pattern, replacement] of NAME_ZH) translated = translated.replace(pattern, replacement);
  return translated;
}

function translatedPhraseText(value: string) {
  const { protectedText, tokens } = protectTickers(value);
  let translated = protectedText;
  for (const [pattern, replacement] of PHRASE_ZH) translated = translated.replace(pattern, replacement);
  for (const [pattern, replacement] of WORD_ZH) translated = translated.replace(pattern, replacement);
  return translateNames(restoreTickers(translated, tokens));
}

function zhText(value: string | undefined) {
  if (!value) return "";
  const direct = UI_ZH[value];
  if (direct) return direct;
  const known = knownZhText(value);
  if (known) return translateNames(known);
  return translatedPhraseText(value);
}

function localize(value: string | undefined, lang: Lang) {
  if (!value) return "";
  return lang === "zh" ? zhText(value) : (UI_EN[value] ?? value);
}

const ALLOWED_LATIN_TEXT = new Set([
  "AI",
  "M7",
  "SPY",
  "QQQ",
  "VIX",
  "USD",
  "JPY",
  "CNY",
  "AAPL",
  "MSFT",
  "AMZN",
  "GOOGL",
  "GOOG",
  "META",
  "NVDA",
  "TSLA",
  "NIO",
]);

function needsServerTranslation(value: string) {
  const words = value.match(/[A-Za-z][A-Za-z'’.-]{2,}/g) ?? [];
  return words.some((word) => !ALLOWED_LATIN_TEXT.has(word.toUpperCase()));
}

const translationCache = new Map<string, string>();

function TranslatedText({ value, lang }: { value: string; lang: Lang }) {
  const syncText = localize(value, lang);
  const shouldTranslate = lang === "zh" && needsServerTranslation(syncText);
  const [translated, setTranslated] = useState(() => shouldTranslate ? (translationCache.get(value) ?? "") : syncText);

  useEffect(() => {
    if (!shouldTranslate) {
      setTranslated(syncText);
      return;
    }
    const cached = translationCache.get(value);
    if (cached) {
      setTranslated(cached);
      return;
    }

    let cancelled = false;
    setTranslated("");
    void fetch("/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts: [value] }),
    })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`translate ${response.status}`)))
      .then((payload: { translations?: Record<string, string> }) => {
        const next = payload.translations?.[value] ?? syncText;
        translationCache.set(value, next);
        if (!cancelled) setTranslated(next);
      })
      .catch(() => {
        if (!cancelled) setTranslated("翻译失败");
      });
    return () => {
      cancelled = true;
    };
  }, [lang, shouldTranslate, syncText, value]);

  return <>{translated || "翻译中..."}</>;
}

function localizeSource(value: string | undefined, lang: Lang) {
  if (!value || lang === "en") return value ?? "";
  const yahoo = value.match(/^Yahoo Finance ([A-Z]{1,6})$/);
  if (yahoo) return `雅虎财经 ${yahoo[1]}`;
  if (value === "Yahoo Finance") return "雅虎财经";
  if (value === "MarketWatch") return "市场观察";
  if (value === "CNBC") return "财经电视台";
  if (value === "Influencer/Press latest.md") return "影响者与媒体合集";
  if (value.includes("influencer-and-press-collection-agent")) return "影响者与媒体合集";
  return localize(value, lang);
}

function fmt(value: Scalar | undefined, suffix = "") {
  if (value === undefined || value === "N/A" || Number.isNaN(value)) return "N/A";
  return `${value}${suffix}`;
}

function subtractScalar(left: Scalar | undefined, right: Scalar | undefined): Scalar {
  if (typeof left !== "number" || typeof right !== "number") return "N/A";
  return Number((left - right).toFixed(2));
}

function tone(value: Scalar | undefined) {
  if (typeof value !== "number") return "";
  if (value > 0) return "green";
  if (value < 0) return "red";
  return "";
}

function shortTime(value: string) {
  if (!value) return "";
  const time = Date.parse(value);
  return Number.isNaN(time) ? value.slice(0, 18) : new Date(time).toLocaleString();
}

function NewsList({ items, lang }: { items: NewsItem[]; lang: Lang }) {
  if (!items.length) return <div className="empty">{localize("No items in this snapshot.", lang)}</div>;
  return (
    <div className="list">
      {items.map((item, index) => (
        <article className="news-item" key={`${item.url || item.title}-${index}`}>
          <div className="news-top">
            <span>{localizeSource(item.source, lang)}</span>
            <span>{shortTime(item.publishedAt)}</span>
          </div>
          <p className="news-title">
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer">
                <TranslatedText value={item.title} lang={lang} />
              </a>
            ) : <TranslatedText value={item.title} lang={lang} />}
          </p>
          {item.summary ? <p className="news-summary"><TranslatedText value={item.summary} lang={lang} /></p> : null}
        </article>
      ))}
    </div>
  );
}

function Metric({ label, value, detail, lang }: { label: string; value: Scalar; detail: string; lang: Lang }) {
  return (
    <div className="metric">
      <span>{localize(label, lang)}</span>
      <strong>{fmt(value)}</strong>
      <small className={detail.includes("-") ? "red" : detail.includes("N/A") ? "" : "green"}>{localize(detail, lang)}</small>
    </div>
  );
}

function stanceClass(stance: string) {
  if (stance === "bullish") return "good";
  if (stance === "bearish") return "bad";
  if (stance === "watch") return "warn";
  return "";
}

function numericValue(value: Scalar | string | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatMetricName(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}

function utcDay(value: string) {
  return Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function dateKeyFromUtc(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function OptionLineChart({ points, metric, days }: { points: OptionHistoryPoint[]; metric: string; days: number }) {
  const numericPoints = points
    .map((point) => ({ date: point.date, value: numericValue(point.values[metric]) }))
    .filter((point): point is { date: string; value: number } => point.value !== null);

  if (!numericPoints.length) return <div className="empty chart-empty">No option history for this symbol/metric.</div>;

  const width = 720;
  const height = 220;
  const padX = 44;
  const padY = 24;
  const axisDays = Math.max(days, 1);
  const dayMs = 24 * 60 * 60 * 1000;
  const endMs = Math.max(...numericPoints.map((point) => utcDay(point.date)));
  const startMs = endMs - (axisDays - 1) * dayMs;
  const visiblePoints = numericPoints.filter((point) => {
    const pointMs = utcDay(point.date);
    return pointMs >= startMs && pointMs <= endMs;
  });
  const values = visiblePoints.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(Math.abs(max), 1);
  const xForDate = (date: string) => {
    const offset = Math.max(0, Math.min(axisDays - 1, Math.round((utcDay(date) - startMs) / dayMs)));
    const denominator = Math.max(axisDays - 1, 1);
    return padX + (offset / denominator) * (width - padX * 2);
  };
  const yFor = (value: number) => height - padY - ((value - min) / span) * (height - padY * 2);
  const line = visiblePoints.length === 1
    ? (() => {
      const point = visiblePoints[0];
      const x = xForDate(point.date);
      const y = yFor(point.value);
      const left = Math.max(padX, Math.min(width - padX - 16, x - 8));
      return `M ${left.toFixed(2)} ${y.toFixed(2)} L ${(left + 16).toFixed(2)} ${y.toFixed(2)}`;
    })()
    : visiblePoints.map((point, index) => `${index ? "L" : "M"} ${xForDate(point.date).toFixed(2)} ${yFor(point.value).toFixed(2)}`).join(" ");
  const first = visiblePoints[0];
  const last = visiblePoints.at(-1) ?? first;
  const tickOffsets = [...new Set([0, Math.round((axisDays - 1) * 0.25), Math.round((axisDays - 1) * 0.5), Math.round((axisDays - 1) * 0.75), axisDays - 1])];
  const ticks = tickOffsets.map((offset) => {
    const date = dateKeyFromUtc(startMs + offset * dayMs);
    const x = padX + (offset / Math.max(axisDays - 1, 1)) * (width - padX * 2);
    return { date, x };
  });

  return (
    <div className="chart-wrap">
      <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric} latest ${days} calendar days option history`}>
        <line x1={padX} x2={width - padX} y1={height - padY} y2={height - padY} />
        <line x1={padX} x2={padX} y1={padY} y2={height - padY} />
        {ticks.map((tick) => (
          <g key={tick.date}>
            <line className="tick-line" x1={tick.x} x2={tick.x} y1={padY} y2={height - padY} />
            <text x={tick.x} y={height - 5} textAnchor="middle">{tick.date.slice(5)}</text>
          </g>
        ))}
        <text x={padX - 8} y={padY + 4} textAnchor="end">{fmt(max)}</text>
        <text x={padX - 8} y={height - padY} textAnchor="end">{fmt(min)}</text>
        <path d={line} />
        {visiblePoints.map((point, index) => (
          <circle key={`${point.date}-${point.value}-${index}`} cx={xForDate(point.date)} cy={yFor(point.value)} r={4.5}>
            <title>{point.date}: {fmt(point.value)}</title>
          </circle>
        ))}
      </svg>
      <div className="chart-stats">
        <span>{first.date}: {fmt(first.value)}</span>
        <strong>{formatMetricName(metric)}</strong>
        <span>{last.date}: {fmt(last.value)}</span>
      </div>
    </div>
  );
}

export function MarketDashboard({ initialData }: Props) {
  const [data, setData] = useState(initialData);
  const [activeTicker, setActiveTicker] = useState(initialData.meta?.watchlist?.[0] ?? "AAPL");
  const [activeOptionTicker, setActiveOptionTicker] = useState("QQQ");
  const [activeOptionMetric, setActiveOptionMetric] = useState("iv");
  const [optionHistory, setOptionHistory] = useState<OptionHistory | null>(null);
  const [isOptionHistoryLoading, setIsOptionHistoryLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lang, setLang] = useState<Lang>("zh");
  const didInitialRefresh = useRef(false);
  const stockRows = useMemo(() => Object.entries(data.stockIndicators ?? {}), [data.stockIndicators]);
  const watchlist = data.meta?.watchlist ?? [];
  const optionSymbols = useMemo(() => [...new Set(["QQQ", "SPY", ...watchlist])], [watchlist]);

  async function refreshOptionHistory() {
    if (!optionSymbols.length) return;
    setIsOptionHistoryLoading(true);
    try {
      const response = await fetch(`/api/options/history?symbols=${encodeURIComponent(optionSymbols.join(","))}&days=${OPTION_AXIS_DAYS}&metrics=all`, { cache: "no-store" });
      if (!response.ok) throw new Error(`option history ${response.status}`);
      const next = await response.json() as OptionHistory;
      setOptionHistory(next);
      if (!next.availableMetrics.includes(activeOptionMetric)) setActiveOptionMetric(next.availableMetrics[0] ?? "iv");
    } finally {
      setIsOptionHistoryLoading(false);
    }
  }

  async function refresh() {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/snapshot", { cache: "no-store" });
      if (!response.ok) throw new Error(`snapshot ${response.status}`);
      setData(await response.json() as MarketSnapshot);
      void refreshOptionHistory();
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    if (didInitialRefresh.current) return;
    didInitialRefresh.current = true;
    void refresh();
    void refreshOptionHistory();
  }, []);

  useEffect(() => {
    void refreshOptionHistory();
  }, [optionSymbols.join(",")]);

  useEffect(() => {
    const refreshSeconds = data.meta?.refreshSeconds ?? 300;
    const interval = window.setInterval(refresh, refreshSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [data.meta?.refreshSeconds]);

  const activeNews = data.stockNews?.[activeTicker] ?? [];
  const activeOptionPoints = optionHistory?.symbols?.[activeOptionTicker] ?? [];
  const optionMetrics = optionHistory?.availableMetrics?.length ? optionHistory.availableMetrics : ["iv", "ivRank", "ivPercentile", "putCallOiRatio"];
  const indices = data.macroIndicators?.indices ?? {};
  const volatility = data.macroIndicators?.volatility ?? {};
  const fx = data.macroIndicators?.fx ?? {};
  const bonds = data.macroIndicators?.bonds ?? {};
  const breadth = data.macroIndicators?.breadth ?? {};
  const qqq = indices.QQQ ?? EMPTY_INDEX;
  const spy = indices.SPY ?? EMPTY_INDEX;
  const vix = volatility.VIX ?? EMPTY_VALUE;
  const liquidity = data.macroIndicators?.liquidity ?? EMPTY_LIQUIDITY;
  const usdjpy = fx.USDJPY ?? EMPTY_VALUE;
  const influencerMockAnalysis = data.influencerMockAnalysis ?? {
    asOf: "",
    source: "unavailable",
    summary: "Influencer mock analysis unavailable in this snapshot.",
    items: [],
  };

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <img className="brand-icon" src="/bull.png" alt="" />
          <h1>Stock Market Agent</h1>
          <span className="stamp">{localize("Updated", lang)} {shortTime(data.generatedAt)}</span>
        </div>
        <div className="toolbar">
          <div className="language-toggle" aria-label="Language">
            <button className={lang === "zh" ? "active" : ""} type="button" onClick={() => setLang("zh")}>中文</button>
            <span>|</span>
            <button className={lang === "en" ? "active" : ""} type="button" onClick={() => setLang("en")}>English</button>
          </div>
          <button className="refresh" type="button" onClick={refresh} disabled={isRefreshing} title="Refresh snapshot">
            {localize(isRefreshing ? "Refreshing" : "Refresh", lang)}
          </button>
          {(data.sourcesStatus ?? []).slice(0, 10).map((source) => (
            <span
              className={`pill ${source.status === "ok" || source.status === "available" ? "good" : source.status === "missing" ? "warn" : ""}`}
              key={`${source.name}-${source.status}`}
              title={localize(source.detail, lang)}
            >
              {source.name}: {localize(source.status, lang)}
            </span>
          ))}
        </div>
      </header>

      <section className="dashboard">
        <article className="panel">
          <header className="panel-head">
            <div className="panel-title"><span className="dot" /><strong>{localize("宏观新闻", lang)}</strong></div>
            <div className="panel-actions">{(data.macroNews ?? []).length} {localize("items", lang)}</div>
          </header>
          <div className="scroll"><NewsList items={data.macroNews ?? []} lang={lang} /></div>
        </article>

        <article className="panel">
          <header className="panel-head">
            <div className="panel-title"><span className="dot" /><strong>{localize("个股新闻", lang)}</strong></div>
            <div className="panel-actions">{watchlist.length} {localize("tickers", lang)}</div>
          </header>
          <div className="scroll">
            <div className="tabs">
              {watchlist.map((ticker) => (
                <button className={`tab ${ticker === activeTicker ? "active" : ""}`} key={ticker} onClick={() => setActiveTicker(ticker)} type="button">
                  {ticker}
                </button>
              ))}
            </div>
            <NewsList items={activeNews} lang={lang} />
          </div>
        </article>

        <article className="panel">
          <header className="panel-head">
            <div className="panel-title"><span className="dot" /><strong>{localize("宏观指标", lang)}</strong></div>
            <div className="panel-actions">{localize("Dynamic API", lang)}</div>
          </header>
          <div className="scroll">
            <div className="metrics">
              <Metric label="SPY" value={spy.price} detail={`${fmt(spy.change1dPct, "%")} 1D`} lang={lang} />
              <Metric label="QQQ" value={qqq.price} detail={`${fmt(qqq.change1dPct, "%")} 1D`} lang={lang} />
              <Metric label="VIX" value={vix.value} detail={`${fmt(vix.change1dPct, "%")} 1D`} lang={lang} />
              <Metric label="Fed Liquidity" value={liquidity.netLiquidity} detail={`${fmt(liquidity.netLiquidityChange4w, "T")} 4W`} lang={lang} />
              <Metric label="USD/JPY" value={usdjpy.value} detail={usdjpy.source} lang={lang} />
            </div>
            <div className="subgrid">
              <section className="section">
                <div className="section-title"><span>{localize("Fed Liquidity", lang)}</span><span>{liquidity.asOf || "FRED"}</span></div>
                <table>
                  <thead><tr><th>{localize("Measure", lang)}</th><th>{localize("Value", lang)}</th><th>1W</th><th>4W</th></tr></thead>
                  <tbody>
                    <tr><td title={liquidity.formula}>{localize("Net Liquidity", lang)}</td><td>{fmt(liquidity.netLiquidity, "T")}</td><td className={tone(liquidity.netLiquidityChange1w)}>{fmt(liquidity.netLiquidityChange1w, "T")}</td><td className={tone(liquidity.netLiquidityChange4w)}>{fmt(liquidity.netLiquidityChange4w, "T")}</td></tr>
                    <tr><td title="WALCL">{localize("Fed Balance Sheet", lang)}</td><td>{fmt(liquidity.fedBalanceSheet, "T")}</td><td colSpan={2} /></tr>
                    <tr><td title="WTREGEN">{localize("Treasury General Account", lang)}</td><td>{fmt(liquidity.tga, "T")}</td><td colSpan={2} /></tr>
                    <tr><td title="RRPONTSYD">{localize("Reverse Repo", lang)}</td><td>{fmt(liquidity.rrp, "T")}</td><td colSpan={2}>{localize(liquidity.source, lang)}</td></tr>
                  </tbody>
                </table>
              </section>
              <section className="section">
                <div className="section-title"><span>{localize("ETF Valuation / Trend", lang)}</span><span>MA</span></div>
                <table>
                  <thead><tr><th>{localize("Name", lang)}</th><th>PE</th><th>MA10</th><th>MA30</th><th>MA60</th><th>MA180</th><th>ATR</th></tr></thead>
                  <tbody>
                    {Object.entries(indices).map(([name, item]) => (
                      <tr key={name}><td title={item.peSource}>{name}</td><td>{fmt(item.pe)}</td><td>{fmt(item.ma10)}</td><td>{fmt(item.ma30)}</td><td>{fmt(item.ma60)}</td><td>{fmt(item.ma180)}</td><td>{fmt(item.atr14)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="section">
                <div className="section-title"><span>{localize("Vol / FX / Bonds", lang)}</span><span>{localize("Cross Asset", lang)}</span></div>
                <table>
                  <thead><tr><th>{localize("Asset", lang)}</th><th>{localize("Value", lang)}</th><th>{localize("Change", lang)}</th></tr></thead>
                  <tbody>
                    {[
                      ["QQQ VIX", volatility.QQQ_VIX_PROXY?.value, volatility.QQQ_VIX_PROXY?.change1dPct],
                      ["SPY VIX", volatility.SPY_VIX_PROXY?.value, volatility.SPY_VIX_PROXY?.change1dPct],
                      ["USD/CNY", fx.USDCNY?.value, fx.USDCNY?.change1dPct],
                      ["USD/JPY", fx.USDJPY?.value, fx.USDJPY?.change1dPct],
                      ["US 1Y", (bonds.US1Y ?? EMPTY_YIELD).yield, (bonds.US1Y ?? EMPTY_YIELD).change5dPct],
                      ["US 10Y", (bonds.US10Y ?? EMPTY_YIELD).yield, (bonds.US10Y ?? EMPTY_YIELD).change5dPct],
                      ["US 20Y", (bonds.US20Y ?? EMPTY_YIELD).yield, (bonds.US20Y ?? EMPTY_YIELD).change5dPct],
                      ["US 30Y", (bonds.US30Y ?? EMPTY_YIELD).yield, (bonds.US30Y ?? EMPTY_YIELD).change5dPct],
                    ].map(([name, value, change]) => (
                      <tr key={name as string}><td>{name}</td><td>{fmt(value as Scalar)}</td><td className={tone(change as Scalar)}>{fmt(change as Scalar, "%")}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="section">
                <div className="section-title"><span>{localize("Option Structure", lang)}</span><span>Nasdaq</span></div>
                <table>
                  <thead><tr><th>{localize("Name", lang)}</th><th>{localize("Max Pain", lang)}</th><th>IV</th><th>P/C OI</th><th>{localize("Expiry", lang)}</th></tr></thead>
                  <tbody>
                    {Object.entries(indices).map(([name, item]) => (
                      <tr key={name}><td>{name}</td><td>{fmt(item.option.maxPain)}</td><td>{fmt(item.option.iv, "%")}</td><td>{fmt(item.option.putCallOiRatio)}</td><td>{item.option.expiration}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="section">
                <div className="section-title"><span>{localize("Market Breadth", lang)}</span><span>{localize("Sample AMA", lang)}</span></div>
                <table>
                  <thead><tr><th>{localize("Name", lang)}</th><th>AMA10</th><th>AMA30</th><th>AMA60</th><th>AMA180</th></tr></thead>
                  <tbody>
                    {Object.entries(breadth).map(([name, item]) => (
                      <tr key={name}><td>{name}</td><td>{fmt(item.ama10 as Scalar, "%")}</td><td>{fmt(item.ama30 as Scalar, "%")}</td><td>{fmt(item.ama60 as Scalar, "%")}</td><td>{fmt(item.ama180 as Scalar, "%")}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          </div>
        </article>

        <article className="panel">
          <header className="panel-head">
            <div className="panel-title"><span className="dot" /><strong>{localize("个股指标", lang)}</strong></div>
            <div className="panel-actions">{localize("M7 configurable", lang)}</div>
          </header>
          <div className="scroll">
            <table>
              <thead>
                <tr><th>{localize("Ticker", lang)}</th><th>{localize("Price", lang)}</th><th>1D</th><th>PE</th><th>MA10</th><th>MA30</th><th>MA60</th><th>MA180</th><th>ATR</th><th>{localize("1x ATR Stop", lang)}</th><th>{localize("Option MaxPain", lang)}</th><th>IV</th></tr>
              </thead>
              <tbody>
                {stockRows.map(([ticker, item]) => (
                  <tr key={ticker}>
                    <td title={item.timestamp}>{ticker}</td>
                    <td>{fmt(item.price)}</td>
                    <td className={tone(item.change1dPct)}>{fmt(item.change1dPct, "%")}</td>
                    <td title={item.peSource}>{fmt(item.pe)}</td>
                    <td>{fmt(item.ma10)}</td>
                    <td>{fmt(item.ma30)}</td>
                    <td>{fmt(item.ma60)}</td>
                    <td>{fmt(item.ma180)}</td>
                    <td>{fmt(item.atr14)}</td>
                    <td>{fmt(subtractScalar(item.price, item.atr14))}</td>
                    <td>{fmt(item.option.maxPain)}</td>
                    <td>{fmt(item.option.iv, "%")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="option-indicators">
        <header className="panel-head">
          <div className="panel-title"><span className="dot" /><strong>{localize("期权指标", lang)}</strong></div>
          <div className="panel-actions">{lang === "zh" ? `最近 ${OPTION_AXIS_DAYS} 天 SQL 数据` : `Latest ${OPTION_AXIS_DAYS} calendar days`}{isOptionHistoryLoading ? ` · ${localize("Refreshing", lang)}` : ""}</div>
        </header>
        <div className="option-chart-body">
          <div className="tabs compact-tabs">
            {optionSymbols.map((ticker) => (
              <button className={`tab ${ticker === activeOptionTicker ? "active" : ""}`} key={ticker} onClick={() => setActiveOptionTicker(ticker)} type="button">
                {ticker}
              </button>
            ))}
          </div>
          <div className="metric-tabs" aria-label="Option metrics">
            {optionMetrics.map((metric) => (
              <button className={`metric-tab ${metric === activeOptionMetric ? "active" : ""}`} key={metric} onClick={() => setActiveOptionMetric(metric)} type="button" title={metric}>
                {formatMetricName(metric)}
              </button>
            ))}
          </div>
          <OptionLineChart points={activeOptionPoints} metric={activeOptionMetric} days={OPTION_AXIS_DAYS} />
        </div>
      </section>

      <section className="recommendation">
        <div className="rec-grid">
          <div className="posture">
            <span className={`pill ${data.recommendation?.posture === "Risk-on" ? "good" : data.recommendation?.posture === "Risk-off" ? "bad" : "warn"}`}>{localize("Model Posture", lang)}</span>
            <strong className={data.recommendation?.posture === "Risk-on" ? "green" : data.recommendation?.posture === "Risk-off" ? "red" : "amber"}>{localize(data.recommendation?.posture ?? "Neutral", lang)}</strong>
            <p className="rec-text">{localize("Risk score", lang)}: {data.recommendation?.riskScore ?? "N/A"}</p>
          </div>
          <div>
            <p className="rec-text">{localize(data.recommendation?.summary ?? "Recommendation unavailable in this snapshot.", lang)}</p>
            <p className="rec-text">{localize(data.recommendation?.disclaimer ?? "Rules-based dashboard signal only; not an order or investment advice.", lang)}</p>
          </div>
          <div className="subgrid">
            <section className="section">
              <div className="section-title">{localize("Drivers", lang)}</div>
              <ul className="rec-list">{(data.recommendation?.drivers?.length ? data.recommendation.drivers : ["No major drivers."]).map((item) => <li key={item}>{localize(item, lang)}</li>)}</ul>
            </section>
            <section className="section">
              <div className="section-title">{localize("Focus", lang)}</div>
              <ul className="rec-list">{(data.recommendation?.focus?.length ? data.recommendation.focus : ["No focus list."]).map((item) => <li key={item}>{localize(item, lang)}</li>)}</ul>
            </section>
          </div>
        </div>
      </section>

      <section className="influencer-analysis">
        <header className="panel-head">
          <div className="panel-title"><span className="dot" /><strong>{localize("Influencer AI Mock Analysis", lang)}</strong></div>
          <div className="panel-actions">{influencerMockAnalysis.asOf || "latest.md"}</div>
        </header>
        <div className="analysis-summary">
          {lang === "en" ? <p className="rec-text">{influencerMockAnalysis.summary}</p> : null}
          <span className="stamp" title={influencerMockAnalysis.source}>{localizeSource(influencerMockAnalysis.source, lang)}</span>
        </div>
        {influencerMockAnalysis.items.length ? (
          <div className="analysis-grid">
            {influencerMockAnalysis.items.map((item) => (
              <article className="analysis-card" key={`${item.handle}-${item.theme}`}>
                <div className="analysis-top">
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.handle} · {localize(item.domain, lang)}</span>
                  </div>
                  <span className={`pill ${stanceClass(item.stance)}`}>{localize(item.stance, lang)}</span>
                </div>
                {item.profileBio ? <p className="analysis-bio"><TranslatedText value={item.profileBio} lang={lang} /></p> : null}
                <div className="section-title"><span>{localize(item.theme, lang)}</span><span>{localize("mock read", lang)}</span></div>
                <p className="analysis-thesis"><TranslatedText value={item.thesis} lang={lang} /></p>
                <ul className="tweet-list">
                  {(item.tweets?.length ? item.tweets : item.evidence.map((line) => ({ text: line, time: "", quote: undefined }))).map((tweet) => (
                    <li key={`${tweet.time}-${tweet.text}`}>
                      {tweet.time ? <span className="tweet-time">{tweet.time}</span> : null}
                      <p><TranslatedText value={tweet.text} lang={lang} /></p>
                      {tweet.quote ? (
                        <blockquote>
                          <strong>{localize("Quote", lang)} · {tweet.quote.author}</strong>
                          <span><TranslatedText value={tweet.quote.text} lang={lang} /></span>
                        </blockquote>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">{localize("No influencer analysis available in this runtime.", lang)}</div>
        )}
      </section>
    </main>
  );
}
